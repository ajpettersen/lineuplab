import { useSyncExternalStore } from "react";

/**
 * Tiny observable that tracks how many user-initiated writes are
 * waiting to leave the device.
 *
 * Phase 1 already shipped per-page offline queues (see field-display.tsx
 * which stages lineup snapshots and game-record patches in localStorage
 * until wifi is back). Phase 2's job is to make those writes VISIBLE in
 * the global header chrome, and to give the rest of the app a single
 * counter to publish to as more surfaces grow offline support.
 *
 * Sources of pending writes counted today:
 *   1. Field Display localStorage keys (`fd-pending-save-v1:*` and
 *      `fd-pending-game-patch-v1:*`). Scanned on import + on every
 *      `bumpOfflineQueueCount()` call. Cross-tab updates are picked up
 *      via the `storage` event so the chip in tab A reflects a save
 *      drained in tab B.
 *
 * Future sources (wired by callers as new offline-capable mutations
 * land) can simply call `bumpOfflineQueueCount()` after writing /
 * clearing their own pending records — there is no per-source
 * registration; we re-scan localStorage on every bump.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let cachedCount = 0;

/** localStorage key patterns that represent an unsynced user write. */
const PENDING_KEY_PATTERNS: RegExp[] = [
  /^fd-pending-save-v1:\d+$/,
  /^fd-pending-game-patch-v1:\d+$/,
];

/** True if this localStorage key represents an unsynced offline write. */
export function isPendingWriteKey(key: string): boolean {
  return PENDING_KEY_PATTERNS.some((r) => r.test(key));
}

function scanLocalStorage(): number {
  if (typeof localStorage === "undefined") return 0;
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isPendingWriteKey(k)) n++;
    }
  } catch {
    // Private mode / disabled storage — treat as zero.
    return 0;
  }
  return n;
}

function notify() {
  for (const l of listeners) l();
}

/**
 * Re-scan localStorage and notify subscribers if the count changed.
 * Safe to call on every write/clear — cheap (a handful of keys).
 */
export function bumpOfflineQueueCount(): void {
  const next = scanLocalStorage();
  if (next !== cachedCount) {
    cachedCount = next;
    notify();
  }
}

export function getOfflineQueueCount(): number {
  return cachedCount;
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

if (typeof window !== "undefined") {
  cachedCount = scanLocalStorage();
  // Cross-tab: another tab clearing a pending key (e.g. drain) should
  // refresh this tab's count immediately so the chip stays accurate.
  window.addEventListener("storage", (e) => {
    if (!e.key || isPendingWriteKey(e.key)) bumpOfflineQueueCount();
  });
}

/**
 * React hook returning the current offline-write queue size. Re-renders
 * the consumer whenever a write is staged or drained.
 */
export function useOfflineQueueCount(): number {
  return useSyncExternalStore(subscribe, getOfflineQueueCount, () => 0);
}
