import { createContext, useContext, useEffect, useState } from "react";

/**
 * "Offline fallback" mode: the device has no connection AND Clerk reports
 * signed-out (its session couldn't be refreshed, or Safari evicted the
 * site's storage). Without this, a coach at a field with no signal gets
 * bounced to a sign-in screen they can't complete — with a full local
 * cache of their team sitting unused on the device.
 *
 * In this mode we render the normal app from the persisted React Query
 * cache but force read-only (see usePermission), so nothing is queued
 * that would need an auth token we don't have. Signing in again, once
 * back online, restores full access.
 */

const SESSION_HINT_KEY = "lineupLab.hadSession.v1";

/** Remember that this device has been signed in, so we can trust its cache later. */
export function rememberSignedIn(): void {
  try {
    localStorage.setItem(SESSION_HINT_KEY, String(Date.now()));
  } catch {
    // Private mode / storage disabled — fallback simply won't kick in.
  }
}

export function forgetSignedIn(): void {
  try {
    localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // ignore
  }
}

export function hadSessionOnThisDevice(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) != null;
  } catch {
    return false;
  }
}

export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return offline;
}

/** True inside the signed-out-but-offline tree (set by App). */
export const OfflineFallbackContext = createContext(false);

export function useOfflineFallback(): boolean {
  return useContext(OfflineFallbackContext);
}
