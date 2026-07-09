import type { QueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createGame,
  createPlayer,
  createPractice,
  createTournament,
  updateGame,
  snapshotPlan,
  clearPlanSnapshot,
  saveLineup,
  dismissDashboardTask,
  updatePlayer,
  updateTeamSettings,
  completeOnboarding,
  updatePreferences,
  updateTournament,
  upsertGamePitchCount,
  saveBoxScore,
  updatePractice,
  replacePracticeAttendance,
  deleteGame,
  deletePlayer,
  deletePractice,
  deleteTournament,
  deleteGamePitchCount,
  deleteBoxScore,
  type CreateGameBody,
  type CreatePlayerBody,
  type CreatePracticeBody,
  type CreateTournamentBody,
  type UpdateGameBody,
  type SaveLineupBody,
  type DismissDashboardTaskBody,
  type UpdatePlayerBody,
  type UpdateTeamSettingsBody,
  type UpdatePreferencesBody,
  type UpdateTournamentBody,
  type UpsertPitchCountBody,
  type SaveBoxScoreBody,
  type UpdatePracticeBody,
  type ReplaceAttendanceBody,
} from "@workspace/api-client-react";
import {
  getListGamesQueryKey,
  getGetGameQueryKey,
  getListPlayersQueryKey,
  getGetPlayerQueryKey,
  getListPracticesQueryKey,
  getGetPracticeQueryKey,
  getListTournamentsQueryKey,
  getGetTournamentQueryKey,
  getGetTeamSettingsQueryKey,
  getGetPreferencesQueryKey,
} from "@workspace/api-client-react";
import {
  newSyncMeta,
  syncRequestInit,
  type WithSync,
} from "./sync-envelope";
import { registerConflictResolver } from "./conflict-registry";

/**
 * Register `mutationFn` defaults for offline-relevant mutations so
 * paused-then-rehydrated mutations can resume after a reload.
 *
 * Why this exists: React Query's `PersistQueryClientProvider` can
 * persist mutations to IndexedDB, but rehydrated mutations only carry
 * their KEY + VARIABLES + STATE — not their callable `mutationFn`.
 * For `qc.resumePausedMutations()` to actually fire the request, the
 * client needs to find a matching default registered via
 * `setMutationDefaults` whose key prefix-matches the persisted key.
 *
 * Sync envelope: every mutationFn here honors an optional `_sync`
 * field inside its variables (see sync-envelope.ts). Because `_sync`
 * lives IN the persisted variables, the Idempotency-Key and If-Match
 * values survive a reload and replay identically. Call sites opt in
 * with `mutate(withSync(vars, row.rowVersion))`; un-migrated call
 * sites send no envelope and keep today's last-writer-wins behavior.
 *
 * Scope: this is the allowlist of mutations whose paused-offline
 * state is safe to dehydrate, persist across reloads, and replay
 * automatically when the iPad comes back online. Each one must be:
 *   - replay-safe (server-side REPLACE semantics, an Idempotency-Key
 *     envelope, or a 404-tolerant delete — see below)
 *   - free of unserializable variables (Files, Blobs, etc.)
 *   - safe to re-run minutes-to-hours after the original click
 *
 * CREATEs (createGame, createPlayer, createPractice, createTournament)
 * are now included: the server's idempotency middleware replays the
 * cached 2xx for a duplicate Idempotency-Key instead of inserting a
 * second row. A create queued WITHOUT an envelope (legacy call site)
 * is still replayed at-least-once — Phase 3 migrates every create
 * call site to `withSync()` so the key is always present.
 *
 * DELETEs (deleteGame, deletePlayer, deletePractice, deleteTournament,
 * deleteGamePitchCount, deleteBoxScore) are included with a
 * 404-tolerant wrapper: if the server already processed the delete
 * (response lost mid-flight, or another device deleted the same row),
 * the replayed DELETE's 404 is treated as terminal success instead of
 * surfacing a misleading "couldn't delete" toast.
 *
 * NOT included on purpose:
 *   - Field Display's `saveLineup` / `updateGame` mutations are
 *     declared with `networkMode: "always"` (so they NEVER pause)
 *     AND are backed by their own localStorage queue + the global
 *     `offline-drain` helper. Persisting them here too would either
 *     no-op (paused-only dehydrate predicate) or double-fire.
 *     Non-field-display callers of `useUpdateGame` / `useSaveLineup`
 *     (e.g. game-detail's quick-edit dialog) DO benefit, because
 *     they use the default `networkMode: "online"` and pause when
 *     the network drops. Field Display's queue also intentionally
 *     carries NO If-Match — mid-game saves are last-writer-wins.
 *   - AI routes: `generateLineup`, `generatePracticePlan`,
 *     `extractBoxScore`, `extractTournamentPoolPlay*`, image roster
 *     import. Non-deterministic, expensive, and out of scope —
 *     replaying a queued AI call hours later would surprise the
 *     coach and waste budget.
 *   - Anything that uploads a File / Blob (image roster import,
 *     box-score image extract) — those bytes can't survive a reload.
 *   - Tournament-network mutations (join/leave/membership) — they
 *     talk to a shared cross-team surface where a stale replay could
 *     act on a network the coach already left in another tab.
 *
 * Mutation keys come from Orval's generated
 * `get<Op>MutationOptions()` — they're the operationId in array
 * form (e.g. `["updateGame"]`). Grep `mutationKey = ` in
 * `lib/api-client-react/src/generated/api.ts` to see the full list.
 */

