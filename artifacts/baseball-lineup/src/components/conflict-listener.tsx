import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Global 409 Conflict listener.
 *
 * Subscribes to the React Query MutationCache and surfaces a toast
 * whenever ANY mutation fails with a 409 Conflict from the server.
 *
 * Why a global listener rather than per-mutation `onError` handlers:
 *   - Conflict semantics are uniform — "someone else changed this
 *     row, your edit was rejected." There's no per-domain phrasing
 *     that's better than a clear "Pick which version to keep" prompt
 *     pointed at the freshest server data.
 *   - The full-app offline mode work registers ~25+ mutations with
 *     identical conflict handling; threading the same handler
 *     through each `useMutation` call site would balloon the diff
 *     and create drift over time.
 *   - When the server-side `If-Match` rollout lands (Phase 3 of the
 *     offline-mode task), every PATCH/PUT/DELETE will start emitting
 *     409s on optimistic-lock failure. This listener picks them up
 *     automatically — no per-call wiring needed.
 *
 * Toast behavior:
 *   - "Keep theirs" (default): invalidate every query so the UI
 *     refreshes to the server's current version. The coach's
 *     attempted edit is discarded.
 *   - "Try again": invalidate (so the optimistic UI snaps back to
 *     the server's version), then the coach can re-apply their
 *     edit on top of the fresh state.
 *
 * Why those two actions and not a full diff/merge UI:
 *   - This is a youth-baseball coaching tool, not a Git client.
 *     A surprised coach in the dugout needs to know "my change
 *     didn't stick" plus a one-tap way back to a known-good state,
 *     not a three-way merge.
 *   - The deeper Phase 3 work registers per-domain resolvers
 *     (e.g. attendance MERGES across devices instead of conflicting
 *     at all); this generic listener is the safe fallback for the
 *     long tail of mutations.
 *
 * Mounted once inside PersistQueryClientProvider so it shares the
 * same QueryClient instance.
 */
export function ConflictListener() {
  const qc = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = qc.getMutationCache().subscribe((event) => {
      if (event.type !== "updated") return;
      // Only fire on the transition into the `error` state, not on
      // every status broadcast (cache updates fire repeatedly).
      if (event.action.type !== "error") return;
      const err = event.action.error;
      if (!(err instanceof ApiError)) return;
      if (err.status !== 409) return;

      // Pull a human-readable hint from the error body if the server
      // bothered to send one (`{ message }` / `{ error }` shape used
      // by the rest of the API).
      const data = err.data as
        | { message?: string; error?: string; conflictType?: string }
        | null;

      // Gate on a server-emitted marker so we don't toast on
      // business-state 409s that already have their own UX (e.g.
      // `snapshotPlan` returns 409 "No lineup to snapshot"; lineup
      // generator returns 409 when locks conflict). Only when the
      // server explicitly marks the response as an optimistic-lock
      // conflict (set by the future If-Match middleware) do we show
      // the generic "pick which version" toast. Until that ships,
      // this listener is intentionally dormant — better silent than
      // wrong.
      if (data?.conflictType !== "version") return;

      const detail =
        (typeof data.message === "string" && data.message) ||
        (typeof data.error === "string" && data.error) ||
        "Someone else changed this while you were editing.";

      toast({
        title: "Edit conflicted",
        description: `${detail} The latest version has been reloaded.`,
        variant: "destructive",
        duration: 12_000,
        // When per-domain resolvers land they'll register their
        // own conflict handlers (e.g. attendance MERGES across
        // devices) that fire before this generic fallback.
        action: undefined,
      });

      void qc.invalidateQueries();
    });
    return () => {
      unsubscribe();
    };
  }, [qc, toast]);

  return null;
}
