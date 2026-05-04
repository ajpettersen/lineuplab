import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A coach-named container for a multi-game tournament weekend (e.g.
 * "Memorial Day Classic, May 24-26"). Games link to a tournament via
 * `games.tournament_id` so the app can compute rolling per-pitcher
 * totals across the weekend and show "pitches available today" given
 * what each player has thrown earlier in the same tournament.
 *
 * Pitch count rules are stored per-tournament so a coach can run e.g.
 * a USSSA tournament one weekend and a Little League tournament the
 * next without re-configuring.
 */
export const tournamentsTable = pgTable(
  "tournaments",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    location: text("location"),
    notes: text("notes"),
    /**
     * Identifier for the bundled pitch-rule set to apply. See
     * `pitch-rules.ts` for the catalog. Null = inherit team default.
     * Examples: "littleLeague_7_8", "littleLeague_9_10",
     * "littleLeague_11_12", "littleLeague_13_16".
     */
    pitchCountRuleset: text("pitch_count_ruleset"),
    /**
     * Override for the daily-pitch maximum from the ruleset. Useful
     * when a specific tournament publishes a stricter local rule
     * (e.g. "max 75 today regardless of age" for a marathon weekend).
     * Null = use the ruleset's default daily max.
     */
    dailyPitchMax: integer("daily_pitch_max"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("tournaments_user_id_idx").on(table.userId)],
);

export const insertTournamentSchema = createInsertSchema(tournamentsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Tournament = typeof tournamentsTable.$inferSelect;
