import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";

const PERSIST_KEY = "lineupLab.queryCache.v1";

/**
 * IndexedDB-backed storage adapter for React Query persistence.
 *
 * We deliberately do NOT use localStorage — coaches at a tournament
 * may have weeks of cached games + lineups + rosters, easily blowing
 * past the ~5 MB localStorage budget on iPadOS Safari. IndexedDB has
 * an effectively unbounded quota (subject to overall site eviction)
 * and async access avoids jank on the main thread.
 *
 * Service worker (vite-plugin-pwa) handles the app SHELL while this
 * persister handles the DATA cache. The two are intentionally
 * orthogonal: the SW lets the page open with no network, and this
 * persister means it has something to render once it's open.
 */
const indexedDbStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const value = await get<string>(key);
    return value ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    await del(key);
  },
};

export const queryPersister = createAsyncStoragePersister({
  storage: indexedDbStorage,
  key: PERSIST_KEY,
  // Keep cache for 14 days — covers a tournament weekend + the
  // following recovery week without surprising the coach with stale
  // data months later.
  throttleTime: 1000,
});

/**
 * Hard-purge the persisted cache. Call this whenever the signed-in
 * user changes — qc.clear() empties the in-memory cache but the
 * persister's 1s write throttle means a stale dehydrate from the
 * previous user can still hit IndexedDB *after* the clear, leaking
 * data into the next sign-in on a shared iPad. Deleting the IDB
 * entry directly sidesteps that race; the persister will start
 * fresh on its next write.
 */
export async function purgePersistedQueryCache(): Promise<void> {
  await del(PERSIST_KEY);
}

// Bumping this string invalidates ALL persisted caches across users
// (e.g. when we change a query shape that would otherwise crash on
// rehydrate). Keep in sync with breaking changes to query payloads.
export const PERSIST_BUSTER = "v1.0.0";

export const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 14; // 14 days
