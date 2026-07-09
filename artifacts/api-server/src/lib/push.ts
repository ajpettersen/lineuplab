import webpush from "web-push";
import { eq, sql } from "drizzle-orm";
import { db, pushSubscriptionsTable, type PushSubscriptionRow } from "@workspace/db";
import { logger } from "./logger";

/**
 * Web Push (VAPID) singleton.
 *
 * Reads VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT from env
 * once at module load and caches the configured state. If any are
 * missing, the module exports `pushEnabled = false` and the rest of
 * the codebase no-ops gracefully — the goal is that a fresh dev clone
 * without VAPID keys still boots and serves the app, push features
 * just stay dark.
 *
 * Subject MUST be a `mailto:` URL or `https://` URL per VAPID spec.
 * If the env var is missing or malformed we fall back to a generic
 * mailto so subscriptions don't fail on technicality during dev.
 */
const VAPID_PUBLIC_KEY = process.env["VAPID_PUBLIC_KEY"];
const VAPID_PRIVATE_KEY = process.env["VAPID_PRIVATE_KEY"];
const VAPID_SUBJECT_RAW = process.env["VAPID_SUBJECT"];

const subjectIsValid = (s: string | undefined): s is string =>
  !!s && (s.startsWith("mailto:") || s.startsWith("https://"));

const VAPID_SUBJECT = subjectIsValid(VAPID_SUBJECT_RAW)
  ? VAPID_SUBJECT_RAW
  : "mailto:notifications@lineup-lab.local";

export const pushEnabled = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
  logger.info("Web Push (VAPID) configured");
} else {
  logger.warn(
    "Web Push disabled — set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY env vars to enable",
  );
}

export function getVapidPublicKey(): string | null {
  return VAPID_PUBLIC_KEY ?? null;
}

/**
 * Payload shape consumed by the service-worker `push` handler in
 * `public/push-sw.js`. Keep this in sync with that file.
 */
export type PushPayload = {
  /** Notification title (top line in the OS notification). */
  title: string;
  /** Body text (second line). */
  body: string;
  /** Path to focus / open when the notification is tapped (relative). */
  url?: string;
  /** Tag used to coalesce duplicate notifications on the OS layer. */
  tag?: string;
};

/**
 * Send a payload to a single subscription row. Removes the row if
 * the push service responds 404 / 410 (subscription is permanently
 * gone — usually the user revoked permission or uninstalled the PWA).
 * Updates `lastUsedAt` on success so an admin can prune cold devices.
 *
 * Returns the resulting state for diagnostics (`"sent" | "gone" |
 * "error"`); the scheduler logs counts but never throws on individual
 * failures so one dead device can't block the rest of the batch.
 */
export async function sendPushToSubscription(
  sub: PushSubscriptionRow,
  payload: PushPayload,
): Promise<"sent" | "gone" | "error"> {
  if (!pushEnabled) return "error";
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 }, // 24h: a box-score reminder more than a day stale isn't useful
    );
    await db
      .update(pushSubscriptionsTable)
      .set({
        lastUsedAt: new Date(),
        rowVersion: sql`${pushSubscriptionsTable.rowVersion} + 1`,
      })
      .where(eq(pushSubscriptionsTable.id, sub.id));
    return "sent";
  } catch (err) {
    // web-push raises a WebPushError with `statusCode` for transport
    // failures. 404 / 410 = subscription is permanently gone. Anything
    // else (5xx from the push service, transient network) we keep the
    // row and try again next tick.
    const status = (err as { statusCode?: number } | undefined)?.statusCode;
    if (status === 404 || status === 410) {
      await db
        .delete(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.id, sub.id));
      logger.info({ subId: sub.id, status }, "Pruned stale push subscription");
      return "gone";
    }
    logger.warn({ err, subId: sub.id, status }, "Push send failed");
    return "error";
  }
}
