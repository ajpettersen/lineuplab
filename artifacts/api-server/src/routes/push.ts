import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { getVapidPublicKey, pushEnabled } from "../lib/push";

/**
 * Web Push subscription management.
 *
 *   GET  /api/push/vapid-public-key  → { publicKey } | { publicKey: null }
 *   POST /api/push/subscribe         → upsert by endpoint
 *   POST /api/push/unsubscribe       → delete by endpoint
 *
 * All routes after vapid-public-key require auth (mounted under
 * `requireAuth` in routes/index.ts). The vapid-public-key route is
 * also gated by auth (no reason to expose it anonymously) but doesn't
 * need a team scope.
 */
const router: IRouter = Router();

router.get("/push/vapid-public-key", (_req, res) => {
  res.json({ publicKey: getVapidPublicKey(), enabled: pushEnabled });
});

const SubscribeBody = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
  userAgent: z.string().max(500).optional(),
});

router.post("/push/subscribe", async (req, res) => {
  const userId = req.userId;
  const ownerUserId = req.ownerUserId;
  if (!userId || !ownerUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = SubscribeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid subscription", details: parsed.error.format() });
    return;
  }
  const { endpoint, keys, userAgent } = parsed.data;

  // Endpoint is the natural key (one row per device); upsert so a
  // re-subscribe (e.g. coach revoked + re-granted) updates the keys
  // and rebinds the row to the current user / team scope rather than
  // leaking access from the previous owner.
  await db
    .insert(pushSubscriptionsTable)
    .values({
      userId,
      teamOwnerUserId: ownerUserId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: {
        userId,
        teamOwnerUserId: ownerUserId,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent ?? null,
      },
    });

  res.json({ ok: true });
});

const UnsubscribeBody = z.object({ endpoint: z.string().url().max(2000) });

router.post("/push/unsubscribe", async (req, res) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = UnsubscribeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid endpoint" });
    return;
  }
  // Only let a user delete their own row — ownership check prevents a
  // teammate from accidentally removing someone else's device.
  await db
    .delete(pushSubscriptionsTable)
    .where(
      and(
        eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint),
        eq(pushSubscriptionsTable.userId, userId),
      ),
    );
  res.json({ ok: true });
});

export default router;
