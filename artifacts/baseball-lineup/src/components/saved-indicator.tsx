import { useEffect, useState } from "react";
import { Check, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact status chip showing whether the current page's data is
 * persisted on the server. Three visible states:
 *   - "Saving…"      — a save is in-flight
 *   - "Saved"        — most recent save succeeded; shows relative age
 *   - "Save failed"  — last save errored (mutation.isError)
 *
 * Drives off a react-query mutation object so the chip stays in sync
 * with whatever save path the page uses (e.g. `useSaveLineup`). Pass
 * `lastSavedAt` if you want the "Saved Xs ago" timestamp to reflect
 * historical saves (e.g. data loaded on first paint); otherwise the
 * chip only shows after the first save in this session.
 *
 * Why a constant indicator: auto-save means coaches don't click "Save"
 * anymore — so the only signal that work is durable is this chip. It's
 * the difference between "I had to redo it on iPad" and "I can see it
 * saved at 3:42pm".
 */
export function SavedIndicator({
  isPending,
  isError,
  lastSavedAt,
  className,
}: {
  isPending: boolean;
  isError: boolean;
  lastSavedAt: Date | number | null;
  className?: string;
}) {
  // Re-render every 30s so the relative timestamp ("2m ago") stays
  // accurate without each parent needing to poll.
  const [, force] = useState(0);
  useEffect(() => {
    if (!lastSavedAt || isPending) return;
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [lastSavedAt, isPending]);

  if (isPending) {
    return (
      <span
        data-testid="indicator-saving"
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    );
  }

  if (isError) {
    return (
      <span
        data-testid="indicator-save-error"
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-destructive",
          className,
        )}
      >
        <CloudOff className="h-3 w-3" />
        Save failed
      </span>
    );
  }

  if (!lastSavedAt) return null;

  const savedMs = typeof lastSavedAt === "number" ? lastSavedAt : lastSavedAt.getTime();
  const age = Math.max(0, Date.now() - savedMs);
  const label = formatSavedAge(age);

  return (
    <span
      data-testid="indicator-saved"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
      title={new Date(savedMs).toLocaleString()}
    >
      <Check className="h-3 w-3 text-emerald-600" />
      Saved {label}
    </span>
  );
}

/**
 * Compact relative-time formatter biased for the "I just clicked
 * save" case. Returns "just now" for <10s and rolls up to minutes /
 * hours / days. Deliberately avoids date-fns so this component stays
 * usable in tiny chunks without pulling in a locale bundle.
 */
function formatSavedAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
