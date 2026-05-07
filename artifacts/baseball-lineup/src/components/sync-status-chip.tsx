import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { useIsMutating, useIsRestoring } from "@tanstack/react-query";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useOfflineQueueCount } from "@/lib/offline-queue";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Compact chip in the top-bar telling the coach the state of their
 * connection AND any unsynced work. Stays invisible when there's
 * nothing actionable to show (online, restored, no pending writes).
 *
 * States, in priority order:
 *   1. Restoring  — React Query is rehydrating from IndexedDB.
 *   2. Offline + N waiting — no network and N writes are staged on
 *      this device (Field Display lineup / score patches today; future
 *      surfaces opt in via `bumpOfflineQueueCount()`).
 *   3. Offline — no network, nothing pending (still useful: tells the
 *      coach why pages won't refresh).
 *   4. Syncing N — online and either pending writes are being drained
 *      OR a mutation is in flight (e.g. a save just got triggered).
 *      The chip clears itself once the queue and mutation count both
 *      hit zero.
 *   5. Hidden — online, restored, idle. Don't shout at coaches with
 *      normal wifi.
 */
export function SyncStatusChip() {
  const { online } = useNetworkStatus();
  const isRestoring = useIsRestoring();
  const pendingWrites = useOfflineQueueCount();
  const isMutating = useIsMutating();
  // Mutations in flight that aren't already represented in the
  // localStorage pending queue (best-effort — there's a brief overlap
  // during drain where both could count the same save, but it lasts
  // <1s so it just briefly inflates the syncing number, never hides
  // a real problem).
  const syncingCount = pendingWrites + (isMutating > 0 ? isMutating : 0);

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
            : "You're offline. The Field Display will keep working and queue score / position changes until wifi is back. Other pages show whatever was loaded last."}
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
