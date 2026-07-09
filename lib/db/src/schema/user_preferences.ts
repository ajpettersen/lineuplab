import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { rowVersion } from "./row-version";

/**
 * Per-coach defaults for game and lineup creation. One row per Clerk user.
 *
 * Created lazily the first time a user hits the /api/preferences endpoint or
 * any flow that needs a default.
 */
export const userPreferencesTable = pgTable("user_preferences", {
  userId: text("user_id").primaryKey(),
  rowVersion: rowVersion(),
  defaultInnings: integer("default_innings").notNull().default(6),
  defaultMaxInningsPerPosition: integer("default_max_innings_per_position").notNull().default(2),
  defaultMaxInningsBench: integer("default_max_innings_bench").notNull().default(2),
  defaultEnsureAllPositions: boolean("default_ensure_all_positions").notNull().default(true),
  defaultPitcherRotation: boolean("default_pitcher_rotation").notNull().default(false),
  /**
   * When true, the Generate Lineup flow on a game will warn the coach if any
   * inning is missing a Pitcher (P) or Catcher (C) lock and ask them to set
   * those locks first (with an "Generate anyway" override). Off by default
   * so existing coaches see no behavior change. Defensive-minded coaches who
   * always plan their battery first can flip this on in Settings.
   */
  alwaysLockPitcherCatcher: boolean("always_lock_pitcher_catcher").notNull().default(false),
  /**
   * When false, the Fairness Score stat card on the Dashboard and the
   * Fairness bar on the Rotation Report are hidden. The score is still
   * computed server-side (other features may use it), it just isn't shown.
   * Default true so existing coaches see no behavior change.
   */
  showFairnessScore: boolean("show_fairness_score").notNull().default(true),
  /**
   * When false, the "Make this lineup more equitable" suggestions popup on
   * a game's lineup view never renders. Coaches who don't want the nudge
   * can turn it off in Settings → Defaults. Default true.
   */
  showEquitySuggestions: boolean("show_equity_suggestions").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const updateUserPreferencesSchema = createInsertSchema(userPreferencesTable).pick({
  defaultInnings: true,
  defaultMaxInningsPerPosition: true,
  defaultMaxInningsBench: true,
  defaultEnsureAllPositions: true,
  defaultPitcherRotation: true,
  alwaysLockPitcherCatcher: true,
  showFairnessScore: true,
  showEquitySuggestions: true,
});
export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;
export type UserPreferences = typeof userPreferencesTable.$inferSelect;
