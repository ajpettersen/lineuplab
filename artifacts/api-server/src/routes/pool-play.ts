import { Router, type IRouter } from "express";
import multer from "multer";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  tournamentsTable,
  PoolPlayJson,
  type PoolPlayJson as PoolPlayJsonType,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { gateWrites } from "../lib/permissions";
import { chargeAiCall } from "../lib/ai-usage";
import { simulatePoolPlay } from "../lib/pool-play-simulator";

const router: IRouter = Router();
router.use("/tournaments", gateWrites("full"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 3 }, // 8 MB / image, max 3
});

/**
 * Resolve and own-check a tournament by id. Returns the row or null.
 */
async function getOwnedTournament(id: number, userId: string) {
  const [row] = await db
    .select()
    .from(tournamentsTable)
    .where(
      and(
        eq(tournamentsTable.id, id),
        eq(tournamentsTable.userId, userId),
        isNull(tournamentsTable.deletedAt),
      ),
    );
  return row ?? null;
}

const IdParam = z.object({
  id: z.coerce.number().int().positive(),
});

// ---------------------------------------------------------------------------
// POST /tournaments/:id/pool-play/extract — multipart upload, AI parse
// ---------------------------------------------------------------------------

router.post(
  "/tournaments/:id/pool-play/extract",
  upload.array("files", 3),
  async (req, res): Promise<void> => {
    const userId = req.ownerUserId!;
    const params = IdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const tournament = await getOwnedTournament(params.data.id, userId);
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: "Upload at least one screenshot" });
      return;
    }
    if (files.length > 3) {
      res.status(400).json({ error: "Upload at most 3 screenshots" });
      return;
    }

    // Pre-charge the AI usage budget for all images up front so a
    // 3-image batch either fully succeeds or is refused before we
    // spend tokens.
    const charge = await chargeAiCall(req, "pool-play-extract", files.length);
    if (!charge.ok) {
      res.status(charge.status).json({ error: charge.error });
      return;
    }

    // Hint the model with the existing pool data, if any, so re-imports
    // can stitch additional screenshots onto the prior state instead of
    // wiping it (e.g. one screenshot for standings, another for the
    // remaining schedule). The coach can still edit before saving.
    const existingHint = tournament.poolPlay
      ? `\n\nThe coach already has this pool data saved — prefer reconciling rather than inventing new teams or games:\n${JSON.stringify(
          {
            teams: tournament.poolPlay.teams,
            games: tournament.poolPlay.games.map((g) => ({
              home: g.home,
              away: g.away,
              homeScore: g.homeScore,
              awayScore: g.awayScore,
              final: g.final,
            })),
          },
        )}`
      : "";

    const systemPrompt = `You are a baseball/softball tournament pool-play extractor. The user uploaded screenshots of a published pool-play standings page and/or schedule. Extract:

1. TEAMS in the pool (their names exactly as written; trim whitespace; preserve case and any colors/numbers in the name).
2. GAMES between those teams. For each game:
   - home / away team names (use the schedule order if shown; otherwise pick one — coach can correct).
   - homeScore / awayScore: integers if a final score is visible; null if the game has not been played.
   - final: true iff a final score is visible AND the game is shown as completed (not "in progress").
3. TIEBREAKER NOTE: free-form text of any tiebreaker rules visible on the page (e.g. "Tiebreakers: H2H, then run diff, then runs allowed"). null if not shown.
4. OUR TEAM GUESS: which team in the pool is the coach's. Common signals: row highlighted in screenshot, a "you" or "your team" marker, the tournament name including the team name. null if no clear signal.

Only include teams + games visible across the uploaded images. Do NOT invent games to "complete" a round-robin. Do NOT carry information from your training data — only what's on screen.${existingHint}

Tournament context: "${tournament.name}"${tournament.location ? `, ${tournament.location}` : ""}.

Return RAW JSON only, no markdown, no commentary:
{
  "ourTeamGuess": "<string or null>",
  "teams": [{ "name": "<string>" }, ...],
  "games": [
    { "home": "<string>", "away": "<string>", "homeScore": <int|null>, "awayScore": <int|null>, "final": <bool> },
    ...
  ],
  "tiebreakerNote": "<string or null>"
}`;

    // Send all images in a single completion call — the AI needs to
    // see them together to reconcile (e.g. standings on one page, the
    // schedule on the next). Pool play is a small payload, so a single
    // call is preferred over the parallel/merge pattern used for box
    // scores.
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: systemPrompt }];
    for (const f of files) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${f.mimetype || "image/png"};base64,${f.buffer.toString("base64")}`,
        },
      });
    }

    let parsed: unknown;
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 4000,
        reasoning_effort: "minimal",
        messages: [{ role: "user", content }],
      });
      const text = response.choices[0]?.message?.content ?? "";
      // Strip code fences if the model wrapped it
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      req.log.error({ err: e }, "pool-play extract failed");
      res.status(502).json({ error: "Failed to parse screenshots — try again or paste teams + games manually." });
      return;
    }

    // Best-effort shape coercion — the coach will review/edit before
    // saving, so we don't reject on minor schema deviations.
    const safeStr = (v: unknown, max = 80) =>
      typeof v === "string" ? v.trim().slice(0, max) : "";
    const intOrNull = (v: unknown): number | null => {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      const n = Math.round(v);
      if (n < 0 || n > 99) return null;
      return n;
    };
    const rawTeams = Array.isArray((parsed as { teams?: unknown }).teams)
      ? ((parsed as { teams: unknown[] }).teams as unknown[])
      : [];
    const rawGames = Array.isArray((parsed as { games?: unknown }).games)
      ? ((parsed as { games: unknown[] }).games as unknown[])
      : [];

    const teams = rawTeams
      .map((t) => ({ name: safeStr((t as { name?: unknown })?.name) }))
      .filter((t) => t.name.length > 0)
      .slice(0, 16);

    // Dedupe team names (case-insensitive) preserving first-seen casing.
    const seenTeam = new Set<string>();
    const uniqueTeams = teams.filter((t) => {
      const k = t.name.toLowerCase();
      if (seenTeam.has(k)) return false;
      seenTeam.add(k);
      return true;
    });
    const teamLookup = new Map(uniqueTeams.map((t) => [t.name.toLowerCase(), t.name]));

    // Game IDs are server-generated UUIDs so the client never has to
    // mint them; on edit/add the client mints new ones.
    let gid = 0;
    const games = rawGames
      .map((g) => {
        const o = g as Record<string, unknown>;
        const home = teamLookup.get(safeStr(o.home).toLowerCase()) ?? safeStr(o.home);
        const away = teamLookup.get(safeStr(o.away).toLowerCase()) ?? safeStr(o.away);
        const homeScore = intOrNull(o.homeScore);
        const awayScore = intOrNull(o.awayScore);
        const final = Boolean(o.final) && homeScore != null && awayScore != null;
        if (!home || !away || home.toLowerCase() === away.toLowerCase()) return null;
        gid++;
        return {
          id: `ext-${Date.now()}-${gid}`,
          home,
          away,
          homeScore: final ? homeScore : null,
          awayScore: final ? awayScore : null,
          final,
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
      .slice(0, 64);

    const ourTeamGuessRaw = safeStr((parsed as { ourTeamGuess?: unknown }).ourTeamGuess);
    const ourTeamGuess =
      ourTeamGuessRaw && teamLookup.get(ourTeamGuessRaw.toLowerCase())
        ? teamLookup.get(ourTeamGuessRaw.toLowerCase())!
        : null;
    const tiebreakerNoteRaw = (parsed as { tiebreakerNote?: unknown }).tiebreakerNote;
    const tiebreakerNote =
      typeof tiebreakerNoteRaw === "string" && tiebreakerNoteRaw.trim().length > 0
        ? tiebreakerNoteRaw.trim().slice(0, 400)
        : null;

    res.json({
      ourTeamGuess,
      teams: uniqueTeams,
      games,
      tiebreakerNote,
    });
  },
);

// ---------------------------------------------------------------------------
// PUT /tournaments/:id/pool-play — save (or replace) parsed pool data
// ---------------------------------------------------------------------------

router.put("/tournaments/:id/pool-play", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const tournament = await getOwnedTournament(params.data.id, userId);
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }

  const bodyParsed = PoolPlayJson.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const poolPlay = bodyParsed.data;

  // Cross-validate: every game's home/away must be a listed team.
  const teamNames = new Set(poolPlay.teams.map((t) => t.name));
  for (const g of poolPlay.games) {
    if (!teamNames.has(g.home) || !teamNames.has(g.away)) {
      res.status(400).json({
        error: `Game references unknown team: ${g.home} vs ${g.away}`,
      });
      return;
    }
    if (g.home === g.away) {
      res.status(400).json({ error: "Game home and away must differ" });
      return;
    }
    if (g.final && (g.homeScore == null || g.awayScore == null)) {
      res.status(400).json({ error: "Final games require both scores" });
      return;
    }
  }
  if (!teamNames.has(poolPlay.ourTeamName)) {
    res
      .status(400)
      .json({ error: `ourTeamName "${poolPlay.ourTeamName}" is not in the teams list` });
    return;
  }

  const toStore: PoolPlayJsonType = {
    ...poolPlay,
    updatedAt: new Date().toISOString(),
  };
  await db
    .update(tournamentsTable)
    .set({ poolPlay: toStore })
    .where(
      and(
        eq(tournamentsTable.id, params.data.id),
        eq(tournamentsTable.userId, userId),
      ),
    );

  const poolPlayAnalysis = simulatePoolPlay(toStore);
  res.json({ poolPlay: toStore, poolPlayAnalysis });
});

// ---------------------------------------------------------------------------
// DELETE /tournaments/:id/pool-play — clear saved pool data
// ---------------------------------------------------------------------------

router.delete("/tournaments/:id/pool-play", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const tournament = await getOwnedTournament(params.data.id, userId);
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  await db
    .update(tournamentsTable)
    .set({ poolPlay: null })
    .where(
      and(
        eq(tournamentsTable.id, params.data.id),
        eq(tournamentsTable.userId, userId),
      ),
    );
  res.status(204).end();
});

export default router;
