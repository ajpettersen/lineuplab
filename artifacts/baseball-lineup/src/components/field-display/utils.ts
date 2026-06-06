import { bumpOfflineQueueCount, isPendingWriteKey } from "@/lib/offline-queue";
import type { LightingMode } from "./types";

export function getLightingMode(gameDate: string | undefined): LightingMode {
  if (!gameDate) return "day";
  const d = new Date(gameDate);
  if (Number.isNaN(d.getTime())) return "day";
  const h = d.getHours();
  if (h >= 5 && h < 9) return "morning";
  if (h >= 9 && h < 16) return "day";
  if (h >= 16 && h < 19) return "evening";
  return "night";
}

/**
 * Human-friendly "saved Xs/Xm/Xh ago" formatter for the connection badge.
 * Kept simple and dependency-free — date-fns is already in the bundle but
 * formatDistanceToNow's "less than a minute" / "about an hour" wording
 * reads awkward at a glance from the dugout. Coaches need a number, fast.
 */
export function formatSavedAgo(ts: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/** localStorage with try/catch so private mode / quota errors don't crash. */
export function loadJSON<T>(key: string): T | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

// Module-level quota-error listener. Set by the FieldDisplay component
// on mount so we can surface a one-time toast when localStorage refuses
// a write (private mode, full disk, iPad capped). Module scope means we
// don't have to thread a callback through every saveJSON caller, and the
// listener is naturally torn down on unmount.
let quotaErrorListener: (() => void) | null = null;
export function setQuotaErrorListener(fn: (() => void) | null): void {
  quotaErrorListener = fn;
}

export function saveJSON(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
    // If this write touched a pending-write key, let the global
    // SyncStatusChip update its counter immediately. Cheap; only a
    // handful of localStorage keys to scan.
    if (isPendingWriteKey(key)) bumpOfflineQueueCount();
  } catch (err) {
    // Quota exceeded / private mode — surface a one-time warning so the
    // coach knows offline edits won't survive a refresh, then degrade
    // silently. The in-memory React Query cache + pendingLineupRef still
    // work for this session.
    if (
      quotaErrorListener &&
      err instanceof Error &&
      /quota|exceeded|storage/i.test(`${err.name} ${err.message}`)
    ) {
      try {
        quotaErrorListener();
      } catch {
        // never let the listener throw past us
      }
    }
  }
}

export function clearKey(key: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
    if (isPendingWriteKey(key)) bumpOfflineQueueCount();
  } catch {
    // ignored
  }
}
