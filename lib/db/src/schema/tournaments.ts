import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { RestTier } from "./team_settings";

/**
 * A coach-named container for a multi-game tournament weekend (e.g.
 * "Memorial Day Classic, May 24-26"). Games link to a tournament via
 * `games.tournament_id` so the app can compute rolling per-pitcher
 * totals across the weekend and show "pitches available today" given
 * what each player has thrown earlier in the same tournament.
 *
 * Pitch-count rules are stored as free-form fields per-tournament so a
 * coach can transcribe whatever the tournament publishes (some run
 * Little League rules, some publish their own caps and rest tiers).
 * Each field falls back to the matching team-settings default when
 * null — see `routes/tournaments.ts` for the resolution.
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
     * Maximum pitches per pitcher per calendar day. Null = inherit
     * the team default; if the team has no default either, daily-cap
     * warnings are disabled (the UI still shows totals).
     */
    dailyPitchMax: integer("daily_pitch_max"),
    /**
     * Maximum pitches per pitcher across the entire tournament. Null =
     * inherit team default; null on both = no tournament-wide cap.
     */
    tournamentPitchMax: integer("tournament_pitch_max"),
    /**
     * Rest tiers (pitches → days rest). Null = inherit team default;
     * null on both = no rest enforcement.
     */
    restTiers: jsonb("rest_tiers").$type<RestTier[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete timestamp. Null = visible. Reads filter
    // `deletedAt IS NULL`; the restore endpoint clears it.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
