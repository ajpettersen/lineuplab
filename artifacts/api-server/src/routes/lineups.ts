import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, gamesTable, playersTable, lineupEntriesTable } from "@workspace/db";
import {
  GetGameLineupParams,
  GenerateLineupParams,
  GenerateLineupBody,
  SaveLineupParams,
  SaveLineupBody,
} from "@workspace/api-zod";
import { generateFairLineup } from "../lib/lineup-generator";

const router: IRouter = Router();

router.get("/games/:id/lineup", async (req, res): Promise<void> => {
  const params = GetGameLineupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [game] = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.id, params.data.id));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const entries = await db
    .select({
      id: lineupEntriesTable.id,
      gameId: lineupEntriesTable.gameId,
      playerId: lineupEntriesTable.playerId,
      playerName: playersTable.name,
      inning: lineupEntriesTable.inning,
      position: lineupEntriesTable.position,
      battingOrder: lineupEntriesTable.battingOrder,
    })
    .from(lineupEntriesTable)
    .innerJoin(playersTable, eq(lineupEntriesTable.playerId, playersTable.id))
    .where(eq(lineupEntriesTable.gameId, params.data.id))
    .orderBy(lineupEntriesTable.inning, lineupEntriesTable.position);
  res.json(entries);
});

router.post("/games/:id/lineup/generate", async (req, res): Promise<void> => {
  const params = GenerateLineupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = GenerateLineupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [game] = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.id, params.data.id));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const { availablePlayerIds, constraints } = parsed.data;
  const innings = parsed.data.innings ?? game.innings;

  if (availablePlayerIds.length === 0) {
    res.status(400).json({ error: "No players available" });
    return;
  }

  const players = await db
    .select()
    .from(playersTable)
    .where(inArray(playersTable.id, availablePlayerIds));

  if (players.length === 0) {
    res.status(400).json({ error: "No valid players found" });
    return;
  }

  const generated = generateFairLineup(players, innings, constraints ?? {});

  // Return as lineup entries with player names (not saved yet)
  const playerMap = new Map(players.map((p) => [p.id, p.name]));
  const entries = generated.map((e, idx) => ({
    id: -(idx + 1), // temporary negative IDs to indicate unsaved
    gameId: params.data.id,
    playerId: e.playerId,
    playerName: playerMap.get(e.playerId) ?? "Unknown",
    inning: e.inning,
    position: e.position,
    battingOrder: e.battingOrder,
  }));

  res.json(entries);
});

router.post("/games/:id/lineup/save", async (req, res): Promise<void> => {
  const params = SaveLineupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SaveLineupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [game] = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.id, params.data.id));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  // Delete existing lineup for this game
  await db
    .delete(lineupEntriesTable)
    .where(eq(lineupEntriesTable.gameId, params.data.id));

  if (parsed.data.entries.length === 0) {
    res.json([]);
    return;
  }

  const insertValues = parsed.data.entries.map((e) => ({
    gameId: params.data.id,
    playerId: e.playerId,
    inning: e.inning,
    position: e.position,
    battingOrder: e.battingOrder ?? null,
  }));

  await db.insert(lineupEntriesTable).values(insertValues);

  // Return the saved entries with player names
  const entries = await db
    .select({
      id: lineupEntriesTable.id,
      gameId: lineupEntriesTable.gameId,
      playerId: lineupEntriesTable.playerId,
      playerName: playersTable.name,
      inning: lineupEntriesTable.inning,
      position: lineupEntriesTable.position,
      battingOrder: lineupEntriesTable.battingOrder,
    })
    .from(lineupEntriesTable)
    .innerJoin(playersTable, eq(lineupEntriesTable.playerId, playersTable.id))
    .where(eq(lineupEntriesTable.gameId, params.data.id))
    .orderBy(lineupEntriesTable.inning, lineupEntriesTable.position);

  res.json(entries);
});

export default router;
