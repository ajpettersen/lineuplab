import { pgTable, text, serial, timestamp, integer, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Snapshot of a single lineup_entries row, captured before the coach overrides
// the saved lineup with a post-game photo. We freeze the player NAME (not just
// id) so the snapshot still reads sensibly if a player is later removed.
export type PlanSnapshotEntry = {
  playerId: number;
  playerName: string;
  inning: number;
  position: string;
  battingOrder: number | null;
};

export const gamesTable = pgTable(
  "games",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    opponent: text("opponent").notNull(),
    gameDate: timestamp("game_date", { withTimezone: true }).notNull(),
    location: text("location"),
    innings: integer("innings").notNull().default(6),
    status: text("status").notNull().default("upcoming"),
    // Event kind: "game" | "practice" | "other"
    type: text("type").notNull().default("game"),
    // Optional competitive context — drives the lineup generator's bias.
    //   "tournament" → most competitive (best fielders, OBP-ordered batting)
    //   "league"     → rebalances season plate appearances (low-PA kids bat earlier)
    //   null         → unspecified, falls back to the global equity slider
    gameType: text("game_type"),
    ourScore: integer("our_score"),
    opponentScore: integer("opponent_score"),
    // Wall-clock time of the actual first pitch (set by the dugout coach
    // tapping "Start Game" on the field display). Distinct from gameDate
    // (the SCHEDULED start) — tournaments routinely start late, and the
    // running game timer needs to reflect actual elapsed play, not the
    // scheduled slot. Null until the coach kicks it off; resettable via
    // a PATCH with `startedAt: null` if they fat-fingered the button.
    startedAt: timestamp("started_at", { withTimezone: true }),
    notes: text("notes"),
    // Snapshot of the planned lineup (taken when the coach chose "Keep both"
    // before overriding with a post-game photo). Null = no snapshot.
    planSnapshot: jsonb("plan_snapshot").$type<PlanSnapshotEntry[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("games_user_id_idx").on(table.userId)],
);

export const insertGameSchema = createInsertSchema(gamesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;
