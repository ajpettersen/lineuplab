import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, basketballGameLineupsTable, basketballGameStatsTable, gamesTable, playersTable } from "@workspace/db";

/**
 * Basketball playing time per active player across the season (or, with
 * `gameIds`, just those games, e.g. a tournament's). One source for the
 * Rotation Report, the player card, the dashboard and the planners.
 *
 * - A game's length is what was tracked: total player-seconds ÷ 5.
 * - A player is available for a game unless that game's lineup marked them
 *   absent (no lineup: available if they played or started). Games they
 *   missed don't count against them in % of available minutes.
 * - Fairness: 100 − (standard deviation of each player's share of their
 *   available minutes) × 400, the same scale as baseball's bench-rate score.
 */
export async function basketballSeason(userId: string, gameIds: number[] | null = null) {
  const statsFilter = gameIds
    ? and(eq(basketballGameStatsTable.userId, userId), inArray(basketballGameStatsTable.gameId, gameIds.length ? gameIds : [-1]))
    : eq(basketballGameStatsTable.userId, userId);
  const [roster, stats] = await Promise.all([
    db
      .select({ id: playersTable.id, name: playersTable.name, number: playersTable.number })
      .from(playersTable)
      .where(and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt), eq(playersTable.active, true)))
      .orderBy(asc(playersTable.name)),
    db.select().from(basketballGameStatsTable).where(statsFilter),
  ]);
  const ids = stats.map((s) => s.gameId);
  const [games, lineups] = ids.length
    ? await Promise.all([
        db
          .select({ id: gamesTable.id, gameDate: gamesTable.gameDate, opponent: gamesTable.opponent, deletedAt: gamesTable.deletedAt })
          .from(gamesTable)
          .where(and(eq(gamesTable.userId, userId), inArray(gamesTable.id, ids))),
        db
          .select({ gameId: basketballGameLineupsTable.gameId, absentIds: basketballGameLineupsTable.absentIds })
          .from(basketballGameLineupsTable)
          .where(and(eq(basketballGameLineupsTable.userId, userId), inArray(basketballGameLineupsTable.gameId, ids))),
      ])
    : [[], []];
  const gameById = new Map(games.map((g) => [g.id, g]));
  const absentByGame = new Map(lineups.map((l) => [l.gameId, new Set(l.absentIds)]));
  const tracked = stats
    .filter((s) => !gameById.get(s.gameId)?.deletedAt)
    .map((s) => {
      const g = gameById.get(s.gameId);
      const total = Object.values(s.playedSec).reduce((a, b) => a + (Number(b) || 0), 0);
      return {
        gameId: s.gameId,
        date: g ? new Date(g.gameDate).toISOString() : null,
        opponent: g?.opponent ?? null,
        gameSec: Math.round(total / 5),
        stats: s,
      };
    })
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.gameId - b.gameId);

  const players = roster.map((p) => {
    let gamesPlayed = 0;
    let starts = 0;
    let seconds = 0;
    let availableGames = 0;
    let availableSec = 0;
    const perGame = tracked.map((g) => {
      const sec = Math.round(g.stats.playedSec[String(p.id)] ?? 0);
      const started = g.stats.starterIds.includes(p.id);
      const absent = absentByGame.get(g.gameId);
      const available = absent ? !absent.has(p.id) : sec > 0 || started;
      if (started) starts++;
      if (started || sec > 0) gamesPlayed++;
      seconds += sec;
      if (available) {
        availableGames++;
        availableSec += g.gameSec;
      }
      return { gameId: g.gameId, seconds: sec, started, available };
    });
    return {
      playerId: p.id,
      name: p.name,
      number: p.number,
      games: gamesPlayed,
      starts,
      seconds,
      availableGames,
      availableSec,
      /** Tracked games they were marked out for. */
      outGames: tracked.length - availableGames,
      /** Seconds on the bench in games they were available for. */
      benchSec: Math.max(0, availableSec - seconds),
      /** Share of available minutes played (0–1), or null with no available games. */
      pctAvailable: availableSec > 0 ? seconds / availableSec : null,
      perGame,
    };
  });

  const shares = players.map((p) => p.pctAvailable).filter((x): x is number => x !== null);
  let fairnessScore: number | null = null;
  if (shares.length >= 2) {
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    const stddev = Math.sqrt(shares.reduce((a, b) => a + (b - mean) ** 2, 0) / shares.length);
    fairnessScore = Math.max(0, Math.round(100 - stddev * 400));
  }

  return {
    gamesTracked: tracked.length,
    games: tracked.map(({ gameId, date, opponent, gameSec }) => ({ gameId, date, opponent, gameSec })),
    fairnessScore,
    players,
  };
}
