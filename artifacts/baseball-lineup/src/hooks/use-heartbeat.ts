import { useEffect } from "react";
import { useUser } from "@clerk/react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Fires a 60-second `POST /api/heartbeat` while the tab is visible
 * and the user is signed in. The server stamps a per-minute bucket
 * row keyed on the calling user, so the Master Admin "users" view
 * can show last-seen + total active minutes per coach.
 *
 * Idempotent: skips the ping while the tab is hidden, and the server
 * dedupes within the same minute via a primary key. Failures are
 * swallowed — heartbeats are a fire-and-forget telemetry signal,
 * never user-visible.
 */
export function useHeartbeat(): void {
  const { isSignedIn } = useUser();

  useEffect(() => {
    if (!isSignedIn) return;

    const ping = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      // Use no-store so a stale SW cache can never intercept this.
      void fetch(`${BASE}/api/heartbeat`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      }).catch(() => {
        // Network errors are expected when offline; nothing to do.
      });
    };

    // Fire one immediately so the first session minute is recorded
    // without waiting a full interval.
    ping();
    const id = window.setInterval(ping, HEARTBEAT_INTERVAL_MS);
    const onVisibility = () => {
      if (!document.hidden) ping();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isSignedIn]);
}
