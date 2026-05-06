import { Router, type IRouter } from "express";
import multer from "multer";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  gamesTable,
  playersTable,
  pitchCountsTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { gateWrites } from "../lib/permissions";
import { getOwnedGame } from "../lib/ownership";
import {
  getBattingLinesForGame,
  replaceBattingLinesForGameTx,
  deleteBattingLinesForGame,
  filterToOwnedActivePlayerIds,
} from "../lib/batting-totals";

/**
 * Box-score import — POST 1-4 phone screenshots of a GameChanger
 * (or any) box score; AI extracts batting + pitching lines + final
 * score; coach previews and edits; commit upserts:
 *
 *   - per-(game, player) batting lines in `game_batting_lines`
 *   - per-(game, player) pitch counts in `pitch_counts`
 *   - games.ourScore / opponentScore / status / boxScoreImportedAt
 *
 * Re-importing the same game replaces the prior import entirely
 * (lines + pitch counts wiped first), so coaches can re-upload to
 * fix typos without ever double-counting.
 */
const router: IRouter = Router();
// Box-score upload is the one write that the dedicated 'upload' tier
// is allowed to perform — it's specifically for a stat-keeper / parent
// who runs GameChanger but should NOT be able to edit lineups, roster,
// or settings. partial + full outrank upload so they pass too.
router.use("/games", gateWrites("upload"));

// 6 MB per file × up to 4 files = 24 MB cap. We accept multi-file
// uploads because GameChanger's mobile box score is paginated —
// coaches typically need one screenshot for batting, one for
// pitching. PDFs and image formats both work.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 4 },
});

const ExtractedBattingLine = z.object({
  playerId: z.number().int(),
  playerName: z.string().optional(),
  ab: z.number().int().min(0).default(0),
  hits: z.number().int().min(0).default(0),
  doubles: z.number().int().min(0).default(0),
  triples: z.number().int().min(0).default(0),
  hr: z.number().int().min(0).default(0),
  rbi: z.number().int().min(0).default(0),
  bb: z.number().int().min(0).default(0),
  k: z.number().int().min(0).default(0),
  hbp: z.number().int().min(0).default(0),
  sac: z.number().int().min(0).default(0),
  sb: z.number().int().min(0).default(0),
  runs: z.number().int().min(0).default(0),
});

const ExtractedPitchingLine = z.object({
  playerId: z.number().int(),
  playerName: z.string().optional(),
  pitches: z.number().int().min(0).default(0),
  notes: z.string().nullable().optional(),
});

const SaveBoxScoreBody = z.object({
  batting: z.array(ExtractedBattingLine).default([]),
  pitching: z.array(ExtractedPitchingLine).default([]),
  ourScore: z.number().int().min(0).nullable().optional(),
  opponentScore: z.number().int().min(0).nullable().optional(),
  /**
   * If true, also flip the game's status to "completed". Default true
   * — importing a box score implies the game has been played. UI can
   * pass false for a coach who wants to import a partial in-progress
   * snapshot.
   */
  markCompleted: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// GET — current import state for the import dialog ("already imported?",
// pre-fill values when re-opening).
// ---------------------------------------------------------------------------

router.get("/games/:id/box-score", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }
  const game = await getOwnedGame(userId, id);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const [battingLines, pitchCounts] = await Promise.all([
    getBattingLinesForGame(userId, id),
    db
      .select()
      .from(pitchCountsTable)
      .where(
        and(
          eq(pitchCountsTable.userId, userId),
          eq(pitchCountsTable.gameId, id),
        ),
      ),
  ]);
  res.json({
    gameId: id,
    importedAt: game.boxScoreImportedAt ?? null,
    ourScore: game.ourScore ?? null,
    opponentScore: game.opponentScore ?? null,
    batting: battingLines,
    pitching: pitchCounts,
  });
});

// ---------------------------------------------------------------------------
// POST /extract — AI image → preview JSON. Does not write to the DB.
// ---------------------------------------------------------------------------