/**
 * Treat a 404 on a replayed DELETE as success: the row is gone, which
 * is exactly what the coach asked for. Every other error propagates.
 */
async function tolerate404<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Centralized optimistic updates
// ---------------------------------------------------------------------------
//
// Offline edits must show up in the UI IMMEDIATELY — a paused mutation's
// onSuccess/invalidate won't run until the network returns, which could
// be hours later at a field. So the update/delete defaults below patch
// the query cache optimistically in `onMutate`, roll back on error, and
// invalidate on settle (which, for a paused mutation, happens after the
// eventual replay — exactly when fresh server truth is reachable again).
//
// These live HERE (not at call sites) so every page gets the same
// behavior for free and rehydrated mutations share one code path. A call
// site that passes its own `onMutate` via hook options would override
// the default — don't do that for these ops; use the side callbacks on
// `mutate(vars, { onSuccess, onError })`, which compose fine.

type Snapshot = Array<[readonly unknown[], unknown]>;
type OptimisticCtx = { snapshots: Snapshot };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Optimistic UPDATE: merge `vars.data` into the matching row in the
 * list cache and into the detail cache. Also bumps `rowVersion`
 * locally so a SECOND offline edit to the same row pins to the
 * version its queued predecessor will produce, not the stale one.
 */
function optimisticUpdate(
  qc: QueryClient,
  listKey: readonly unknown[],
  detailKey: (id: number) => readonly unknown[],
) {
  return {
    onMutate: async (vars: { id: number; data: unknown }): Promise<OptimisticCtx> => {
      const dKey = detailKey(vars.id);
      await Promise.all([
        qc.cancelQueries({ queryKey: listKey }),
        qc.cancelQueries({ queryKey: dKey }),
      ]);
      const snapshots: Snapshot = [
        [listKey, qc.getQueryData(listKey)],
        [dKey, qc.getQueryData(dKey)],
      ];
      const patch = isRecord(vars.data) ? vars.data : {};
      const mergeRow = (row: Record<string, unknown>) => ({
        ...row,
        ...patch,
        rowVersion:
          typeof row.rowVersion === "number" ? row.rowVersion + 1 : row.rowVersion,
      });
      qc.setQueryData(listKey, (old: unknown) =>
        Array.isArray(old)
          ? old.map((row) =>
              isRecord(row) && row.id === vars.id ? mergeRow(row) : row,
            )
          : old,
      );
      qc.setQueryData(dKey, (old: unknown) =>
        isRecord(old) ? mergeRow(old) : old,
      );
      return { snapshots };
    },
    onError: (_e: unknown, _v: unknown, ctx?: OptimisticCtx) => {
      restoreSnapshots(qc, ctx);
    },
    onSettled: (_d: unknown, _e: unknown, vars: { id: number }) => {
      void qc.invalidateQueries({ queryKey: listKey });
      void qc.invalidateQueries({ queryKey: detailKey(vars.id) });
    },
  };
}

/**
 * Optimistic DELETE: drop the row from the list cache immediately.
 * The detail cache is left alone (the page navigates away / the row
 * is soft-deleted server-side and restorable via the Undo toast).
 */
function optimisticDelete(qc: QueryClient, listKey: readonly unknown[]) {
  return {
    onMutate: async (vars: { id: number }): Promise<OptimisticCtx> => {
      await qc.cancelQueries({ queryKey: listKey });
      const snapshots: Snapshot = [[listKey, qc.getQueryData(listKey)]];
      qc.setQueryData(listKey, (old: unknown) =>
        Array.isArray(old)
          ? old.filter((row) => !(isRecord(row) && row.id === vars.id))
          : old,
      );
      return { snapshots };
    },
    onError: (_e: unknown, _v: unknown, ctx?: OptimisticCtx) => {
      restoreSnapshots(qc, ctx);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: listKey });
    },
  };
}

