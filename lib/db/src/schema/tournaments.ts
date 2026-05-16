import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { RestTier } from "./team_settings";

/**
 * Pool-play scenario data attached to a tournament. Coaches upload
 * screenshots of the published pool-play standings/schedule; the AI
 * extracts the team list and games (some final, some still scheduled),
 * the coach can edit inline, and the server enumerates remaining W/L
 * outcomes to project finishing odds and clinch/elimination scenarios.
 *
 * The full structure is persisted as JSON on `tournaments.pool_play`
 * — there's only one per tournament (overwritten on re-import) and
 * the simulator is fully derived (not stored) so editing the games
 * re-runs the projection on the next GET.
 */
export const PoolPlayTeamJson = z.object({
  name: z.string().min(1).max(80),
});
export type PoolPlayTeamJson = z.infer<typeof PoolPlayTeamJson>;

export const PoolPlayGameJson = z.object({
  // Local UUID so the UI can key off it and edits round-trip cleanly.
  id: z.string().min(1).max(64),
  home: z.string().min(1).max(80),
  away: z.string().min(1).max(80),
  // Scores are null while the game is unplayed; for projection math
  // only final games contribute to win-loss + run differential.
  homeScore: z.number().int().min(0).max(99).nullable(),
  awayScore: z.number().int().min(0).max(99).nullable(),
  final: z.boolean(),
});
export type PoolPlayGameJson = z.infer<typeof PoolPlayGameJson>;

export const PoolPlayJson = z.object({
  // Which team in `teams` is the coach's own. Used to highlight
  // "you" rows in the UI and to compute self-focused clinch lines.
  ourTeamName: z.string().min(1),
  teams: z.array(PoolPlayTeamJson).min(2).max(16),
  games: z.array(PoolPlayGameJson).max(64),
  tiebreaker: z
    .enum(["winPct_h2h_runDiff", "winPct_runDiff_h2h", "winPct_h2h"])
    .default("winPct_h2h_runDiff"),
  // How many teams advance from the pool (default 2 — most tournaments
  // take the top two from each pool into bracket play).
  advanceCount: z.number().int().min(1).max(8).default(2),
  updatedAt: z.string(),
}).refine((v) => v.advanceCount <= v.teams.length, {
  message: "advanceCount cannot exceed the number of teams",
  path: ["advanceCount"],
});
export type PoolPlayJson = z.infer<typeof PoolPlayJson>;

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
    /**
     * Pool-play screenshot import + scenario data. Null until the
     * coach uploads standings/schedule screenshots for this
     * tournament. Re-importing overwrites; the simulator runs on
     * every GET so editing games re-projects immediately.
     */
    poolPlay: jsonb("pool_play").$type<PoolPlayJson>(),
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
