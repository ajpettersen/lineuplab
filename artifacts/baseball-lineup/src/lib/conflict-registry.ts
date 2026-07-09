import { useSyncExternalStore } from "react";
import { ApiError, ConflictErrorCode } from "@workspace/api-client-react";

/**
 * Version-conflict store + per-domain resolver registry.
 *
 * When any mutation fails with the server's optimistic-lock 409
 * (`code: "row_version_conflict"`), the global <ConflictListener>
 * records a `VersionConflict` here. The sync-status chip shows a red
 * badge with the count, and the conflict tray (popover on the chip)
 * lets the coach resolve each one:
 *
 *   • "Keep mine"   — re-fire the same edit pinned to the CURRENT
 *                     server version (the one that beat us), so it
 *                     lands as a deliberate overwrite, not a race.
 *   • "Keep theirs" — drop the local edit and refetch.
 *   • "Merge"       — optional, per-domain, only for additive
 *                     collections (attendance, pitch counts, roster
 *                     lists). Registered by Phase 3 call sites.
 *
 * Resolution is per-row, not per-field, by design (see task spec).
 *
 * Resolvers are registered per operationId (the first element of the
 * generated mutation key, e.g. "updateGame") in mutation-defaults.ts
 * so registration happens exactly once at app boot.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictFieldDiff = {
  field: string;
  mine: unknown;
  theirs: unknown;
};

export type VersionConflict = {
  /** Stable id for list rendering + resolution. */
  id: string;
  /** operationId, e.g. "updateGame". */
  op: string;
  /** Human-readable subject, e.g. `Game vs. Tigers` or `Player Mia R.`. */
  label: string;
  /** The variables of the failed mutation (already deserialized). */
  variables: unknown;
  /** The row as it exists on the server NOW (from the 409 body). */
  current: Record<string, unknown> | null;
  /** Field-level diff of my patch vs the server's current values. */
  fields: ConflictFieldDiff[];
  /** Whether a registered resolver supports "Merge" for this conflict. */
  canMerge: boolean;
  at: number;
};

export type ConflictResolver = {
  /** Human label for the conflicted row, given the failed variables + current row. */
  label: (variables: never, current: Record<string, unknown> | null) => string;
  /**
   * The fields *my* edit was trying to write (used for the diff).
   * Usually `vars.data`. Return {} for deletes.
   */
  minePatch: (variables: never) => Record<string, unknown>;
  /**
   * Re-fire the edit pinned to the current server version. MUST pass
   * `If-Match: current.rowVersion` so a third device racing us still
   * conflicts rather than silently losing.
   */
  keepMine: (
    variables: never,
    current: Record<string, unknown> | null,
  ) => Promise<unknown>;
  /**
   * Optional additive merge (attendance, pitch counts, roster lists).
   * Only offered in the tray when defined AND it returns a non-null
   * merged patch for this specific pair.
   */
  merge?: (
    variables: never,
    current: Record<string, unknown> | null,
  ) => Promise<unknown> | null;
};

/**
 * True when an error is the server's optimistic-lock 409. Call sites
 * use this to SKIP their local "failed to save" toast — the global
 * <ConflictListener> already surfaced the conflict flow (toast + tray),
 * and a second destructive toast saying "failed" would read as a bug.
 */
export function isVersionConflict(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 409) return false;
  const data = err.data as { code?: string } | null;
  return data?.code === ConflictErrorCode.row_version_conflict;
}

// ---------------------------------------------------------------------------
// Resolver registry
// ---------------------------------------------------------------------------

const resolvers = new Map<string, ConflictResolver>();

export function registerConflictResolver(op: string, resolver: ConflictResolver): void {
  resolvers.set(op, resolver);
}

export function getConflictResolver(op: string): ConflictResolver | undefined {
  return resolvers.get(op);
}

// ---------------------------------------------------------------------------
// Conflict store (observable, useSyncExternalStore-friendly)
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let conflicts: VersionConflict[] = [];
let nextId = 1;

function notify(): void {
  for (const l of listeners) l();
}

