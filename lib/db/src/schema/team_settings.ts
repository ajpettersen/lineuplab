import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-coach team branding. One row per Clerk user. Drives the displayed team
 * name across the header, page title, and printed lineup cards.
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const updateTeamSettingsSchema = createInsertSchema(teamSettingsTable).pick({
  teamName: true,
  teamShortName: true,
  battingStyle: true,
});
export type UpdateTeamSettings = z.infer<typeof updateTeamSettingsSchema>;
export type TeamSettings = typeof teamSettingsTable.$inferSelect;

export const DEFAULT_TEAM_NAME = "My Team";
export const DEFAULT_TEAM_SHORT_NAME = "Team";
