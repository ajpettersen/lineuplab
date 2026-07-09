/**
 * Sync envelope — per-mutation metadata that rides INSIDE the mutation
 * variables so it survives React Query's IndexedDB persistence and is
 * replayed byte-for-byte after an offline reload.
 *
 * Two headers come out of this envelope:
 *
 *   • `Idempotency-Key` — a client-generated UUID stamped when the coach
 *     first clicks (NOT when the request finally fires). If a create's
 *     response is lost mid-flight (flaky field WiFi) and the queue
 *     re-fires it, the server's idempotency table replays the cached
 *     201 instead of inserting a duplicate row.
 *
 *   • `If-Match` — the `rowVersion` of the row as the coach SAW it when
 *     they made the edit. If another device changed the row while this
 *     one was offline, the server answers 409 + the current row instead
 *     of silently overwriting — the conflict tray takes it from there.
 *
 * Why the envelope lives in `variables` and not in the fetch layer:
 * React Query only persists a mutation's KEY + VARIABLES + STATE. A
 * UUID minted inside `mutationFn` (or a fetch interceptor) would be
 * re-minted on every replay, defeating idempotency. Stamping it into
 * the variables at `mutate()` time is the only place it persists.
 *
 * Excluded on purpose (same rules as mutation-defaults.ts):
 *   - Field Display's localStorage queue — it has its own envelope and
 *     last-writer-wins policy; adding If-Match there would break
 *     mid-game saves over stale cached versions.
 *   - AI + file-upload mutations — never queued offline at all.
 */

export type SyncMeta = {
  /** Client-minted UUID, stable across replays of this mutation. */
  key: string;
  /** rowVersion the coach's edit was based on; undefined = last-writer-wins. */
  ifMatch?: number;
};

/** Variables shape for mutations that carry a sync envelope. */
export type WithSync<V> = V & { _sync?: SyncMeta };

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Older WebKit fallback — collision odds are irrelevant at this scale.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Mint a new envelope at `mutate()` time. Pass the row's cached
 * `rowVersion` when editing an existing row; omit for creates.
 */
export function newSyncMeta(ifMatch?: number): SyncMeta {
  return ifMatch === undefined ? { key: uuid() } : { key: uuid(), ifMatch };
}

/**
 * Convenience for call sites: `mutate(withSync({ id, data }, row.rowVersion))`.
 */
export function withSync<V extends object>(vars: V, ifMatch?: number): WithSync<V> {
  return { ...vars, _sync: newSyncMeta(ifMatch) };
}

/**
 * Turn an envelope into the `RequestInit` accepted by every generated
 * client function. Returns `undefined` when there's no envelope so
 * un-migrated call sites keep today's exact request shape.
 */
export function syncRequestInit(sync?: SyncMeta): RequestInit | undefined {
  if (!sync) return undefined;
  const headers: Record<string, string> = { "Idempotency-Key": sync.key };
  if (sync.ifMatch !== undefined) headers["If-Match"] = String(sync.ifMatch);
  return { headers };
}
