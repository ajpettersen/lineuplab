import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useOfflineFallback } from "@/lib/offline-session";

/**
 * Thin banner under the header shown ONLY while offline: tells the
 * coach they're looking at saved data and how old it is. Pages render
 * from the persisted React Query cache when offline, so "how old" is
 * the newest successful `dataUpdatedAt` across cached queries — the
 * moment we last heard from the server about anything.
 *
 * Lives in <Layout> so every in-shell page gets it for free. Field
 * Display (outside the shell) has its own offline affordances and
 * intentionally doesn't show this.
 */
export function OfflineBanner() {
  const { online } = useNetworkStatus();
  // Offline AND signed out: the cached team is readable but nothing can
  // be written, so say so rather than promising the edits will sync.
  const signedOut = useOfflineFallback();
  const qc = useQueryClient();
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (online) {
      setLabel(null);
      return;
    }
    const compute = () => {
      let newest = 0;
      for (const q of qc.getQueryCache().getAll()) {
        const t = q.state.dataUpdatedAt;
        if (t > newest) newest = t;
      }
      if (!newest) {
        setLabel("You're offline — showing saved data");
        return;
      }
      const mins = Math.max(0, Math.round((Date.now() - newest) / 60000));
      setLabel(
        mins < 1
          ? "You're offline — showing data from moments ago"
          : mins < 60
            ? `You're offline — showing data from ${mins} min ago`
            : `You're offline — showing data from ${Math.round(mins / 60)}h ago`,
      );
    };
    compute();
    // Refresh the "N min ago" once a minute while offline.
    const id = window.setInterval(compute, 60_000);
    return () => window.clearInterval(id);
  }, [online, qc]);

  if (online || !label) return null;

  return (
    <div
      data-testid="banner-offline"
      className="bg-amber-400/15 text-amber-900 dark:text-amber-100 border-b border-amber-300/40 text-xs font-medium px-4 py-1.5 flex items-center justify-center gap-1.5"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" />
      <span>
        {label}.{" "}
        {signedOut
          ? "Your sign-in expired, so this is view-only — sign in again once you're back online."
          : "Your changes are saved on this device and sync when wifi returns."}
      </span>
    </div>
  );
}
