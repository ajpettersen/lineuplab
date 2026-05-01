import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, gamesTable, playersTable, lineupEntriesTable, historicalFieldingTable } from "@workspace/db";

const router: IRouter = Router();

const POS_TO_GROUP: Record<string, string> = {
  P: "pitcher",
  C: "catcher",
  "1B": "cornerInfield",
  "3B": "cornerInfield",
  "2B": "middleInfield",
  SS: "middleInfield",
  LF: "outfield",
  CF: "outfield",
  RF: "outfield",
};

function posGroupInnings(hist: {
  inningsP: number; inningsC: number; innings1b: number; innings2b: number;
  innings3b: number; inningsSs: number; inningsLf: number; inningsCf: number;
  inningsRf: number; inningsBench: number;
}) {
  return {
    P: hist.inningsP,
    C: hist.inningsC,
    "1B": hist.innings1b,
    "2B": hist.innings2b,
    "3B": hist.innings3b,
    SS: hist.inningsSs,
    LF: hist.inningsLf,
    CF: hist.inningsCf,
    RF: hist.inningsRf,
    Bench: hist.inningsBench,
  };
}

router.get("/stats/season", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const allRows = await db.select().from(gamesTable).where(eq(gamesTable.userId, userId));
  // Only actual games count toward "Total Games" — practices and other events are excluded.
  const games = allRows.filter((g) => g.type === "game");
  const totalGames = games.length;
  const completedGames = games.filter((g) => g.status === "completed").length;

  // Lineup entries are tenant-isolated via the parent game id set we just
  // loaded. If the coach has no games yet, skip the entries query entirely.
  const gameIds = allRows.map((g) => g.id);
  const entries = gameIds.length > 0
    ? await db.select().from(lineupEntriesTable).where(inArray(lineupEntriesTable.gameId, gameIds))
    : [];
  const fieldEntries = entries.filter((e) => e.position !== "Bench");
  const totalInnings = fieldEntries.length;

  const positionDistribution: Record<string, number> = {};
  for (const e of fieldEntries) {
    positionDistribution[e.position] = (positionDistribution[e.position] ?? 0) + 1;
  }

  const players = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.userId, userId), eq(playersTable.active, true)));
  let fairnessScore = 100;
  if (players.length > 1 && completedGames > 0) {
    const benchByPlayer: number[] = players.map((p) => {
      const benchInnings = entries.filter((e) => e.playerId === p.id && e.position === "Bench").length;
      const totalPlayerInnings = entries.filter((e) => e.playerId === p.id).length;
      return totalPlayerInnings > 0 ? benchInnings / totalPlayerInnings : 0;
    });
    const mean = benchByPlayer.reduce((a, b) => a + b, 0) / benchByPlayer.length;
    const variance = benchByPlayer.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / benchByPlayer.length;
    const stddev = Math.sqrt(variance);
    fairnessScore = Math.max(0, Math.round(100 - stddev * 200));
  }

  res.json({ totalGames, completedGames, totalInnings, positionDistribution, fairnessScore });
});

router.get("/stats/players", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const players = await db.select().from(playersTable).where(eq(playersTable.userId, userId));
  if (players.length === 0) {
    res.json([]);
    return;
  }
  const playerIds = players.map((p) => p.id);
  // Bound entries + historical to this coach's player ids.
  const allEntries = await db
    .select()
    .from(lineupEntriesTable)
    .where(inArray(lineupEntriesTable.playerId, playerIds));
  const allHistorical = await db
    .select()
    .from(historicalFieldingTable)
    .where(inArray(historicalFieldingTable.playerId, playerIds));

  const stats = players.map((p) => {
    const playerEntries = allEntries.filter((e) => e.playerId === p.id);
    const gamesPlayed = new Set(playerEntries.map((e) => e.gameId)).size;
    const totalInnings = playerEntries.length;
    const benchInnings = playerEntries.filter((e) => e.position === "Bench").length;
    const positionInnings: Record<string, number> = {};
    for (const e of playerEntries.filter((e) => e.position !== "Bench")) {
      positionInnings[e.position] = (positionInnings[e.position] ?? 0) + 1;
    }

    // Historical fielding (aggregate from all imports)
    const historicalRows = allHistorical.filter((h) => h.playerId === p.id);
    const histInnings: Record<string, number> = {};
    let histBench = 0;
    let histTotal = 0;
    for (const h of historicalRows) {
      const hMap = posGroupInnings(h);
      for (const [pos, count] of Object.entries(hMap)) {
        if (pos === "Bench") { histBench += count; }
        else { histInnings[pos] = (histInnings[pos] ?? 0) + count; }
        histTotal += count;
      }
    }

    // Combine live + historical
    const combinedPositionInnings: Record<string, number> = { ...histInnings };
    for (const [pos, count] of Object.entries(positionInnings)) {
      combinedPositionInnings[pos] = (combinedPositionInnings[pos] ?? 0) + count;
    }
    const combinedBench = benchInnings + histBench;
    const combinedTotal = totalInnings + histTotal;

    // Position groups for combined data
    const groups = { pitcher: 0, catcher: 0, cornerInfield: 0, middleInfield: 0, outfield: 0, bench: combinedBench };
    for (const [pos, count] of Object.entries(combinedPositionInnings)) {
      const group = POS_TO_GROUP[pos];
      if (group && group in groups) {
        (groups as Record<string, number>)[group] += count;
      }
    }

    // Percentages
    const groupPct: Record<string, number> = {};
    if (combinedTotal > 0) {
      for (const [g, count] of Object.entries(groups)) {
        groupPct[g] = Math.round((count / combinedTotal) * 100);
      }
    }

    return {
      playerId: p.id,
      playerName: p.name,
      playerNumber: p.number ?? null,
      gamesPlayed,
      totalInnings,
      benchInnings,
      positionInnings,
      inningsPitched: positionInnings["P"] ?? 0,
      // Combined (live + historical)
      combinedTotal,
      combinedBench,
      combinedPositionInnings,
      historicalTotal: histTotal,
      groups,
      groupPct,
    };
  });

  res.json(stats);
});

export default router;
