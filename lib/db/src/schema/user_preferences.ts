import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-coach defaults for game and lineup creation. One row per Clerk user.
 *
 * Created lazily the first time a user hits the /api/preferences endpoint or
 * any flow that needs a default.
 */
export const userPreferencesTable = pgTable("user_preferences", {
  userId: text("user_id").primaryKey(),
  defaultInnings: integer("default_innings").notNull().default(6),
  defaultMaxInningsPerPosition: integer("default_max_innings_per_position").notNull().default(2),
  defaultMaxInningsBench: integer("default_max_innings_bench").notNull().default(2),
  defaultEnsureAllPositions: boolean("default_ensure_all_positions").notNull().default(true),
  defaultPitcherRotation: boolean("default_pitcher_rotation").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const updateUserPreferencesSchema = createInsertSchema(userPreferencesTable).pick({
  defaultInnings: true,
  defaultMaxInningsPerPosition: true,
  defaultMaxInningsBench: true,
  defaultEnsureAllPositions: true,
  defaultPitcherRotation: true,
});
export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;
export type UserPreferences = typeof userPreferencesTable.$inferSelect;
