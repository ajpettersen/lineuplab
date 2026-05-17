import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import multer from "multer";
import { db, battingStatsTable, gameBattingLinesTable, playersTable } from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { getOwnedPlayer } from "../lib/ownership";
import { getBattingTotals } from "../lib/batting-totals";
import { chargeAiCall } from "../lib/ai-usage";

const router: IRouter = Router();
router.use("/batting", gateWrites("partial"));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const BattingRowSchema = z.object({
  playerId: z.number().int(),
  seasonLabel: z.string().default("Current"),
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
  sourceNote: z.string().optional(),
});

function computeRates(row: { ab: number; hits: number; doubles: number; triples: number; hr: number; bb: number; hbp: number; sac: number }) {
  const pa = row.ab + row.bb + row.hbp + row.sac;
  const avg = row.ab > 0 ? row.hits / row.ab : 0;
  const obp = pa > 0 ? (row.hits + row.bb + row.hbp) / pa : 0;
  const tb = row.hits - row.doubles - row.triples - row.hr + row.doubles * 2 + row.triples * 3 + row.hr * 4;
  const slg = row.ab > 0 ? tb / row.ab : 0;
  const ops = obp + slg;
  return { avg: Math.round(avg * 1000) / 1000, obp: Math.round(obp * 1000) / 1000, slg: Math.round(slg * 1000) / 1000, ops: Math.round(ops * 1000) / 1000 };
}

router.get("/batting", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  // Returns the unioned per-player totals (manual `batting_stats` row
  // counts + summed `game_batting_lines`), with rates recomputed from
  // the unioned counts. Idempotent w.r.t. box-score imports.
  const rows = await getBattingTotals(userId);
  // Map to the legacy response shape the UI expects (playerId-keyed
  // row with avg/obp/slg/ops + counts). `seasonLabel` is preserved
  // for backwards compat — pinned to "Current" since the unified
  // view doesn't currently distinguish seasons.
  res.json(
    rows.map((r) => ({
      playerId: r.playerId,
      playerName: r.playerName,
      playerNumber: r.playerNumber,
      seasonLabel: "Current",
      ab: r.ab,
      hits: r.hits,
      doubles: r.doubles,
      triples: r.triples,
      hr: r.hr,
      rbi: r.rbi,
      bb: r.bb,
      k: r.k,
      hbp: r.hbp,
      sac: r.sac,
      sb: r.sb,
      runs: r.runs,
      avg: r.avg,
      obp: r.obp,
      slg: r.slg,
      ops: r.ops,
      gamesRecorded: r.gamesRecorded,
      hasPerGameLines: r.hasPerGameLines,
      updatedAt: r.updatedAt,
    })),
  );
});

