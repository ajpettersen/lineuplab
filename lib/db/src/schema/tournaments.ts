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
  /**
   * Scheduled wall-clock first-pitch time (ISO 8601, with timezone).
   * Optional — extracted from the schedule screenshot when visible,
   * or copied from the linked real `games.gameDate` on the live-merge
   * path. Used to flag "this game should be done by now but has no
   * score yet" in the UI. null when unknown.
   */
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type PoolPlayGameJson = z.infer<typeof PoolPlayGameJson>;

/**
 * Ordered tiebreaker keys. The first key is the primary sort; subsequent
 * keys break ties within equal-primary groups, recursively.
 *
 *  - `winPct`       — wins / (wins + losses); ties don't count toward pct.
 *  - `h2h`          — head-to-head record vs the tied subgroup (final games).
 *  - `runDiff`      — runsFor − runsAgainst across all played pool games.
 *  - `runsAllowed`  — total runs against (LESS is better — coach wants
 *                     the team that gave up fewer runs on top).
 *  - `runsScored`   — total runs for (more is better).
 *  - `coinFlip`     — deterministic alphabetical fallback in projections;
 *                     UI flags it so coaches know a real coin flip resolves
 *                     it on game day.
 */
export const POOL_PLAY_TIEBREAKER_KEYS = [
  "winPct",
  "h2h",
  "runDiff",
  "runsAllowed",
  "runsScored",
  "coinFlip",
] as const;
export const PoolPlayTiebreakerKey = z.enum(POOL_PLAY_TIEBREAKER_KEYS);
export type PoolPlayTiebreakerKey = z.infer<typeof PoolPlayTiebreakerKey>;

/**
 * Map the legacy `tiebreaker` enum (3 fixed options) to the new ordered
 * chain. Used for backward compatibility on pool-play rows saved before
 * the flexible-tiebreaker upgrade — old rows have `tiebreaker` but not
 * `tiebreakers`, so the route normalizes them on read.
 */
export function tiebreakersFromLegacy(
  legacy: "winPct_h2h_runDiff" | "winPct_runDiff_h2h" | "winPct_h2h" | null | undefined,
): PoolPlayTiebreakerKey[] {
  switch (legacy) {
    case "winPct_runDiff_h2h":
      return ["winPct", "runDiff", "h2h"];
    case "winPct_h2h":
      return ["winPct", "h2h"];
    case "winPct_h2h_runDiff":
    default:
      return ["winPct", "h2h", "runDiff"];
  }
}

export const PoolPlayJson = z.object({
  // Which team in `teams` is the coach's own. Used to highlight
  // "you" rows in the UI and to compute self-focused clinch lines.
  ourTeamName: z.string().min(1),
  teams: z.array(PoolPlayTeamJson).min(2).max(16),
  games: z.array(PoolPlayGameJson).max(64),
  /**
   * LEGACY — kept optional so old rows still parse. New writes set
   * `tiebreakers` (ordered list); the simulator reads from
   * `tiebreakers` and falls back to mapping this enum when absent.
   */
  tiebreaker: z
    .enum(["winPct_h2h_runDiff", "winPct_runDiff_h2h", "winPct_h2h"])
    .optional(),
  /**
   * Ordered tiebreaker chain. First key is the primary sort, subsequent
   * keys break ties within equal-primary subgroups. Required on new
   * writes; the read path normalizes legacy rows by mapping
   * `tiebreaker` → `tiebreakers` if this is absent.
   */
  tiebreakers: z.array(PoolPlayTiebreakerKey).min(1).max(8),
  // How many teams advance from the pool (default 2 — most tournaments
  // take the top two from each pool into bracket play).
  advanceCount: z.number().int().min(1).max(8).default(2),
  /**
   * How many of the advancing teams skip the first bracket round (a
   * "bye"). 0 means everyone plays the same round. Capped by
   * `advanceCount` — you can't grant more byes than advancing seeds.
   */
  byeCount: z.number().int().min(0).max(8).default(0),
  updatedAt: z.string(),
})
  .refine((v) => v.advanceCount <= v.teams.length, {
    message: "advanceCount cannot exceed the number of teams",
    path: ["advanceCount"],
  })
  .refine((v) => v.byeCount <= v.advanceCount, {
    message: "byeCount cannot exceed advanceCount",
    path: ["byeCount"],
  });
export type PoolPlayJson = z.infer<typeof PoolPlayJson>;

/**
 * Normalize a pool-play record loaded from the database: backfill
 * `tiebreakers` from the legacy `tiebreaker` enum when missing, and
 * default `byeCount` to 0. Safe to call repeatedly. Returns a new
 * object — does NOT mutate the input.
 *
 * The DB column is `$type<PoolPlayJson>()` which is a compile-time
 * cast only, so older rows (pre-byes / pre-flexible-tiebreakers) will
 * be missing fields at runtime. Routes call this before handing the
 * data to the simulator.
 */
export function normalizePoolPlay(raw: PoolPlayJson | null | undefined): PoolPlayJson | null {
  if (!raw) return null;
  const tiebreakers =
    Array.isArray(raw.tiebreakers) && raw.tiebreakers.length > 0
      ? raw.tiebreakers
      : tiebreakersFromLegacy(raw.tiebreaker);
  return {
    ...raw,
    tiebreakers,
    byeCount: typeof raw.byeCount === "number" ? raw.byeCount : 0,
  };
}

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
    /**
     * SHA1 fingerprint of (normalized name, startDate, endDate). Used to
     * detect when two coaches added the same real-world tournament and
     * suggest they share data. Backfilled lazily — null on legacy rows
     * and recomputed on insert/update. See `lib/tournament-fingerprint.ts`.
     */
    networkFingerprint: text("network_fingerprint"),
    /**
     * When set, this coach has dismissed all current join suggestions
     * for this tournament — we won't re-prompt them about coaches who
     * were already suggesting at this time. New fingerprint matches
     * (different tournament added later) still surface.
     */
    networkPromptDismissedAt: timestamp("network_prompt_dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete timestamp. Null = visible. Reads filter
    // `deletedAt IS NULL`; the restore endpoint clears it.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("tournaments_user_id_idx").on(table.userId),
    index("tournaments_network_fingerprint_idx").on(table.networkFingerprint),
  ],
);

export const insertTournamentSchema = createInsertSchema(tournamentsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Tournament = typeof tournamentsTable.$inferSelect;
