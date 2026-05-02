import { pgTable, text, serial, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * Multi-coach access. A "team" is identified by the head coach's Clerk
 * userId (the `ownerUserId`). Other Clerk users (`memberUserId`) can be
 * added to a team via an invite link; once they accept, all data-scoping
 * queries treat their requests as if they came from the head coach,
 * giving them full co-owner access to that team's roster, games, lineups,
 * AI memory, etc.
 *
 * The head coach is implicitly a member of their own team — there is NO
 * row in this table for the owner themselves. Use the helper
 * `userBelongsToTeam(userId, ownerUserId)` which short-circuits when
 * userId === ownerUserId before querying.
 *
 * One coach can belong to multiple teams (e.g. they coach their own team
 * and assist another). The `user_active_team` table tracks which team is
 * currently selected for each user.
 */
export const teamMembershipsTable = pgTable(
  "team_memberships",
  {
    id: serial("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    memberUserId: text("member_user_id").notNull(),
    memberEmail: text("member_email"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("team_memberships_owner_member_idx").on(
      table.ownerUserId,
      table.memberUserId,
    ),
    index("team_memberships_member_idx").on(table.memberUserId),
  ],
);

export type TeamMembership = typeof teamMembershipsTable.$inferSelect;