router.put("/batting/:playerId", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const playerId = parseInt(req.params.playerId);
  if (isNaN(playerId)) { res.status(400).json({ error: "Invalid player ID" }); return; }

  // Confirm the target player belongs to this coach before any write lands.
  if (!(await getOwnedPlayer(userId, playerId))) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  const parsed = BattingRowSchema.safeParse({ ...req.body, playerId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() }); return; }

  // The numbers the UI shows (and pre-fills the edit form with) are
  // the UNIONED season totals — manual `batting_stats` row + summed
  // `game_batting_lines`. If we wrote the incoming totals directly
  // into the manual row, the next GET would re-add the per-game lines
  // on top and the stat would appear to double. So before writing,
  // we subtract the per-game contribution and store only the manual
  // DELTA. Mental model for callers: "save what you see" still works.
  const perGameRows = await db
    .select({
      ab: sql<number>`coalesce(sum(${gameBattingLinesTable.ab}), 0)::int`,
      hits: sql<number>`coalesce(sum(${gameBattingLinesTable.hits}), 0)::int`,
      doubles: sql<number>`coalesce(sum(${gameBattingLinesTable.doubles}), 0)::int`,
      triples: sql<number>`coalesce(sum(${gameBattingLinesTable.triples}), 0)::int`,
      hr: sql<number>`coalesce(sum(${gameBattingLinesTable.hr}), 0)::int`,
      rbi: sql<number>`coalesce(sum(${gameBattingLinesTable.rbi}), 0)::int`,
      bb: sql<number>`coalesce(sum(${gameBattingLinesTable.bb}), 0)::int`,
      k: sql<number>`coalesce(sum(${gameBattingLinesTable.k}), 0)::int`,
      hbp: sql<number>`coalesce(sum(${gameBattingLinesTable.hbp}), 0)::int`,
      sac: sql<number>`coalesce(sum(${gameBattingLinesTable.sac}), 0)::int`,
      sb: sql<number>`coalesce(sum(${gameBattingLinesTable.sb}), 0)::int`,
    })
    .from(gameBattingLinesTable)
    .where(
      and(
        eq(gameBattingLinesTable.userId, userId),
        eq(gameBattingLinesTable.playerId, playerId),
      ),
    );
  const pg = perGameRows[0] ?? {
    ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, rbi: 0,
    bb: 0, k: 0, hbp: 0, sac: 0, sb: 0,
  };

  // Reject impossible totals (incoming < per-game sum) up front rather
  // than silently clamping to zero, so the coach knows the box score
  // is the source of truth and they should edit it there instead.
  const COUNT_KEYS = [
    "ab", "hits", "doubles", "triples", "hr", "rbi",
    "bb", "k", "hbp", "sac", "sb",
  ] as const;
  for (const key of COUNT_KEYS) {
    if (parsed.data[key] < pg[key]) {
      res.status(400).json({
        error: `${key.toUpperCase()} (${parsed.data[key]}) is below the recorded box-score total (${pg[key]}). Edit the box score for the relevant game instead of lowering the season total.`,
      });
      return;
    }
  }

  // Subtract the per-game contribution to derive the manual delta.
  const manual = { ...parsed.data };
  for (const key of COUNT_KEYS) {
    manual[key] = parsed.data[key] - pg[key];
  }

  // Rates we store on the manual row are best-effort and not what the
  // UI ultimately renders — `getBattingTotals` recomputes them from
  // the unioned counts. Keep the column populated so legacy callers
  // that read the row directly still see sensible numbers.
  const rates = computeRates(manual);
  const existing = await db.select().from(battingStatsTable).where(eq(battingStatsTable.playerId, playerId));

  if (existing.length > 0) {
    const [updated] = await db
      .update(battingStatsTable)
      .set({ ...manual, ...rates, updatedAt: new Date() })
      .where(eq(battingStatsTable.playerId, playerId))
      .returning();
    res.json(updated);
  } else {
    const [created] = await db
      .insert(battingStatsTable)
      .values({ ...manual, ...rates })
      .returning();
    res.status(201).json(created);
  }
});

router.delete("/batting/:playerId", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const playerId = parseInt(req.params.playerId);
  if (!(await getOwnedPlayer(userId, playerId))) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  await db.delete(battingStatsTable).where(eq(battingStatsTable.playerId, playerId));
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Bulk nuke + restore for the manual `batting_stats` rows. Used by the
// "Delete all manual stats" flow on Season Stats. Box-score-derived
// `game_batting_lines` are NOT touched — those remain authoritative
// for per-game data and roll up via getBattingTotals.
// ---------------------------------------------------------------------------

const ClearAllSchema = z.object({ confirm: z.literal("DELETE") });

router.post("/batting/clear-all", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = ClearAllSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Confirmation required: send { confirm: \"DELETE\" }" });
    return;
  }
  // Snapshot every manual row this coach owns BEFORE wiping. We join
  // through `players` to constrain to this tenant — `batting_stats`
  // doesn't have its own `userId` column.
  const snapshot = await db
    .select({ row: battingStatsTable })
    .from(battingStatsTable)
    .innerJoin(playersTable, eq(playersTable.id, battingStatsTable.playerId))
    .where(eq(playersTable.userId, userId));
  const snapshotRows = snapshot.map((s) => s.row);
  if (snapshotRows.length === 0) {
    res.json({ deletedCount: 0, snapshot: [] });
    return;
  }
  const playerIds = snapshotRows.map((r) => r.playerId);
  await db
    .delete(battingStatsTable)
    .where(inArray(battingStatsTable.playerId, playerIds));
  res.json({ deletedCount: snapshotRows.length, snapshot: snapshotRows });
});

