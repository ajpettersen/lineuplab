import { pgTable, text, timestamp, primaryKey, index } from "drizzle-orm/pg-core";

/**
 * One row per (coach, minute) the coach was actively using the app.
 * Written by a 60-second client heartbeat from `Layout` while the tab
 * is visible. The (memberUserId, bucketMinute) primary key dedupes
 * within the same minute so multiple tabs / rapid pings collapse to
 * one row.
 *
 * Active minutes for a window = COUNT(DISTINCT bucket_minute) where
 *   member_user_id = ? AND bucket_minute >= now - window.
 *
 * Last seen = MAX(bucket_minute).
 *
 * Volume estimate: ~60 rows/hour per actively-used tab. Master-admin
 * pings are still recorded (so an admin can see their own activity
 * for sanity-checks); aggregation excludes them at the read site if
 * we ever want to.
 */
export const coachActivityPingsTable = pgTable(
  "coach_activity_pings",
  {
    memberUserId: text("member_user_id").notNull(),
    bucketMinute: timestamp("bucket_minute", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.memberUserId, t.bucketMinute] }),
    bucketIdx: index("coach_activity_pings_bucket_idx").on(t.bucketMinute),
  }),
);

export type CoachActivityPingRow = typeof coachActivityPingsTable.$inferSelect;
