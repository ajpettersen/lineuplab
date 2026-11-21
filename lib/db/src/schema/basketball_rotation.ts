import { doublePrecision, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Basketball bench-sheet setup for one team (Bench Sheet page). Keyed by the
 * team's data scope (`req.ownerUserId`), like team_settings. Player names come
 * from the team's roster (`players`); this only adds what the rotation needs:
 * each player's role and tags, the game settings, and the last game day's
 * attendance and starting order. The rotation itself is computed in the
 * browser (artifacts/baseball-lineup/src/lib/basketball-rotation.ts).
 *
 * Created lazily on the first save. Hand-applied SQL: lib/db/sql/basketball-rotation.sql.
 */
export interface BasketballPlayerTags {
  role: "guard" | "front";
  /** Front only: a 4/5. */
  big: boolean;
  /** Guard only, optional: plays the 1 or the 2. */
  position: "1" | "2" | null;
}

export interface BasketballGameDay {
  /** Player ids marked out for the game. */
  absentIds: number[];
  /** Player ids, starting order of each queue. */
  guardOrder: number[];
  frontOrder: number[];
}

export const basketballRotationSettingsTable = pgTable("basketball_rotation_settings", {
  userId: text("user_id").primaryKey(),
  halfMinutes: doublePrecision("half_minutes").notNull().default(20),
  shiftMinutes: doublePrecision("shift_minutes").notNull().default(2.5),
  guardSpots: integer("guard_spots").notNull().default(2),
  frontSpots: integer("front_spots").notNull().default(3),
  flexShifts: integer("flex_shifts").notNull().default(1),
  /** Player id (as a string key) → tags. Players missing here get defaults from their eligible positions. */
  playerTags: jsonb("player_tags").$type<Record<string, BasketballPlayerTags>>().notNull().default({}),
  gameDay: jsonb("game_day").$type<BasketballGameDay>().notNull().default({ absentIds: [], guardOrder: [], frontOrder: [] }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BasketballRotationSettings = typeof basketballRotationSettingsTable.$inferSelect;

/**
 * One basketball game as it was actually played on the court display: who
 * started and how many seconds each player was on court (from the game clock).
 * Feeds the season Starts / Minutes stats on the Rotation Report. Keyed by game;
 * `userId` is the team's data scope, like every other table.
 */
export const basketballGameStatsTable = pgTable("basketball_game_stats", {
  gameId: integer("game_id").primaryKey(),
  userId: text("user_id").notNull(),
  starterIds: integer("starter_ids").array().notNull().default([]),
  /** Player id (as a string key) → seconds on court. */
  playedSec: jsonb("played_sec").$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("basketball_game_stats_user_id_idx").on(table.userId)]);

export type BasketballGameStats = typeof basketballGameStatsTable.$inferSelect;
