import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { gamesTable } from "./games";
import { playersTable } from "./players";

/**
 * One row per (game, player) the coach has tracked pitches for. The
 * count is a single integer rather than per-inning detail because:
 *
 *   - Youth pitch limits are enforced as totals-per-day, not per-inning.
 *   - Coaches typically log either after the outing ("Sarah threw 38")
 *     or live in chunks via +1 / +5 / +10 buttons; both flows just
 *     mutate one number.
 *   - Per-inning detail can be layered on later without breaking this
 *     schema (add a `pitch_count_innings` child table).
 *
 * Tournament-day availability math walks every game in the tournament,
 * pulls these rows by gameId, and pairs them with `games.gameDate` to
 * apply rest tiers from the active ruleset.
 *
 * `userId` is denormalized so multi-tenant queries don't need a join
 * back through games to enforce ownership.
 *
 * Cascade-deletes on game/player removal: a deleted game's pitch
 * history isn't useful, and a deleted player can't have outings.
 */
export const pitchCountsTable = pgTable(
  "pitch_counts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    gameId: integer("game_id")
      .notNull()
      .references(() => gamesTable.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => playersTable.id, { onDelete: "cascade" }),
    pitches: integer("pitches").notNull().default(0),
    notes: text("notes"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pitch_counts_user_id_idx").on(table.userId),
    index("pitch_counts_game_id_idx").on(table.gameId),
    index("pitch_counts_player_id_idx").on(table.playerId),
    unique("pitch_counts_game_player_uq").on(table.gameId, table.playerId),
  ],
);

export const insertPitchCountSchema = createInsertSchema(pitchCountsTable).omit({
  id: true,
  userId: true,
  recordedAt: true,
});
export type InsertPitchCount = z.infer<typeof insertPitchCountSchema>;
export type PitchCount = typeof pitchCountsTable.$inferSelect;
