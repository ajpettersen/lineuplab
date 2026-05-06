import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  gamesTable,
  playersTable,
  practicesTable,
  tournamentsTable,
} from "@workspace/db";

/**
 * Helpers that scope DB lookups to a specific Clerk user. Use these instead
 * of bare `eq(table.id, ...)` lookups in route handlers so a coach cannot
 * read or mutate another coach's data by guessing an id.
 *
 * All helpers return `null` (rather than throw) when the row is missing OR
 * owned by another user — callers should treat both cases as 404 to avoid
 * leaking which ids exist across tenant boundaries.
 *
 * Soft-delete: the parent tables (players, games, practices, tournaments)
 * have a `deletedAt` column set when a coach trashes the row. The default
 * `getOwnedX` helpers EXCLUDE soft-deleted rows so trashed items don't
 * leak back into the app's normal read paths. The `getOwnedXIncludingDeleted`
 * variants are for the restore endpoints, which need to look up a row
 * specifically because it WAS trashed.
 */

export async function getOwnedGame(userId: string, gameId: number) {
  const [game] = await db
    .select()
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.id, gameId),
        eq(gamesTable.userId, userId),
        isNull(gamesTable.deletedAt),
      ),
    );
  return game ?? null;
}

export async function getOwnedGameIncludingDeleted(
  userId: string,
  gameId: number,
) {
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
    .where(
      and(
        eq(playersTable.id, playerId),
        eq(playersTable.userId, userId),
        isNull(playersTable.deletedAt),
      ),
    );
  return player ?? null;
}

export async function getOwnedPlayerIncludingDeleted(
  userId: string,
  playerId: number,
) {
  const [player] = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.id, playerId), eq(playersTable.userId, userId)));
  return player ?? null;
}

export async function getOwnedPractice(userId: string, practiceId: number) {
  const [practice] = await db
    .select()
    .from(practicesTable)
    .where(
      and(
        eq(practicesTable.id, practiceId),
        eq(practicesTable.userId, userId),
        isNull(practicesTable.deletedAt),
      ),
    );
  return practice ?? null;
}

export async function getOwnedPracticeIncludingDeleted(
  userId: string,
  practiceId: number,
) {
  const [practice] = await db
    .select()
    .from(practicesTable)
    .where(
      and(
        eq(practicesTable.id, practiceId),
        eq(practicesTable.userId, userId),
      ),
    );
  return practice ?? null;
}

export async function getOwnedTournament(userId: string, tournamentId: number) {
  const [tournament] = await db
    .select()
    .from(tournamentsTable)
    .where(
      and(
        eq(tournamentsTable.id, tournamentId),
        eq(tournamentsTable.userId, userId),
        isNull(tournamentsTable.deletedAt),
      ),
    );
  return tournament ?? null;
}

export async function getOwnedTournamentIncludingDeleted(
  userId: string,
  tournamentId: number,
) {
  const [tournament] = await db
    .select()
    .from(tournamentsTable)
    .where(
      and(
        eq(tournamentsTable.id, tournamentId),
        eq(tournamentsTable.userId, userId),
      ),
    );
  return tournament ?? null;
}

/**
 * Returns the subset of the supplied playerIds that this user actually owns.
 * Use to filter request payloads (e.g. "available player ids" for lineup
 * generation) so a coach can't pull another coach's player into their lineup.
 * Excludes soft-deleted players so a trashed roster member can't sneak into
 * a new lineup.
 */
export async function filterOwnedPlayerIds(
  userId: string,
  playerIds: number[],
): Promise<number[]> {
  if (playerIds.length === 0) return [];
  const rows = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(
      and(
        eq(playersTable.userId, userId),
        inArray(playersTable.id, playerIds),
        isNull(playersTable.deletedAt),
      ),
    );
  return rows.map((r) => r.id);
}