/**
 * Optimistic SINGLETON PATCH (team settings, preferences): merge the
 * patch into the one cached object.
 */
function optimisticSingleton(qc: QueryClient, key: readonly unknown[]) {
  return {
    onMutate: async (vars: { data: unknown }): Promise<OptimisticCtx> => {
      await qc.cancelQueries({ queryKey: key });
      const snapshots: Snapshot = [[key, qc.getQueryData(key)]];
      const patch = isRecord(vars.data) ? vars.data : {};
      qc.setQueryData(key, (old: unknown) =>
        isRecord(old) ? { ...old, ...patch } : old,
      );
      return { snapshots };
    },
    onError: (_e: unknown, _v: unknown, ctx?: OptimisticCtx) => {
      restoreSnapshots(qc, ctx);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  };
}

function restoreSnapshots(qc: QueryClient, ctx?: OptimisticCtx): void {
  if (!ctx) return;
  for (const [key, data] of ctx.snapshots) {
    qc.setQueryData(key, data);
  }
}

export function registerMutationDefaults(queryClient: QueryClient): void {
  // ── Games ────────────────────────────────────────────────────────────
  queryClient.setMutationDefaults(["createGame"], {
    mutationFn: async (vars: WithSync<{ data: CreateGameBody }>) => {
      return createGame(vars.data, syncRequestInit(vars._sync));
    },
  });
  queryClient.setMutationDefaults(["updateGame"], {
    mutationFn: async (vars: WithSync<{ id: number; data: UpdateGameBody }>) => {
      return updateGame(vars.id, vars.data, syncRequestInit(vars._sync));
    },
    ...optimisticUpdate(queryClient, getListGamesQueryKey(), (id) =>
      getGetGameQueryKey(id),
    ),
  });
  queryClient.setMutationDefaults(["deleteGame"], {
    mutationFn: async (vars: WithSync<{ id: number }>) => {
      return tolerate404(deleteGame(vars.id, syncRequestInit(vars._sync)));
    },
    ...optimisticDelete(queryClient, getListGamesQueryKey()),
  });
  queryClient.setMutationDefaults(["snapshotPlan"], {
    mutationFn: async (vars: WithSync<{ id: number }>) => {
      return snapshotPlan(vars.id, syncRequestInit(vars._sync));
    },
  });
  queryClient.setMutationDefaults(["clearPlanSnapshot"], {
    mutationFn: async (vars: WithSync<{ id: number }>) => {
      return clearPlanSnapshot(vars.id, syncRequestInit(vars._sync));
    },
  });

  // ── Lineups ──────────────────────────────────────────────────────────
  queryClient.setMutationDefaults(["saveLineup"], {
    mutationFn: async (vars: WithSync<{ id: number; data: SaveLineupBody }>) => {
      return saveLineup(vars.id, vars.data, syncRequestInit(vars._sync));
    },
  });

  // ── Dashboard ────────────────────────────────────────────────────────
  queryClient.setMutationDefaults(["dismissDashboardTask"], {
    mutationFn: async (vars: WithSync<{ data: DismissDashboardTaskBody }>) => {
      return dismissDashboardTask(vars.data, syncRequestInit(vars._sync));
    },
  });

  // ── Roster ───────────────────────────────────────────────────────────
  queryClient.setMutationDefaults(["createPlayer"], {
    mutationFn: async (vars: WithSync<{ data: CreatePlayerBody }>) => {
      return createPlayer(vars.data, syncRequestInit(vars._sync));
    },
  });
  queryClient.setMutationDefaults(["updatePlayer"], {
    mutationFn: async (vars: WithSync<{ id: number; data: UpdatePlayerBody }>) => {
      return updatePlayer(vars.id, vars.data, syncRequestInit(vars._sync));
    },
    ...optimisticUpdate(queryClient, getListPlayersQueryKey(), (id) =>
      getGetPlayerQueryKey(id),
    ),
  });
  queryClient.setMutationDefaults(["deletePlayer"], {
    mutationFn: async (vars: WithSync<{ id: number }>) => {
      return tolerate404(deletePlayer(vars.id, syncRequestInit(vars._sync)));
    },
    ...optimisticDelete(queryClient, getListPlayersQueryKey()),
  });

  // ── Settings / preferences ──────────────────────────────────────────
  // Both are PATCH-style replaces against a single per-coach row, so
  // replaying a queued offline edit can never resurrect the wrong record.
  queryClient.setMutationDefaults(["updateTeamSettings"], {
    mutationFn: async (vars: WithSync<{ data: UpdateTeamSettingsBody }>) => {
      return updateTeamSettings(vars.data, syncRequestInit(vars._sync));
    },
    ...optimisticSingleton(queryClient, getGetTeamSettingsQueryKey()),
  });
  queryClient.setMutationDefaults(["updatePreferences"], {
    mutationFn: async (vars: WithSync<{ data: UpdatePreferencesBody }>) => {
      return updatePreferences(vars.data, syncRequestInit(vars._sync));
    },
    ...optimisticSingleton(queryClient, getGetPreferencesQueryKey()),
  });
  queryClient.setMutationDefaults(["completeOnboarding"], {
    mutationFn: async () => {
      return completeOnboarding();
    },
  });

  // ── Tournaments ──────────────────────────────────────────────────────
  queryClient.setMutationDefaults(["createTournament"], {
    mutationFn: async (vars: WithSync<{ data: CreateTournamentBody }>) => {
      return createTournament(vars.data, syncRequestInit(vars._sync));
    },
  });
  queryClient.setMutationDefaults(["updateTournament"], {
    mutationFn: async (vars: WithSync<{ id: number; data: UpdateTournamentBody }>) => {
      return updateTournament(vars.id, vars.data, syncRequestInit(vars._sync));
    },
    ...optimisticUpdate(queryClient, getListTournamentsQueryKey(), (id) =>
      getGetTournamentQueryKey(id),
    ),
  });
  queryClient.setMutationDefaults(["deleteTournament"], {
    mutationFn: async (vars: WithSync<{ id: number }>) => {
      return tolerate404(deleteTournament(vars.id, syncRequestInit(vars._sync)));
    },
    ...optimisticDelete(queryClient, getListTournamentsQueryKey()),
  });

  // ── Pitch counts ─────────────────────────────────────────────────────
  // Server upsert keyed on (gameId, playerId) — idempotent by design.
  queryClient.setMutationDefaults(["upsertGamePitchCount"], {
    mutationFn: async (vars: WithSync<{ id: number; data: UpsertPitchCountBody }>) => {
      return upsertGamePitchCount(vars.id, vars.data, syncRequestInit(vars._sync));
    },
  });
  queryClient.setMutationDefaults(["deleteGamePitchCount"], {
    mutationFn: async (
      vars: WithSync<{ gameId: number; playerId: number }>,
    ) => {
      return tolerate404(
        deleteGamePitchCount(vars.gameId, vars.playerId, syncRequestInit(vars._sync)),
      );
    },
  });

  // ── Box score (manual edits, not the AI extract path) ───────────────
  // saveBoxScore body is fully structured JSON (batting lines + pitch
  // counts + score) — no Blob — so a queued edit can ride through.
  // The server REPLACES all lines for the game in a transaction, which
  // makes re-firing a queued save safe even if the network flipped
  // mid-flight (idempotent at the row level).
  queryClient.setMutationDefaults(["saveBoxScore"], {
    mutationFn: async (vars: WithSync<{ id: number; data: SaveBoxScoreBody }>) => {
      return saveBoxScore(vars.id, vars.data, syncRequestInit(vars._sync));
    },
  });
  queryClient.setMutationDefaults(["deleteBoxScore"], {
    mutationFn: async (vars: WithSync<{ id: number }>) => {
      return tolerate404(deleteBoxScore(vars.id, syncRequestInit(vars._sync)));
    },
  });

  // ── Practices ────────────────────────────────────────────────────────
  queryClient.setMutationDefaults(["createPractice"], {
    mutationFn: async (vars: WithSync<{ data: CreatePracticeBody }>) => {
      return createPractice(vars.data, syncRequestInit(vars._sync));
    },
  });
  queryClient.setMutationDefaults(["updatePractice"], {
    mutationFn: async (vars: WithSync<{ id: number; data: UpdatePracticeBody }>) => {
      return updatePractice(vars.id, vars.data, syncRequestInit(vars._sync));
    },
    ...optimisticUpdate(queryClient, getListPracticesQueryKey(), (id) =>
      getGetPracticeQueryKey(id),
    ),
  });
  queryClient.setMutationDefaults(["deletePractice"], {
    mutationFn: async (vars: WithSync<{ id: number }>) => {
      return tolerate404(deletePractice(vars.id, syncRequestInit(vars._sync)));
    },
    ...optimisticDelete(queryClient, getListPracticesQueryKey()),
  });
  queryClient.setMutationDefaults(["replacePracticeAttendance"], {
    mutationFn: async (
      vars: WithSync<{ id: number; data: ReplaceAttendanceBody }>,
    ) => {
      return replacePracticeAttendance(vars.id, vars.data, syncRequestInit(vars._sync));
    },
  });

  registerDefaultConflictResolvers();
}

// ---------------------------------------------------------------------------
// Default conflict resolvers
// ---------------------------------------------------------------------------

/**
 * Per-domain "Keep mine" re-fires the ORIGINAL edit pinned to the
 * server's current rowVersion (a fresh envelope — a new Idempotency-Key
 * matters here because the original key may have a cached 409 replay).
 * Phase 3 layers richer resolvers (e.g. attendance merge) on top; these
 * defaults cover every If-Match-guarded PATCH/DELETE that exists today.
 */
function registerDefaultConflictResolvers(): void {
  const currentVersion = (current: Record<string, unknown> | null): number | undefined =>
    typeof current?.rowVersion === "number" ? current.rowVersion : undefined;

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" ? v : undefined;

  registerConflictResolver("updateGame", {
    label: (_v, current) => {
      const opp = str(current?.opponent);
      return opp ? `Game vs. ${opp}` : "This game";
    },
    minePatch: (v: { data: Record<string, unknown> }) => v.data,
    keepMine: (v: { id: number; data: UpdateGameBody }, current) =>
      updateGame(v.id, v.data, syncRequestInit(newSyncMeta(currentVersion(current)))),
  });

  registerConflictResolver("deleteGame", {
    label: (_v, current) => {
      const opp = str(current?.opponent);
      return opp ? `Delete game vs. ${opp}` : "Delete this game";
    },
    minePatch: () => ({}),
    keepMine: (v: { id: number }, current) =>
      tolerate404(deleteGame(v.id, syncRequestInit(newSyncMeta(currentVersion(current))))),
  });

  registerConflictResolver("updatePlayer", {
    label: (_v, current) => str(current?.name) ?? "This player",
    minePatch: (v: { data: Record<string, unknown> }) => v.data,
    keepMine: (v: { id: number; data: UpdatePlayerBody }, current) =>
      updatePlayer(v.id, v.data, syncRequestInit(newSyncMeta(currentVersion(current)))),
  });

  registerConflictResolver("deletePlayer", {
    label: (_v, current) => {
      const name = str(current?.name);
      return name ? `Delete ${name}` : "Delete this player";
    },
    minePatch: () => ({}),
    keepMine: (v: { id: number }, current) =>
      tolerate404(deletePlayer(v.id, syncRequestInit(newSyncMeta(currentVersion(current))))),
  });

  registerConflictResolver("updatePractice", {
    label: () => "This practice",
    minePatch: (v: { data: Record<string, unknown> }) => v.data,
    keepMine: (v: { id: number; data: UpdatePracticeBody }, current) =>
      updatePractice(v.id, v.data, syncRequestInit(newSyncMeta(currentVersion(current)))),
  });

  registerConflictResolver("deletePractice", {
    label: () => "Delete this practice",
    minePatch: () => ({}),
    keepMine: (v: { id: number }, current) =>
      tolerate404(deletePractice(v.id, syncRequestInit(newSyncMeta(currentVersion(current))))),
  });

  registerConflictResolver("updateTournament", {
    label: (_v, current) => str(current?.name) ?? "This tournament",
    minePatch: (v: { data: Record<string, unknown> }) => v.data,
    keepMine: (v: { id: number; data: UpdateTournamentBody }, current) =>
      updateTournament(v.id, v.data, syncRequestInit(newSyncMeta(currentVersion(current)))),
  });

  registerConflictResolver("deleteTournament", {
    label: (_v, current) => {
      const name = str(current?.name);
      return name ? `Delete ${name}` : "Delete this tournament";
    },
    minePatch: () => ({}),
    keepMine: (v: { id: number }, current) =>
      tolerate404(deleteTournament(v.id, syncRequestInit(newSyncMeta(currentVersion(current))))),
  });

  registerConflictResolver("updateTeamSettings", {
    label: () => "Team settings",
    minePatch: (v: { data: Record<string, unknown> }) => v.data,
    keepMine: (v: { data: UpdateTeamSettingsBody }, current) =>
      updateTeamSettings(v.data, syncRequestInit(newSyncMeta(currentVersion(current)))),
  });

  registerConflictResolver("updatePreferences", {
    label: () => "Your preferences",
    minePatch: (v: { data: Record<string, unknown> }) => v.data,
    keepMine: (v: { data: UpdatePreferencesBody }, current) =>
      updatePreferences(v.data, syncRequestInit(newSyncMeta(currentVersion(current)))),
  });
}
