import { AlertTriangle, Cloud, CloudOff, RefreshCw } from "lucide-react";
import {
  useIsMutating,
  useIsRestoring,
  useMutationState,
} from "@tanstack/react-query";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useOfflineQueueCount } from "@/lib/offline-queue";
import { useConflicts } from "@/lib/conflict-registry";
import { ConflictTray } from "@/components/conflict-tray";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Compact chip in the top-bar telling the coach the state of their
 * connection AND any unsynced work. Stays invisible when there's
 * nothing actionable to show (online, restored, no pending writes,
 * no conflicts).
 *
 * States, in priority order:
 *   1. Conflicts — N edits clashed with another device. Red badge;
 *      tapping the chip opens the conflict tray to resolve each one.
 *      Shown regardless of online/offline (resolving needs network,
 *      but the coach should SEE the count immediately).
 *   2. Restoring  — React Query is rehydrating from IndexedDB.
 *   3. Offline + N waiting — no network and N writes are staged on
 *      this device. Counts BOTH the Field Display localStorage queue
 *      AND paused React Query mutations (the new full-app offline
 *      envelope) — two different queues, one honest number.
 *   4. Offline — no network, nothing pending (still useful: tells the
 *      coach why pages won't refresh).
 *   5. Syncing N — online and either pending writes are being drained
 *      OR a mutation is in flight (e.g. a save just got triggered).
 *      The chip clears itself once the queue and mutation count both
 *      hit zero.
 *   6. Hidden — online, restored, idle. Don't shout at coaches with
 *      normal wifi.
 */
export function SyncStatusChip() {
  const { online } = useNetworkStatus();
  const isRestoring = useIsRestoring();
  const fdPendingWrites = useOfflineQueueCount();
  const isMutating = useIsMutating();
  const conflicts = useConflicts();
  // Paused mutations = writes queued by the React Query offline
  // envelope (mutation-defaults.ts) waiting for the network. They're
  // "pending" status-wise but not actively in flight, so `isMutating`
  // alone would hide them while offline.
  const pausedMutations = useMutationState({
    filters: { status: "pending" },
    select: (m) => m.state.isPaused,
  }).filter(Boolean).length;

  const pendingWrites = fdPendingWrites + pausedMutations;
  // In-flight = pending-status mutations that are NOT paused. During a
  // drain there's a brief overlap where a Field Display key is also
  // mid-POST; it just briefly inflates the syncing number, never hides
  // a real problem.
  const inFlight = Math.max(0, isMutating - pausedMutations);
  const syncingCount = fdPendingWrites + pausedMutations + inFlight;

  if (conflicts.length > 0) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="chip-sync-status"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-broadcast uppercase tracking-wider bg-red-500/25 text-red-100 border border-red-400/50 cursor-pointer hover:bg-red-500/35 transition-colors"
          >
            <AlertTriangle className="h-3 w-3" />
            {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}
            {pendingWrites > 0 ? ` · ${pendingWrites} waiting` : ""}
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-80 p-3">
          <ConflictTray />
        </PopoverContent>
      </Popover>
    );
  }

  if (isRestoring) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="chip-sync-status"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-broadcast uppercase tracking-wider bg-white/10 text-primary-foreground/80 border border-white/20"
          >
            <Cloud className="h-3 w-3 animate-pulse" />
            Loading
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Restoring your data from this device's cache.
        </TooltipContent>
      </Tooltip>
    );
  }

  if (!online) {
    const hasWaiting = pendingWrites > 0;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="chip-sync-status"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-broadcast uppercase tracking-wider bg-amber-400/20 text-amber-100 border border-amber-300/40"
          >
            <CloudOff className="h-3 w-3" />
            {hasWaiting ? `Offline · ${pendingWrites} waiting` : "Offline"}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px]">
          {hasWaiting
            ? `You're offline. ${pendingWrites} change${pendingWrites === 1 ? "" : "s"} ${pendingWrites === 1 ? "is" : "are"} saved on this device and will sync as soon as wifi returns.`
            : "You're offline. Changes you make are saved on this device and sync automatically when wifi is back."}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (syncingCount > 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="chip-sync-status"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-broadcast uppercase tracking-wider bg-sky-400/20 text-sky-100 border border-sky-300/40"
          >
            <RefreshCw className="h-3 w-3 animate-spin" />
            Syncing {syncingCount}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Sending {syncingCount} pending change{syncingCount === 1 ? "" : "s"}{" "}
          to the server.
        </TooltipContent>
      </Tooltip>
    );
  }

  return null;
}