const RestoreSchema = z.object({
  rows: z.array(
    z.object({
      playerId: z.number().int(),
      seasonLabel: z.string().default("Current"),
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
      sourceNote: z.string().nullable().optional(),
    }),
  ),
});

router.post("/batting/restore", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = RestoreSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid snapshot", details: parsed.error.flatten() });
    return;
  }
  if (parsed.data.rows.length === 0) {
    res.json({ restored: 0 });
    return;
  }
  // Reconfirm every snapshot row is still an owned player. A snapshot
  // produced from clear-all minutes ago could reference a player who
  // has since been deleted — silently drop those rather than 4xx.
  const requestedIds = Array.from(
    new Set(parsed.data.rows.map((r) => r.playerId)),
  );
  const ownedRows = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(
      and(
        eq(playersTable.userId, userId),
        isNull(playersTable.deletedAt),
        inArray(playersTable.id, requestedIds),
      ),
    );
  const ownedSet = new Set(ownedRows.map((r) => r.id));
  const safeRows = parsed.data.rows.filter((r) => ownedSet.has(r.playerId));
  let restored = 0;
  // upsert per row — clearAll wiped them so insert path is the common
  // case, but accept overwrite in case the coach added new manual
  // stats between clear and restore (last writer wins on restore).
  for (const r of safeRows) {
    const rates = computeRates(r);
    await db
      .insert(battingStatsTable)
      .values({ ...r, ...rates, sourceNote: r.sourceNote ?? null })
      .onConflictDoUpdate({
        target: battingStatsTable.playerId,
        set: { ...r, ...rates, sourceNote: r.sourceNote ?? null, updatedAt: new Date() },
      });
    restored += 1;
  }
  res.json({ restored });
});

router.post("/batting/extract", upload.single("file"), async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const charge = await chargeAiCall(req, "batting-import");
  if (!charge.ok) { res.status(charge.status).json({ error: charge.error }); return; }

  const players = await db
    .select()
    .from(playersTable)
    .where(
      and(
        eq(playersTable.userId, userId),
        eq(playersTable.active, true),
        isNull(playersTable.deletedAt),
      ),
    );
  const playerList = players.map((p) => `${p.id}: ${p.name}${p.number != null ? ` (#${p.number})` : ""}`).join("\n");

  const base64 = req.file.buffer.toString("base64");
  const mimeType = req.file.mimetype || "image/png";

  const systemPrompt = `You are a baseball stats extractor. Given an image of a scorebook, stats sheet, or document, extract batting statistics for each player. Match players by name to the roster provided. Return a JSON array only, no explanation.

Roster (id: name):
${playerList}

Return format:
[
  {
    "playerId": <number>,
    "playerName": "<string>",
    "ab": <int>,
    "hits": <int>,
    "doubles": <int>,
    "triples": <int>,
    "hr": <int>,
    "rbi": <int>,
    "bb": <int>,
    "k": <int>,
    "hbp": <int>,
    "sac": <int>,
    "sb": <int>
  }
]

If a stat column is not visible, use 0. Only include players whose stats you can read. Return raw JSON array, no markdown.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: systemPrompt },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "[]";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let extracted;
  try {
    extracted = JSON.parse(cleaned);
  } catch {
    res.status(422).json({ error: "Could not parse AI response", raw });
    return;
  }

  // Drop any rows the LLM tried to attribute to players outside this roster.
  const rosterIds = new Set(players.map((p) => p.id));
  if (Array.isArray(extracted)) {
    extracted = extracted.filter(
      (r: { playerId?: unknown }) => typeof r.playerId === "number" && rosterIds.has(r.playerId),
    );
  }

  res.json({ extracted });
});

export default router;
