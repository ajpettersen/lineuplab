import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bumpOfflineQueueCount } from "@/lib/offline-queue";
import { drainOfflineWrites } from "@/lib/offline-drain";

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
 *   2. Drains the localStorage offline write queue (`drainOfflineWrites`).
 *      This is the cross-page version of the field-display's per-page
 *      flushSave / flushGameSave — it runs whether or not the field
 *      display is mounted, so a coach who exits the field display
 *      while still offline doesn't strand their pending writes. CRITICALLY,
 *      this also runs BEFORE step 3 to fix a race that used to cause
 *      offline edits to silently revert: if invalidateQueries fired
 *      first, its background GETs would return stale server data and
 *      clobber the optimistic UI before the queued POSTs could land.
 *      Now the POSTs go out first; the GETs that follow return server
 *      state that already includes the writes.
 *
 *   3. Invalidates every query so freshly-resumed mutations and any
 *      server-side state changes that happened while offline get
 *      pulled back in.
 *
 *   4. Re-scans the localStorage offline queue so the SyncStatusChip
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
        // Drain pending localStorage writes BEFORE invalidating —
        // see step 2 in the docblock above for the race-condition
        // rationale. drainOfflineWrites has its own mutex so this
        // is safe to call even if the field-display's per-page
        // listener is firing concurrently.
        await drainOfflineWrites();
        await qc.invalidateQueries();
      } finally {
        bumpOfflineQueueCount();
        inFlightRef.current = false;
      }
    };

    window.addEventListener("online", handleOnline);
    // Boot path: drain localStorage writes left over from a prior
    // offline session. (Resuming rehydrated paused mutations is
    // handled by PersistQueryClientProvider's `onSuccess` callback
    // in App.tsx — that fires AFTER async IndexedDB rehydration, so
    // it's the only place we know the MutationCache has actually
    // been populated. Doing it here would race the rehydrate and
    // silently no-op until the next `online` event.)
    if (typeof navigator !== "undefined" && navigator.onLine) {
      void drainOfflineWrites().then(() => {
        bumpOfflineQueueCount();
      });
    }
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [qc]);

  return null;
}