/** Shallow field diff between my patch and the server's current row. */
export function diffFields(
  minePatch: Record<string, unknown>,
  current: Record<string, unknown> | null,
): ConflictFieldDiff[] {
  const out: ConflictFieldDiff[] = [];
  for (const [field, mine] of Object.entries(minePatch)) {
    if (field === "rowVersion" || mine === undefined) continue;
    const theirs = current ? current[field] : undefined;
    // Only surface fields where the values actually disagree — a coach
    // resolving a conflict cares about the contested fields, not the
    // whole payload.
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
      out.push({ field, mine, theirs });
    }
  }
  return out;
}

export function addConflict(input: {
  op: string;
  variables: unknown;
  current: Record<string, unknown> | null;
}): VersionConflict {
  const resolver = resolvers.get(input.op);
  const vars = input.variables as never;
  const minePatch = resolver ? resolver.minePatch(vars) : {};
  const conflict: VersionConflict = {
    id: `c${nextId++}`,
    op: input.op,
    label: resolver ? resolver.label(vars, input.current) : "This record",
    variables: input.variables,
    current: input.current,
    fields: diffFields(minePatch, input.current),
    canMerge: Boolean(resolver?.merge),
    at: Date.now(),
  };
  conflicts = [...conflicts, conflict];
  notify();
  return conflict;
}

export function removeConflict(id: string): void {
  const next = conflicts.filter((c) => c.id !== id);
  if (next.length !== conflicts.length) {
    conflicts = next;
    notify();
  }
}

export function getConflicts(): VersionConflict[] {
  return conflicts;
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** React hook — list of unresolved version conflicts, newest last. */
export function useConflicts(): VersionConflict[] {
  return useSyncExternalStore(subscribe, getConflicts, getConflicts);
}

// ---------------------------------------------------------------------------
// Resolution history ("Sync issues" in Settings)
// ---------------------------------------------------------------------------

export type ConflictResolutionChoice = "mine" | "theirs" | "merge";

export type ResolvedConflict = {
  /** Human-readable subject at the time of the conflict. */
  label: string;
  /** operationId, e.g. "updateGame". */
  op: string;
  /** Which version the coach kept. */
  choice: ConflictResolutionChoice;
  /** The contested field names (values are dropped — no payloads at rest). */
  fields: string[];
  /** When the conflict was resolved. */
  resolvedAt: number;
};

const HISTORY_KEY = "ll:conflict-history";
const HISTORY_MAX = 50;

const historyListeners = new Set<Listener>();
let historyCache: ResolvedConflict[] | null = null;

function readHistory(): ResolvedConflict[] {
  if (historyCache) return historyCache;
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    historyCache = Array.isArray(parsed) ? (parsed as ResolvedConflict[]) : [];
  } catch {
    historyCache = [];
  }
  return historyCache;
}

/**
 * Record how a conflict was resolved, for the Settings → Sync issues
 * audit list. Persisted per-device in localStorage (newest first,
 * capped) — this is a coach-facing "what happened" log, not server
 * data, so per-device is the right scope. Only field NAMES are kept;
 * the contested values are intentionally dropped at rest.
 */
export function logConflictResolution(
  conflict: VersionConflict,
  choice: ConflictResolutionChoice,
): void {
  const entry: ResolvedConflict = {
    label: conflict.label,
    op: conflict.op,
    choice,
    fields: conflict.fields.map((f) => f.field),
    resolvedAt: Date.now(),
  };
  historyCache = [entry, ...readHistory()].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyCache));
  } catch {
    // Quota/private-mode failure: keep the in-memory copy for this session.
  }
  for (const l of historyListeners) l();
}

export function clearConflictHistory(): void {
  historyCache = [];
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
  for (const l of historyListeners) l();
}

function subscribeHistory(l: Listener): () => void {
  historyListeners.add(l);
  return () => {
    historyListeners.delete(l);
  };
}

/** React hook — resolved-conflict history, newest first. */
export function useConflictHistory(): ResolvedConflict[] {
  return useSyncExternalStore(subscribeHistory, readHistory, () => []);
}
