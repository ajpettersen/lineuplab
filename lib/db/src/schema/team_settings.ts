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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const updateTeamSettingsSchema = createInsertSchema(teamSettingsTable).pick({
  teamName: true,
  teamShortName: true,
});
export type UpdateTeamSettings = z.infer<typeof updateTeamSettingsSchema>;
export type TeamSettings = typeof teamSettingsTable.$inferSelect;

export const DEFAULT_TEAM_NAME = "My Team";
export const DEFAULT_TEAM_SHORT_NAME = "Team";