router.post(
  "/games/:id/box-score/extract",
  upload.array("files", 4),
  async (req, res): Promise<void> => {
    const userId = req.ownerUserId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid game id" });
      return;
    }
    const game = await getOwnedGame(userId, id);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: "Upload at least one box score image" });
      return;
    }

    // Roster scoped to the team. Include inactive players too — a
    // box score might reference a player who was deactivated mid-
    // season, and we'd rather match them than drop their stats.
    const players = await db
      .select()
      .from(playersTable)
      .where(eq(playersTable.userId, userId));

    if (players.length === 0) {
      res
        .status(400)
        .json({ error: "Add players to your roster before importing a box score" });
      return;
    }

    const rosterText = players
      .map((p) => {
        const initial = p.firstName?.[0]?.toUpperCase() ?? "";
        const aka = p.lastName ? ` (also "${initial}. ${p.lastName}")` : "";
        return `${p.id}: ${p.name}${p.number != null ? ` (#${p.number})` : ""}${
          p.canPitch ? " [P]" : ""
        }${aka}`;
      })
      .join("\n");

    const systemPrompt = `You are a baseball box-score extractor. The user has uploaded ${files.length} image(s) from a scorebook (commonly GameChanger or a paper book). Extract:

1. BATTING line per player who batted: AB, R (runs), H (hits), 2B, 3B, HR, RBI, BB, K (or SO), HBP, SAC, SB.
2. PITCHING line per pitcher who threw: total pitch count for the outing. If only "IP" or "P" (pitches) is shown, use whatever pitch total is visible. If no pitch count is shown, OMIT the pitcher (do not guess).
3. FINAL SCORE: our team's runs vs the opponent. The OUR side is identified by which roster players appear in the lineup. The OPPONENT side is the other team. If the score is not visible, set both to null.

Match every player to the ROSTER below by name. GameChanger commonly displays each batter as "F. Lastname" (first initial + full last name) — match those by lastName + first-letter-of-firstName. Also handle "Last, First" and "First Last" forms; ignore jersey numbers if the name disagrees. Use the roster's playerId. If a name on the box score does not match any roster entry, OMIT that line — do NOT invent a playerId.

ROSTER (id: name [P]=pitcher):
${rosterText}

Return RAW JSON only, no markdown, no explanation:
{
  "batting": [
    { "playerId": <int>, "playerName": "<string>", "ab": <int>, "hits": <int>, "doubles": <int>, "triples": <int>, "hr": <int>, "rbi": <int>, "bb": <int>, "k": <int>, "hbp": <int>, "sac": <int>, "sb": <int>, "runs": <int> }
  ],
  "pitching": [
    { "playerId": <int>, "playerName": "<string>", "pitches": <int>, "notes": "<optional inning-line summary or null>" }
  ],
  "ourScore": <int|null>,
  "opponentScore": <int|null>
}

Use 0 for any stat column not visible. Use null (not 0) for ourScore/opponentScore if the final score isn't shown.`;

    const imageContent = files.map((f) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:${f.mimetype || "image/png"};base64,${f.buffer.toString("base64")}`,
      },
    }));

    let raw = "[]";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 6000,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: systemPrompt }, ...imageContent],
          },
        ],
      });
      raw = response.choices[0]?.message?.content ?? "{}";
    } catch (err) {
      req.log.error({ err }, "Box-score extraction failed");
      res.status(502).json({ error: "AI extraction failed" });
      return;
    }

    const cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      res
        .status(422)
        .json({ error: "AI returned a non-JSON response", raw });
      return;
    }

    // Defensively shape-check + drop hallucinated playerIds.
    const rosterIds = new Set(players.map((p) => p.id));
    const obj = (parsed ?? {}) as Record<string, unknown>;

    function sanitizeBatting(arr: unknown) {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((r) => {
          const p = ExtractedBattingLine.safeParse(r);
          return p.success ? p.data : null;
        })
        .filter((r): r is z.infer<typeof ExtractedBattingLine> =>
          r !== null && rosterIds.has(r.playerId),
        );
    }

    function sanitizePitching(arr: unknown) {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((r) => {
          const p = ExtractedPitchingLine.safeParse(r);
          return p.success ? p.data : null;
        })
        .filter((r): r is z.infer<typeof ExtractedPitchingLine> =>
          r !== null && rosterIds.has(r.playerId) && r.pitches > 0,
        );
    }

    const numOrNull = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

    res.json({
      batting: sanitizeBatting(obj.batting),
      pitching: sanitizePitching(obj.pitching),
      ourScore: numOrNull(obj.ourScore),
      opponentScore: numOrNull(obj.opponentScore),
    });
  },
);

// ---------------------------------------------------------------------------
// POST — commit the (possibly edited) preview. Idempotent per game.
// ---------------------------------------------------------------------------

router.post("/games/:id/box-score", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }
  const parsed = SaveBoxScoreBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const game = await getOwnedGame(userId, id);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  // Validate every referenced playerId belongs to the team. Drop any
  // line that doesn't (this should never happen given the extract
  // route already filters, but the save endpoint is independently
  // exposed and a malicious client could craft anything).
  const allPlayerIds = Array.from(
    new Set([
      ...parsed.data.batting.map((l) => l.playerId),
      ...parsed.data.pitching.map((l) => l.playerId),
    ]),
  );
  const owned = await filterToOwnedActivePlayerIds(userId, allPlayerIds);
  const battingLines = parsed.data.batting.filter((l) => owned.has(l.playerId));
  const pitchingLines = parsed.data.pitching.filter((l) => owned.has(l.playerId));

  const importedAt = new Date();
  const sourceNote = `Box score imported ${importedAt.toISOString().slice(0, 10)}`;

  // Single transaction so a partial failure can't leave the game
  // with new batting lines but stale pitch counts / score.
  await db.transaction(async (tx) => {
    await replaceBattingLinesForGameTx(tx, userId, id, battingLines, sourceNote);

    // Pitch counts: idempotent upsert per (game, player). We DO NOT
    // delete prior pitch counts that aren't in this payload — coaches
    // who use the live tap-counter on the field display + then import
    // a box score later shouldn't lose their live data. The coach can
    // delete individual rows from the existing pitch-counts UI if
    // they need to.
    for (const p of pitchingLines) {
      await tx
        .insert(pitchCountsTable)
        .values({
          userId,
          gameId: id,
          playerId: p.playerId,
          pitches: p.pitches,
          notes: p.notes ?? null,
        })
        .onConflictDoUpdate({
          target: [pitchCountsTable.gameId, pitchCountsTable.playerId],
          set: {
            pitches: p.pitches,
            notes: p.notes ?? null,
            recordedAt: importedAt,
          },
        });
    }

    // Update game header. We only set scores when the payload provided
    // them (null/undefined = leave alone, so a coach editing the
    // batting lines without changing the score doesn't have to retype).
    const gameUpdate: Record<string, unknown> = {
      boxScoreImportedAt: importedAt,
    };
    if (parsed.data.ourScore !== undefined) gameUpdate.ourScore = parsed.data.ourScore;
    if (parsed.data.opponentScore !== undefined) {
      gameUpdate.opponentScore = parsed.data.opponentScore;
    }
    if (parsed.data.markCompleted) gameUpdate.status = "completed";
    await tx.update(gamesTable).set(gameUpdate).where(eq(gamesTable.id, id));
  });

  res.json({
    gameId: id,
    importedAt: importedAt.toISOString(),
    battingLinesSaved: battingLines.length,
    pitchingLinesSaved: pitchingLines.length,
    ourScore:
      parsed.data.ourScore !== undefined ? parsed.data.ourScore : game.ourScore,
    opponentScore:
      parsed.data.opponentScore !== undefined
        ? parsed.data.opponentScore
        : game.opponentScore,
  });
});

// ---------------------------------------------------------------------------
// DELETE — clear the import (lines + flag). Leaves pitch counts and
// final score in place so the coach decides what to revert.
// ---------------------------------------------------------------------------

router.delete("/games/:id/box-score", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }
  const game = await getOwnedGame(userId, id);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  await deleteBattingLinesForGame(userId, id);
  await db
    .update(gamesTable)
    .set({ boxScoreImportedAt: null })
    .where(eq(gamesTable.id, id));
  res.status(204).end();
});

export default router;
