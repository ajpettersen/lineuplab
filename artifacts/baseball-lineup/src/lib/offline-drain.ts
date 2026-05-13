import {
  saveLineup,
  updateGame,
  type LineupEntry,
  type UpdateGameBody,
} from "@workspace/api-client-react";
import { bumpOfflineQueueCount, isPendingWriteKey } from "./offline-queue";

/**
 * Cross-page drain of the offline write queue.
 *
 * Field Display has its own per-page flushSave / flushGameSave that
 * runs while the page is mounted. That's not enough on its own — a
 * coach who exits the field display while still offline (e.g. heads
 * to the parking lot, swipes to the schedule, then their phone
 * reconnects somewhere else in the app) would otherwise leave their
 * pending writes stranded in localStorage until they returned to the
 * field display.
 *
 * This module hoists the drain so the App-level <OnlineResumer> can
 * fire it on every reconnect, regardless of which page is mounted.
 *
 * Equally important: <OnlineResumer> calls qc.invalidateQueries() on
 * the same `online` event, which used to race the field-display's
 * flushSave and clobber optimistic state with stale GETs. By
 * draining BEFORE invalidating, the GETs return server data that
 * already reflects the queued writes, eliminating the race.
 *
 * Fault model:
 *   • Mutex (single in-flight chain) so a concurrent field-display
 *     flushSave doesn't double-POST the same key.
 *   • Per-key try/catch — a failed POST leaves THAT key intact (so
 *     the next online event retries it) but doesn't poison the
 *     queue for sibling keys.
 *   • Auth & base URL are handled by `customFetch` (which the
 *     generated `saveLineup` / `updateGame` go through), so this
 *     module doesn't need to know anything about Clerk session
 *     cookies — they ride along automatically because the request
 *     is same-origin to the API server.
 */

const PENDING_LINEUP_RE = /^fd-pending-save-v1:(\d+)$/;
const PENDING_GAME_PATCH_RE = /^fd-pending-game-patch-v1:(\d+)$/;

type DrainItem =
  | { kind: "lineup"; storageKey: string; gameId: number; entries: LineupEntry[] }
  | { kind: "gamePatch"; storageKey: string; gameId: number; patch: UpdateGameBody };

let drainPromise: Promise<void> | null = null;

function safeParse<T>(raw: string | null): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function snapshotPending(): DrainItem[] {
  if (typeof localStorage === "undefined") return [];
  const items: DrainItem[] = [];
  // Snapshot keys first so we don't race with concurrent writes that
  // mutate localStorage's iteration order mid-loop.
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isPendingWriteKey(k)) keys.push(k);
    }
  } catch {
    return [];
  }
  for (const key of keys) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      continue;
    }
    if (raw == null) continue;

    const lineupMatch = key.match(PENDING_LINEUP_RE);
    if (lineupMatch) {
      const entries = safeParse<LineupEntry[]>(raw);
      if (Array.isArray(entries) && entries.length > 0) {
        items.push({
          kind: "lineup",
          storageKey: key,
          gameId: Number(lineupMatch[1]),
          entries,
        });
      }
      continue;
    }

    const patchMatch = key.match(PENDING_GAME_PATCH_RE);
    if (patchMatch) {
      const patch = safeParse<UpdateGameBody>(raw);
      if (patch && typeof patch === "object") {
        items.push({
          kind: "gamePatch",
          storageKey: key,
          gameId: Number(patchMatch[1]),
          patch,
        });
      }
      continue;
    }
  }
  return items;
}

function clearKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore — private mode / quota — count will self-correct on
    // next bump.
  }
}

async function postLineup(item: Extract<DrainItem, { kind: "lineup" }>): Promise<void> {
  await saveLineup(item.gameId, {
    entries: item.entries.map((e) => ({
      playerId: e.playerId,
      inning: e.inning,
      position: e.position,
      battingOrder: e.battingOrder ?? null,
    })),
  });
}

async function postGamePatch(item: Extract<DrainItem, { kind: "gamePatch" }>): Promise<void> {
  await updateGame(item.gameId, item.patch);
}

async function runDrain(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  const items = snapshotPending();
  if (items.length === 0) return;

  for (const item of items) {
    // Re-read the raw value RIGHT BEFORE posting so we pick up any
    // newer writes the field-display's flushSave queued during this
    // drain (last-writer-wins). If the value disappeared (because
    // the page-level drain already cleared it), skip — nothing to
    // do.
    let currentRaw: string | null = null;
    try {
      currentRaw = localStorage.getItem(item.storageKey);
    } catch {
      continue;
    }
    if (currentRaw == null) continue;

    try {
      if (item.kind === "lineup") {
        const entries = safeParse<LineupEntry[]>(currentRaw);
        if (!Array.isArray(entries) || entries.length === 0) {
          clearKey(item.storageKey);
          continue;
        }
        await postLineup({ ...item, entries });
      } else {
        const patch = safeParse<UpdateGameBody>(currentRaw);
        if (!patch) {
          clearKey(item.storageKey);
          continue;
        }
        await postGamePatch({ ...item, patch });
      }

      // Success: only clear if the value hasn't changed under us
      // since we read currentRaw. If it has, leave the new value in
      // place for the next drain pass — we just successfully posted
      // a now-superseded snapshot, but the next pass picks up the
      // newer one.
      let postRaw: string | null = null;
      try {
        postRaw = localStorage.getItem(item.storageKey);
      } catch {
        // fall through and skip the clear
      }
      if (postRaw === currentRaw) {
        clearKey(item.storageKey);
        bumpOfflineQueueCount();
      }
    } catch {
      // Leave the key in localStorage for the next online flip /
      // page-level retry. Don't bump count (count is unchanged).
    }
  }
}

/**
 * Drain all pending offline writes. Safe to call repeatedly and
 * concurrently — a single in-flight chain coalesces overlapping
 * callers so the same key is never POSTed twice in parallel.
 *
 * Returns when the in-flight drain has finished. Callers that need
 * to sequence work AFTER the drain (e.g. invalidating queries) should
 * `await` this.
 */
export function drainOfflineWrites(): Promise<void> {
  if (drainPromise) return drainPromise;
  drainPromise = runDrain().finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}
