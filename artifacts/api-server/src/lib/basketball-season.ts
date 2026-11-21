import { and, asc, eq, isNull } from "drizzle-orm";
import { db, basketballGameStatsTable, playersTable } from "@workspace/db";

/** Season totals per active player from the court display: games played, starts, seconds on court. */
export async function basketballSeason(userId: string) {
  const [roster, games] = await Promise.all([
    db
      .select({ id: playersTable.id, name: playersTable.name, number: playersTable.number })
      .from(playersTable)
      .where(and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt), eq(playersTable.active, true)))
      .orderBy(asc(playersTable.name)),
    db.select().from(basketballGameStatsTable).where(eq(basketballGameStatsTable.userId, userId)),
  ]);
  const players = roster.map((p) => {
    let gamesPlayed = 0;
    let starts = 0;
    let seconds = 0;
    for (const g of games) {
      const sec = g.playedSec[String(p.id)] ?? 0;
      const started = g.starterIds.includes(p.id);
      if (started) starts++;
      if (started || sec > 0) gamesPlayed++;
      seconds += sec;
    }
    return { playerId: p.id, name: p.name, number: p.number, games: gamesPlayed, starts, seconds };
  });
  return { gamesTracked: games.length, players };
}
