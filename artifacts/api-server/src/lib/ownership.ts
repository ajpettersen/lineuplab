import { and, eq, inArray } from "drizzle-orm";
import { db, gamesTable, playersTable } from "@workspace/db";

/**
 * Helpers that scope DB lookups to a specific Clerk user. Use these instead
 * of bare `eq(table.id, ...)` lookups in route handlers so a coach cannot
 * read or mutate another coach's data by guessing an id.
 *
 * All helpers return `null` (rather than throw) when the row is missing OR
 * owned by another user — callers should treat both cases as 404 to avoid
 * leaking which ids exist across tenant boundaries.
 */

export async function getOwnedGame(userId: string, gameId: number) {
  const [game] = await db
    .select()
    .from(gamesTable)
    .where(and(eq(gamesTable.id, gameId), eq(gamesTable.userId, userId)));
  return game ?? null;
}

export async function getOwnedPlayer(userId: string, playerId: number) {
  const [player] = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.id, playerId), eq(playersTable.userId, userId)));
  return player ?? null;
}

/**
 * Returns the subset of the supplied playerIds that this user actually owns.
 * Use to filter request payloads (e.g. "available player ids" for lineup
 * generation) so a coach can't pull another coach's player into their lineup.
 */
export async function filterOwnedPlayerIds(
  userId: string,
  playerIds: number[],
): Promise<number[]> {
  if (playerIds.length === 0) return [];
  const rows = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(and(eq(playersTable.userId, userId), inArray(playersTable.id, playerIds)));
  return rows.map((r) => r.id);
}
