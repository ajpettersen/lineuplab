import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, gamesTable, playersTable, lineupEntriesTable, historicalFieldingTable } from "@workspace/db";
import { isPlayedGame } from "../lib/played-games";

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
  const userId = req.ownerUserId!;
  const allRows = await db
    .select()
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, userId), isNull(gamesTable.deletedAt)));
  // Only actual games count toward "Total Games" — practices and other events are excluded.
  const games = allRows.filter((g) => g.type === "game");
  const totalGames = games.length;

  // Stats reflect played games only (see isPlayedGame) — a draft lineup on
  // an upcoming game shouldn't move the position distribution / fairness
  // needles. Practices and other event rows are excluded by the type filter.
  const playedGames = games.filter((g) => isPlayedGame(g));
  const playedGameIds = playedGames.map((g) => g.id);
  const entries = playedGameIds.length > 0
    ? await db
        .select()
        .from(lineupEntriesTable)
        .where(inArray(lineupEntriesTable.gameId, playedGameIds))
    : [];
  // A past game nobody entered a lineup for (and didn't mark complete)
  // isn't really "played" as far as the report is concerned.
  const gamesWithLineups = new Set(entries.map((e) => e.gameId));
  const completedGames = playedGames.filter(
    (g) => g.status === "completed" || gamesWithLineups.has(g.id),
  ).length;
  const fieldEntries = entries.filter((e) => e.position !== "Bench");
  const totalInnings = fieldEntries.length;

  const positionDistribution: Record<string, number> = {};
  for (const e of fieldEntries) {
    positionDistribution[e.position] = (positionDistribution[e.position] ?? 0) + 1;
  }

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
    // Multiplier tuned so the realistic range of bench-rate spreads uses the
    // full 0-100 spectrum: stddev 0 → 100 (everyone sits the same share), and
    // a lopsided ~25-percentage-point spread → 0. A 20pp spread lands near 20.
    // (Was ×200, which pinned almost every real team in the high 80s-90s.)
    fairnessScore = Math.max(0, Math.round(100 - stddev * 400));
  }

  res.json({ totalGames, completedGames, totalInnings, positionDistribution, fairnessScore });
});

router.get("/stats/players", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const players = await db
    .select()
    .from(playersTable)
    .where(
      and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt)),
    );
  if (players.length === 0) {
    res.json([]);
    return;
  }
  const playerIds = players.map((p) => p.id);
  // Pull this coach's games so we can (a) restrict live entries to PLAYED
  // games only (isPlayedGame) — a draft lineup on an upcoming game shouldn't
  // move season tallies — and (b) compute "unavailable innings" against each
  // game's total inning count. Practices and other non-game events have
  // lineup entries too (e.g. drill rotations) but never count toward season
  // playing time; isPlayedGame excludes them.
  const userGames = await db
    .select({
      id: gamesTable.id,
      innings: gamesTable.innings,
      status: gamesTable.status,
      type: gamesTable.type,
      gameDate: gamesTable.gameDate,
    })
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, userId), isNull(gamesTable.deletedAt)));
  const playedGameIds = userGames.filter((g) => isPlayedGame(g)).map((g) => g.id);
  const playedGameIdSet = new Set<number>(playedGameIds);
  // Bound entries + historical to this coach's player ids, then drop entries
  // whose parent game hasn't been played.
  const allEntriesRaw = await db
    .select()
    .from(lineupEntriesTable)
    .where(inArray(lineupEntriesTable.playerId, playerIds));
  const allEntries = allEntriesRaw.filter((e) => playedGameIdSet.has(e.gameId));
  const allHistorical = await db
    .select()
    .from(historicalFieldingTable)
    .where(inArray(historicalFieldingTable.playerId, playerIds));
  const inningsByGameId = new Map<number, number>(userGames.map((g) => [g.id, g.innings]));

  const stats = players.map((p) => {
    const playerEntries = allEntries.filter((e) => e.playerId === p.id);
    const gameIdsForPlayer = new Set(playerEntries.map((e) => e.gameId));
    const gamesPlayed = gameIdsForPlayer.size;
    const totalInnings = playerEntries.length;
    const benchInnings = playerEntries.filter((e) => e.position === "Bench").length;
    const positionInnings: Record<string, number> = {};
    for (const e of playerEntries.filter((e) => e.position !== "Bench")) {
      positionInnings[e.position] = (positionInnings[e.position] ?? 0) + 1;
    }

    // Unavailable innings: for each game the player appears in, count how many
    // of that game's innings have no entry for them. We dedupe entries by
    // (gameId, inning) so a freak duplicate row doesn't make the count go
    // negative.
    let unavailableInnings = 0;
    for (const gameId of gameIdsForPlayer) {
      const gameInnings = inningsByGameId.get(gameId);
      if (gameInnings == null) continue;
      const distinctInnings = new Set(
        playerEntries.filter((e) => e.gameId === gameId).map((e) => e.inning),
      );
      const missing = gameInnings - distinctInnings.size;
      if (missing > 0) unavailableInnings += missing;
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
    // Total includes unavailable innings so the season total reflects the full
    // length of every attended game (24 across four 6-inning games), not just
    // the innings the player happened to be on the field or bench. Bench /
    // position breakdown remains driven by actual entries.
    const combinedTotal = totalInnings + histTotal + unavailableInnings;

    // Position groups for combined data
    const groups: Record<string, number> = {
      pitcher: 0,
      catcher: 0,
      cornerInfield: 0,
      middleInfield: 0,
      outfield: 0,
      bench: combinedBench,
      unavailable: unavailableInnings,
    };
    for (const [pos, count] of Object.entries(combinedPositionInnings)) {
      const group = POS_TO_GROUP[pos];
      if (group && group in groups) {
        groups[group] = (groups[group] ?? 0) + count;
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
      unavailableInnings,
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
