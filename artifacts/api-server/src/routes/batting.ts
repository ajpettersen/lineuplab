import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import multer from "multer";
import { db, battingStatsTable, playersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { getOwnedPlayer } from "../lib/ownership";
import { getBattingTotals } from "../lib/batting-totals";

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

  const rates = computeRates(parsed.data);
  const existing = await db.select().from(battingStatsTable).where(eq(battingStatsTable.playerId, playerId));

  if (existing.length > 0) {
    const [updated] = await db
      .update(battingStatsTable)
      .set({ ...parsed.data, ...rates, updatedAt: new Date() })
      .where(eq(battingStatsTable.playerId, playerId))
      .returning();
    res.json(updated);
  } else {
    const [created] = await db
      .insert(battingStatsTable)
      .values({ ...parsed.data, ...rates })
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

router.post("/batting/extract", upload.single("file"), async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const players = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.userId, userId), eq(playersTable.active, true)));
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
