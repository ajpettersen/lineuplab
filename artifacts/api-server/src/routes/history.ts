import { Router, type IRouter } from "express";
import { db, historicalFieldingTable, playersTable } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
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

router.get("/history/fielding", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  // Tenant isolation via the players join.
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
    .where(and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt)))
    .orderBy(historicalFieldingTable.createdAt);
  res.json(rows);
});

router.post("/history/fielding", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = ImportBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid import data", details: parsed.error.flatten() });
    return;
  }
  const { label, rows } = parsed.data;

  // Only resolve names against this coach's roster — never another tenant's.
  const allPlayers = await db
    .select()
    .from(playersTable)
    .where(
      and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt)),
    );
  const ownedIds = new Set(allPlayers.map((p) => p.id));

  const inserted = [];
  const notFound = [];

  for (const row of rows) {
    let playerId = row.playerId;
    if (playerId != null) {
      // Caller-provided id must belong to this coach.
      if (!ownedIds.has(playerId)) {
        notFound.push(row.playerName);
        continue;
      }
    } else {
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
  const userId = req.ownerUserId!;
  const label = decodeURIComponent(req.params.label);
  // Two-step delete so a coach can never wipe another coach's import that
  // happens to share the same label string. We collect this user's player
  // ids first, then constrain the delete to that set.
  const owned = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(
      and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt)),
    );
  const ownedIds = owned.map((r) => r.id);
  if (ownedIds.length === 0) {
    res.status(204).send();
    return;
  }
  await db
    .delete(historicalFieldingTable)
    .where(
      and(
        eq(historicalFieldingTable.importLabel, label),
        inArray(historicalFieldingTable.playerId, ownedIds),
      ),
    );
  res.status(204).send();
});

export default router;
