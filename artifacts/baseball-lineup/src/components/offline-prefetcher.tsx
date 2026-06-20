import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import {
  prefetchOfflineData,
  OFFLINE_RESUME_COMPLETE_EVENT,
} from "@/lib/prefetch-offline";

/**
 * Proactively warms the offline cache (see prefetch-offline.ts) so a
 * coach can open the Field Display for an upcoming game with no signal,
 * even if they never tapped into it while online.
 *
 * Warming runs:
 *   • On sign-in / boot (once auth is ready).
 *   • Whenever OnlineResumer fires OFFLINE_RESUME_COMPLETE_EVENT — after
 *     it drains the offline write queue (and, on reconnect, invalidates
 *     queries). This re-warms games that were skipped on the previous
 *     pass because they still had unsynced edits.
 *
 * prefetchOfflineData is inherently race-safe: it skips any game that
 * currently has a pending offline write, so warming can run at any time
 * without clobbering optimistic Field Display state — no event-ordering
 * handshake required. It's also self-guarded (no-op offline, single
 * shared in-flight pass), so the repeated triggers are cheap.
 *
 * Gated on `isSignedIn` because the games/roster endpoints require auth;
 * running while signed out would just 401.
 *
 * Mounted once inside PersistQueryClientProvider + ClerkProvider so it
 * shares the same QueryClient and sees Clerk auth state.
 */
export function OfflinePrefetcher() {
  const qc = useQueryClient();
  const { isSignedIn } = useAuth();

  useEffect(() => {
    if (!isSignedIn) return;

    void prefetchOfflineData(qc);

    const handleResumeComplete = () => {
      void prefetchOfflineData(qc);
    };
    window.addEventListener(OFFLINE_RESUME_COMPLETE_EVENT, handleResumeComplete);
    return () => {
      window.removeEventListener(
        OFFLINE_RESUME_COMPLETE_EVENT,
        handleResumeComplete,
      );
    };
  }, [qc, isSignedIn]);

  return null;
}
