import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, ConflictErrorCode } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { addConflict } from "@/lib/conflict-registry";

/**
 * Global 409 Conflict listener.
 *
 * Subscribes to the React Query MutationCache and, whenever ANY
 * mutation fails with the server's optimistic-lock 409
 * (`code: "row_version_conflict"`, emitted by the If-Match middleware),
 * records a `VersionConflict` in the conflict store and points the
 * coach at the sync chip to resolve it.
 *
 * Why a global listener rather than per-mutation `onError` handlers:
 *   - Conflict semantics are uniform — "someone else changed this
 *     row, pick which version to keep." Threading the same handler
 *     through ~25 `useMutation` call sites would balloon the diff
 *     and drift over time.
 *   - Every If-Match-guarded PATCH/DELETE emits the same 409 shape,
 *     so new mutations get conflict handling for free.
 *
 * Resolution lives in the conflict TRAY (popover on the sync-status
 * chip), not in the toast: a toast is too small for a field-by-field
 * "mine vs theirs" diff, auto-dismisses, and can't stack five
 * conflicts after a long offline drain. The toast is purely a
 * "something needs your attention — tap the chip" nudge.
 *
 * Business-state 409s (e.g. `snapshotPlan`'s "No lineup to snapshot",
 * lineup-generator lock clashes, `idempotency_in_flight` retries) are
 * ignored here — they already have their own UX. Only the explicit
 * `row_version_conflict` code triggers the conflict flow.
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

      const data = err.data as
        | { error?: string; code?: string; current?: unknown }
        | null;
      if (data?.code !== ConflictErrorCode.row_version_conflict) return;

      const mutationKey = event.mutation.options.mutationKey;
      const op =
        Array.isArray(mutationKey) && typeof mutationKey[0] === "string"
          ? mutationKey[0]
          : "unknown";

      const current =
        data.current && typeof data.current === "object"
          ? (data.current as Record<string, unknown>)
          : null;

      const conflict = addConflict({
        op,
        variables: event.mutation.state.variables,
        current,
      });

      toast({
        title: "Someone else changed this",
        description: `${conflict.label} was updated on another device while you were editing. Tap the sync chip in the header to pick which version to keep.`,
        variant: "destructive",
        duration: 12_000,
      });

      // Refresh reads so the coach compares against the live server
      // state; the pending edit itself is parked in the conflict tray.
      void qc.invalidateQueries();
    });
    return () => {
      unsubscribe();
    };
  }, [qc, toast]);

  return null;
}
