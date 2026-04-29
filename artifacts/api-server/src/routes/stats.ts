import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, gamesTable, playersTable, lineupEntriesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/stats/season", async (_req, res): Promise<void> => {
  const games = await db.select().from(gamesTable);
  const totalGames = games.length;
  const completedGames = games.filter((g) => g.status === "completed").length;

  const entries = await db.select().from(lineupEntriesTable);
  const fieldEntries = entries.filter((e) => e.position !== "Bench");
  const totalInnings = fieldEntries.length;

  const positionDistribution: Record<string, number> = {};
  for (const e of fieldEntries) {
    positionDistribution[e.position] = (positionDistribution[e.position] ?? 0) + 1;
  }

  // Fairness score: 0-100 based on std deviation of bench time across players
  const players = await db.select().from(playersTable).where(eq(playersTable.active, true));
  let fairnessScore = 100;
  if (players.length > 1 && completedGames > 0) {
    const benchByPlayer: number[] = players.map((p) => {
      const benchInnings = entries.filter(
        (e) => e.playerId === p.id && e.position === "Bench"
      ).length;
      const totalPlayerInnings = entries.filter((e) => e.playerId === p.id).length;
      return totalPlayerInnings > 0 ? benchInnings / totalPlayerInnings : 0;
    });
    const mean = benchByPlayer.reduce((a, b) => a + b, 0) / benchByPlayer.length;
    const variance =
      benchByPlayer.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / benchByPlayer.length;
    const stddev = Math.sqrt(variance);
    // Convert stddev to a 0-100 score (lower stddev = higher score)
    fairnessScore = Math.max(0, Math.round(100 - stddev * 200));
  }

  res.json({
    totalGames,
    completedGames,
    totalInnings,
    positionDistribution,
    fairnessScore,
  });
});

router.get("/stats/players", async (_req, res): Promise<void> => {
  const players = await db.select().from(playersTable);
  const allEntries = await db.select().from(lineupEntriesTable);
  const allGames = await db.select().from(gamesTable);

  const gameIds = new Set(allGames.map((g) => g.id));

  const stats = players.map((p) => {
    const playerEntries = allEntries.filter((e) => e.playerId === p.id);
    const gamesPlayed = new Set(playerEntries.map((e) => e.gameId)).size;
    const totalInnings = playerEntries.length;
    const benchInnings = playerEntries.filter((e) => e.position === "Bench").length;
    const positionInnings: Record<string, number> = {};
    for (const e of playerEntries.filter((e) => e.position !== "Bench")) {
      positionInnings[e.position] = (positionInnings[e.position] ?? 0) + 1;
    }
    const inningsPitched = positionInnings["P"] ?? 0;
    return {
      playerId: p.id,
      playerName: p.name,
      playerNumber: p.number ?? null,
      gamesPlayed,
      totalInnings,
      benchInnings,
      positionInnings,
      inningsPitched,
    };
  });

  res.json(stats);
});

export default router;
