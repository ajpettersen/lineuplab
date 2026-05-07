import { Cloud, CloudOff } from "lucide-react";
import { useIsRestoring } from "@tanstack/react-query";
import { useNetworkStatus } from "@/hooks/use-network-status";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Compact chip in the top-bar telling the coach whether the iPad has
 * a working connection. Only renders something when the status is
 * actionable — when we're online and the persister has finished
 * rehydrating, we stay invisible so the chrome doesn't shout at a
 * coach with normal wifi.
 *
 * Phase 1: shows online/offline + "loading from cache" while React
 * Query rehydrates from IndexedDB.
 * Phase 2 will extend this to include a pending-mutations counter
 * once the offline write queue lands.
 */
export function SyncStatusChip() {
  const { online } = useNetworkStatus();
  const isRestoring = useIsRestoring();

  if (online && !isRestoring) {
    return null;
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="chip-sync-status"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-broadcast uppercase tracking-wider bg-amber-400/20 text-amber-100 border border-amber-300/40"
        >
          <CloudOff className="h-3 w-3" />
          Offline
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px]">
        You're offline. The Field Display will keep working and queue
        score / position changes until wifi is back. Other pages show
        whatever was loaded last.
      </TooltipContent>
    </Tooltip>
  );
}
