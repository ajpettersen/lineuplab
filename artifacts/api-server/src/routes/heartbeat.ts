import { Router, type IRouter } from "express";
import { db, coachActivityPingsTable } from "@workspace/db";

const router: IRouter = Router();

/**
 * POST /api/heartbeat — record that the calling coach was active in
 * the app during the current minute. Idempotent: the
 * (member_user_id, bucket_minute) primary key dedupes within a minute,
 * so multiple tabs / rapid calls collapse to one row.
 *
 * Master-admin pings are still recorded for sanity-checks; the admin
 * dashboard read can choose to filter them out.
 */
router.post("/heartbeat", async (req, res): Promise<void> => {
  const userId = req.userId!;
  // Floor to the current minute (UTC). Using a Date keeps drizzle's
  // timestamp serialization happy.
  const now = new Date();
  const bucket = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      0,
      0,
    ),
  );
  await db
    .insert(coachActivityPingsTable)
    .values({ memberUserId: userId, bucketMinute: bucket })
    .onConflictDoNothing({
      target: [
        coachActivityPingsTable.memberUserId,
        coachActivityPingsTable.bucketMinute,
      ],
    });
  res.sendStatus(204);
});

export default router;
