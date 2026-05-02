import { pgTable, text, serial, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * One-shot invite tokens used to add an assistant coach to a team.
 *
 * Lifecycle:
 *   1. Owner POSTs /api/team/invites → row inserted with random `token`,
 *      `expiresAt = now + 7d`, `revokedAt = null`, `acceptedAt = null`.
 *   2. Owner copies `/join/<token>` and shares it.
 *   3. Invitee opens the link → if unauthenticated, Clerk sign-in flow
 *      redirects back to /join/<token>.
 *   4. /join/<token> calls POST /api/invites/<token>/accept which
 *      transactionally: validates not-expired, not-revoked, not-already-accepted,
 *      not-self-invite, inserts a `team_memberships` row, marks the invite
 *      `acceptedAt + acceptedByUserId`, and switches the user's active team.
 *
 * The token is a high-entropy random string generated server-side and
 * indexed unique.
 */
export const teamInvitesTable = pgTable(
  "team_invites",
  {
    id: serial("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    token: text("token").notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: text("accepted_by_user_id"),
  },
  (table) => [
    uniqueIndex("team_invites_token_idx").on(table.token),
    index("team_invites_owner_idx").on(table.ownerUserId),
  ],
);

export type TeamInvite = typeof teamInvitesTable.$inferSelect;
