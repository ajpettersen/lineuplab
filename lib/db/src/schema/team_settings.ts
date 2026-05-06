import { pgTable, text, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-coach team branding + tournament defaults. One row per Clerk user.
 * Drives the displayed team name across the header, page title, and
 * printed lineup cards. Tournament fields seed the per-tournament forms
 * so a coach who runs the same age group all season doesn't have to
 * re-type pitch limits each weekend.
 *
 * Created lazily the first time a user hits the /api/team-settings or
 * /api/preferences endpoints (or any flow that needs the team name).
 */
export const teamSettingsTable = pgTable("team_settings", {
  userId: text("user_id").primaryKey(),
  teamName: text("team_name").notNull(),
  teamShortName: text("team_short_name").notNull(),
  /**
   * How the team bats. Drives how the generator assigns batting orders:
   *  - "continuous" → every player on the roster gets a batting slot (the
   *    youth-baseball default — everyone bats every time through the order).
   *  - "nine_man"   → only the 9 highest-ranked batters (per the chosen
   *    ordering rule) get slots 1-9; the rest are subs with no slot.
   * Defaults to continuous so existing teams behave the same as before.
   */
  battingStyle: text("batting_style").notNull().default("continuous"),
  /**
   * Default per-day pitch maximum for new tournaments. Coach can still
   * override per-tournament. Null = no team default; per-tournament
   * value is required if the coach wants daily-cap warnings.
   */
  defaultDailyPitchMax: integer("default_daily_pitch_max"),
  /**
   * Default cap on total pitches across an entire tournament weekend
   * (sum of every game). Useful for AAU/showcase formats that publish
   * a weekend cap on top of the daily cap. Null = no team default.
   */
  defaultTournamentPitchMax: integer("default_tournament_pitch_max"),
  /**
   * Default rest tiers. Each tier maps a single-day pitch total to the
   * required calendar days of rest before the player can pitch again.
   * Order ascending by `maxPitches`; the catch-all tier should set
   * `maxPitches` to a very large number (e.g. 999) so any total over
   * the highest published tier still maps to a rest count.
   * Null = no team default.
   */
  defaultRestTiers: jsonb("default_rest_tiers").$type<RestTier[]>(),
  /**
   * Active defensive positions for this team's lineups. The full standard
   * 9 (`["P","C","1B","2B","3B","SS","LF","CF","RF"]`) is the default. A
   * coach who runs a 10-player field can swap CF for LCF + RCF, giving
   * `["P","C","1B","2B","3B","SS","LF","LCF","RCF","RF"]`. Position strings
   * outside this set still validate at write-time (other teams may use them)
   * but the lineup grid + field display only render columns/slots from this
   * list. LCF/RCF are categorized as Outfield in tally aggregations.
   */
  activeFieldPositions: text("active_field_positions").array().notNull().default(["P","C","1B","2B","3B","SS","LF","CF","RF"]),
  /**
   * When true, the dashboard surfaces a "Box score not imported" task
   * for every past game whose `boxScoreImportedAt` is null (and not
   * dismissed). Off by default so coaches who don't use GameChanger
   * aren't nagged. Pairs with the GameChanger box-score import feature.
   */
  usesGameChanger: boolean("uses_gamechanger").notNull().default(false),
  /**
   * Master switch for tournament features. When false the
   * "Tournaments" entry is hidden from the Events nav, and the
   * Tournament option is removed from the game-type picker on the
   * new-game and edit-game forms — i.e. a coach who only runs a
   * weekly league never has to look at the tournament UI.
   *
   * Defaults to true so existing teams keep the feature visible;
   * coaches turn it off from Settings → Defaults. Existing games
   * already saved with `gameType="tournament"` still render their
   * tournament-specific badges and lineup behavior — this flag
   * only gates discoverability of the feature, not historical data.
   */
  usesTournaments: boolean("uses_tournaments").notNull().default(true),
  /**
   * Per-team UI theme overrides. Stored as space-separated HSL strings
   * (`"H S% L%"` — e.g. `"220 85% 22%"`) so they can drop straight into
   * the existing `hsl(var(--primary))` CSS variables without any
   * conversion. Null = use the app default. The frontend only injects
   * `--primary` and `--accent` (everything else stays on the brand
   * scheme); foregrounds are kept fixed so contrast doesn't break.
   */
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  /**
   * When the head coach finished the first-run onboarding wizard
   * (welcome, name, team identity, colors, roster, invites, tour).
   * Null = wizard not done yet → next sign-in redirects to /welcome.
   * Set once when the coach clicks "Finish" on the last step.
   */
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RestTier = { maxPitches: number; daysRest: number };

export const updateTeamSettingsSchema = createInsertSchema(teamSettingsTable).pick({
  teamName: true,
  teamShortName: true,
  battingStyle: true,
  defaultDailyPitchMax: true,
  defaultTournamentPitchMax: true,
  defaultRestTiers: true,
  activeFieldPositions: true,
  usesGameChanger: true,
  usesTournaments: true,
  primaryColor: true,
  secondaryColor: true,
});
export type UpdateTeamSettings = z.infer<typeof updateTeamSettingsSchema>;
export type TeamSettings = typeof teamSettingsTable.$inferSelect;

export const DEFAULT_TEAM_NAME = "My Team";
export const DEFAULT_TEAM_SHORT_NAME = "Team";
