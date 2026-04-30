import { Router, type IRouter } from "express";
import { db, historicalFieldingTable, playersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const FieldingRowSchema = z.object({
  playerName: z.string(),
  playerId: z.number().optional(),
  importLabel: z.string(),
  inningsP: z.number().int().min(0).default(0),
  inningsC: z.number().int().min(0).default(0),
  innings1b: z.number().int().min(0).default(0),
  innings2b: z.number().int().min(0).default(0),
  innings3b: z.number().int().min(0).default(0),
  inningsSs: z.number().int().min(0).default(0),
  inningsLf: z.number().int().min(0).default(0),
  inningsCf: z.number().int().min(0).default(0),
  inningsRf: z.number().int().min(0).default(0),
  inningsBench: z.number().int().min(0).default(0),
});

const ImportBodySchema = z.object({
  label: z.string().min(1),
  rows: z.array(FieldingRowSchema).min(1),
});

router.get("/history/fielding", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: historicalFieldingTable.id,
      playerId: historicalFieldingTable.playerId,
      playerName: playersTable.name,
      playerNumber: playersTable.number,
      importLabel: historicalFieldingTable.importLabel,
      inningsP: historicalFieldingTable.inningsP,
      inningsC: historicalFieldingTable.inningsC,
      innings1b: historicalFieldingTable.innings1b,
      innings2b: historicalFieldingTable.innings2b,
      innings3b: historicalFieldingTable.innings3b,
      inningsSs: historicalFieldingTable.inningsSs,
      inningsLf: historicalFieldingTable.inningsLf,
      inningsCf: historicalFieldingTable.inningsCf,
      inningsRf: historicalFieldingTable.inningsRf,
      inningsBench: historicalFieldingTable.inningsBench,
      createdAt: historicalFieldingTable.createdAt,
    })
    .from(historicalFieldingTable)
    .innerJoin(playersTable, eq(historicalFieldingTable.playerId, playersTable.id))
    .orderBy(historicalFieldingTable.createdAt);
  res.json(rows);
});

router.post("/history/fielding", async (req, res): Promise<void> => {
  const parsed = ImportBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid import data", details: parsed.error.flatten() });
    return;
  }
  const { label, rows } = parsed.data;

  const allPlayers = await db.select().from(playersTable);

  const inserted = [];
  const notFound = [];

  for (const row of rows) {
    let playerId = row.playerId;
    if (!playerId) {
      const match = allPlayers.find(
        (p) => p.name.toLowerCase().trim() === row.playerName.toLowerCase().trim()
      );
      if (!match) {
        notFound.push(row.playerName);
        continue;
      }
      playerId = match.id;
    }

    const [record] = await db
      .insert(historicalFieldingTable)
      .values({
        playerId,
        importLabel: label,
        inningsP: row.inningsP,
        inningsC: row.inningsC,
        innings1b: row.innings1b,
        innings2b: row.innings2b,
        innings3b: row.innings3b,
        inningsSs: row.inningsSs,
        inningsLf: row.inningsLf,
        inningsCf: row.inningsCf,
        inningsRf: row.inningsRf,
        inningsBench: row.inningsBench,
      })
      .returning();
    inserted.push(record);
  }

  res.status(201).json({ inserted: inserted.length, notFound });
});

router.delete("/history/fielding/:label", async (req, res): Promise<void> => {
  const label = decodeURIComponent(req.params.label);
  await db
    .delete(historicalFieldingTable)
    .where(eq(historicalFieldingTable.importLabel, label));
  res.status(204).send();
});

export default router;
