/**
 * Web Push subscription helpers.
 *
 * Two layers:
 *   1) Pure utilities for asking the browser to subscribe / unsubscribe
 *      and POSTing to /api/push. No React.
 *   2) `usePushNotifications()` React hook that wraps the utilities
 *      with a state machine so a Settings card can render the right
 *      toggle / permission state.
 *
 * Capabilities the UI cares about:
 *   - Browser supports Notification + ServiceWorker + PushManager
 *   - Current Notification.permission ("default" | "granted" | "denied")
 *   - We have an active push subscription registered with the server
 *
 * iOS-specific note: Safari only supports Web Push for installed PWAs
 * (Add to Home Screen) on iOS 16.4+. Capability detection covers the
 * "Push not available" case generically — we don't special-case iOS,
 * we just let the toggle render disabled with a helpful tooltip.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const VAPID_KEY_ENDPOINT = "/api/push/vapid-public-key";
const SUBSCRIBE_ENDPOINT = "/api/push/subscribe";
const UNSUBSCRIBE_ENDPOINT = "/api/push/unsubscribe";

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: string };

export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") {
    return { supported: false, reason: "SSR / no window" };
  }
  if (!("serviceWorker" in navigator)) {
    return { supported: false, reason: "This browser doesn't support service workers." };
  }
  if (!("PushManager" in window)) {
    return { supported: false, reason: "This browser doesn't support push notifications." };
  }
  if (!("Notification" in window)) {
    return { supported: false, reason: "This browser doesn't support notifications." };
  }
  // iOS only delivers push to installed PWAs — detect the "browser tab,
  // not installed" case so we can suggest A2HS rather than fail silently
  // when subscribe() throws.
  const ua = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
  const standalone =
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    // Safari-iOS legacy flag.
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (isIos && !standalone) {
    return {
      supported: false,
      reason:
        "On iPhone / iPad, install Lineup Lab to your Home Screen first (Share → Add to Home Screen), then re-open it from the Home Screen icon.",
    };
  }
  return { supported: true };
}

/** Convert URL-safe base64 VAPID public key into the Uint8Array PushManager wants. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

async function getServerVapidKey(authedFetch: typeof fetch): Promise<string | null> {
  const res = await authedFetch(VAPID_KEY_ENDPOINT, { credentials: "include" });
  if (!res.ok) return null;
  const data = (await res.json()) as { publicKey: string | null; enabled: boolean };
  if (!data.enabled || !data.publicKey) return null;
  return data.publicKey;
}

async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/** Persist a fresh PushSubscription to the server. Throws on non-2xx
 * so the calling hook can surface the failure (and avoid a false
 * "enabled" UI state when the server didn't actually accept the
 * registration). */
async function persistSubscription(
  authedFetch: typeof fetch,
  sub: PushSubscription,
): Promise<void> {
  const json = sub.toJSON();
  const res = await authedFetch(SUBSCRIBE_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    }),
  });
  if (!res.ok) {
    // Drop the browser subscription so we don't end up with a half-
    // registered state where the browser thinks we're subscribed but
    // the server has no record.
    try {
      await sub.unsubscribe();
    } catch {
      /* ignore */
    }
    throw new Error(
      `Couldn't register this device with the server (HTTP ${res.status}).`,
    );
  }
}

export type UsePushNotifications = {
  /** Capability check result; null while still computing. */
  support: PushSupport | null;
  /** Browser-reported permission state; "default" until prompted. */
  permission: NotificationPermission | "unknown";
  /** True once we know the user has a server-registered subscription. */
  enabled: boolean;
  /** A subscribe/unsubscribe is in flight. */
  busy: boolean;
  /** Last error string from a subscribe/unsubscribe attempt. */
  error: string | null;
  /** Prompt for permission + register a subscription. */
  enable: () => Promise<void>;
  /** Drop the subscription (browser + server). */
  disable: () => Promise<void>;
};

/**
 * React hook wrapping the push subscribe/unsubscribe lifecycle.
 *
 * Pass an `authedFetch` (the same `fetch` Clerk's wrapper produces in
 * the rest of the app) so the /api/push routes get the auth header.
 * If the caller passes plain `fetch`, the routes still work because
 * Clerk middleware reads cookies via `credentials: "include"`.
 */
export function usePushNotifications(
  authedFetch: typeof fetch = fetch,
): UsePushNotifications {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unknown">(
    "unknown",
  );
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(authedFetch);
  fetchRef.current = authedFetch;

  // Capability + initial state probe.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const s = detectPushSupport();
      if (cancelled) return;
      setSupport(s);
      if (!s.supported) return;
      setPermission(Notification.permission);
      const reg = await getSwRegistration();
      if (cancelled) return;
      if (!reg) {
        setEnabled(false);
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      if (cancelled) return;
      setEnabled(!!sub);
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const s = detectPushSupport();
      if (!s.supported) {
        setError(s.reason);
        return;
      }
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setError(
          perm === "denied"
            ? "Notifications were blocked. Re-enable them from your browser site settings, then try again."
            : "Notifications were not granted.",
        );
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const vapid = await getServerVapidKey(fetchRef.current);
      if (!vapid) {
        setError("Push notifications aren't configured on the server yet.");
        return;
      }
      // If a stale subscription exists (different VAPID key, etc.),
      // drop it before re-subscribing — PushManager throws otherwise.
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        try {
          await existing.unsubscribe();
        } catch {
          /* ignore */
        }
      }
      // PushManager wants a BufferSource backed by a plain ArrayBuffer.
      // TS narrows Uint8Array<ArrayBufferLike> away from that union, so
      // copy into a fresh ArrayBuffer to satisfy the type AND the runtime.
      const keyBytes = urlBase64ToUint8Array(vapid);
      const keyBuf = new ArrayBuffer(keyBytes.byteLength);
      new Uint8Array(keyBuf).set(keyBytes);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBuf,
      });
      await persistSubscription(fetchRef.current, sub);
      setEnabled(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't enable notifications. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const reg = await getSwRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const endpoint = sub.endpoint;
        try {
          await sub.unsubscribe();
        } catch {
          /* ignore */
        }
        try {
          await fetchRef.current(UNSUBSCRIBE_ENDPOINT, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint }),
          });
        } catch {
          /* ignore */
        }
      }
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  }, []);

  return { support, permission, enabled, busy, error, enable, disable };
}
