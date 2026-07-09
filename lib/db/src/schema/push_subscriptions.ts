import { pgTable, text, serial, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { rowVersion } from "./row-version";

/**
 * Web Push subscription endpoints owned by individual coaches.
 *
 * One row per (coach, browser/device) pair. The `endpoint` URL is what
 * the push service hands back when the browser registers, and uniquely
 * identifies the device + push provider; we treat it as the natural
 * upsert key. Multiple devices per coach are allowed (a coach can opt
 * in from both their phone and their iPad). Multiple coaches sharing a
 * device would each store their own subscription (they sign in / out
 * of Clerk).
 *
 * `userId` is the Clerk userId of the SUBSCRIBER (not the team owner)
 * so notifications can be addressed to the actual person — a stat-mom
 * who joined a team as a member should be able to opt in independently
 * of the head coach.
 *
 * `teamOwnerUserId` is the team scope the subscription was created
 * under (i.e. `req.ownerUserId` at registration time). The current
 * notification (box-score reminder) is per-team, so we use this to
 * decide which subscriptions get pinged for a given game. If a coach
 * later switches teams from the team-picker, they'll need to re-enable
 * notifications for the new team — that's expected and intentional
 * (they probably don't want box-score reminders for the team they no
 * longer actively coach).
 *
 * `p256dh` + `auth` are the Web Push encryption keys exchanged at
 * subscription time; web-push requires both verbatim to encrypt the
 * payload. They're not secrets in the API-key sense — they're per-
 * subscription public material — but they only matter alongside the
 * matching endpoint.
 */
export const pushSubscriptionsTable = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    rowVersion: rowVersion(),
    userId: text("user_id").notNull(),
    teamOwnerUserId: text("team_owner_user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** Free-form UA hint shown in a future "Manage devices" panel. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Bumped on every successful send so we can prune stale rows. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
    index("push_subscriptions_team_idx").on(table.teamOwnerUserId),
    index("push_subscriptions_user_idx").on(table.userId),
  ],
);

export type PushSubscriptionRow = typeof pushSubscriptionsTable.$inferSelect;
