import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bumpOfflineQueueCount } from "@/lib/offline-queue";

/**
 * Global "wifi is back" handler.
 *
 * React Query mutations using the default `networkMode: "online"` get
 * paused (not failed) while the browser is offline — they sit in
 * memory until something asks them to resume. This component listens
 * for the browser's `online` event and:
 *
 *   1. Calls `qc.resumePausedMutations()` to flush every paused
 *      mutation in the cache. Surfaces that explicitly opt out (e.g.
 *      Field Display, which uses `networkMode: "always"` and runs its
 *      own localStorage queue) are unaffected because their mutations
 *      were never paused.
 *
 *   2. Invalidates every query so freshly-resumed mutations and any
 *      server-side state changes that happened while offline get
 *      pulled back in.
 *
 *   3. Re-scans the localStorage offline queue so the SyncStatusChip
 *      reflects any drains that happened during the resume.
 *
 * Mounted once, inside PersistQueryClientProvider so it shares the
 * same QueryClient instance.
 */
export function OnlineResumer() {
  const qc = useQueryClient();
  const inFlightRef = useRef(false);

  useEffect(() => {
    const handleOnline = async () => {
      // Guard against concurrent online events firing twice in quick
      // succession (some browsers do this on captive-portal flips).
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await qc.resumePausedMutations();
        await qc.invalidateQueries();
      } finally {
        bumpOfflineQueueCount();
        inFlightRef.current = false;
      }
    };

    window.addEventListener("online", handleOnline);
    // If we boot up online with paused mutations carried over from a
    // prior run (currently mutations aren't persisted, but if Phase 3
    // turns that on this becomes the rehydration path), flush once.
    if (typeof navigator !== "undefined" && navigator.onLine) {
      void qc.resumePausedMutations();
    }
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [qc]);

  return null;
}
