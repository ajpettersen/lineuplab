import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-user "currently selected team" pointer. Each authenticated request
 * resolves the data scope (`req.ownerUserId`) by reading this row.
 *
 * If the row is absent or points to a team the user is no longer a member
 * of, the middleware falls back to the user's own userId (their personal
 * team) and clears the stale row.
 */
export const userActiveTeamTable = pgTable("user_active_team", {
  userId: text("user_id").primaryKey(),
  activeOwnerUserId: text("active_owner_user_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserActiveTeam = typeof userActiveTeamTable.$inferSelect;
