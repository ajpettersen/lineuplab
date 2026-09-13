import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-user "currently selected team" pointer. Each authenticated request
 * resolves the data scope (`req.ownerUserId`) by reading this row.
 *
 * If the row is absent or points to a team the user is no longer a member
 * of, the middleware falls back to the user's own userId (their personal
 * team) and clears the stale row.
 *
 * `defaultOwnerUserId` is a separate, sticky pointer: which team the coach
 * wants to land on when they sign back in, independent of whatever team
 * they were last poking around in. Set explicitly ("Set as default" on the
 * Teams page) or automatically when a team is created (a new season's team
 * becomes the default going forward). Null = no default set, falls back to
 * the user's own personal team. Like `activeOwnerUserId`, a pointer to a
 * team the user is no longer a member of should be treated as invalid by
 * the reader rather than trusted blindly.
 */
export const userActiveTeamTable = pgTable("user_active_team", {
  userId: text("user_id").primaryKey(),
  activeOwnerUserId: text("active_owner_user_id").notNull(),
  defaultOwnerUserId: text("default_owner_user_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserActiveTeam = typeof userActiveTeamTable.$inferSelect;
