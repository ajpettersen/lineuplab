import type { QueryClient } from "@tanstack/react-query";
import {
  updateGame,
  saveLineup,
  dismissDashboardTask,
  createPlayer,
  updatePlayer,
  deletePlayer,
  updateTeamSettings,
  updatePreferences,
  type UpdateGameBody,
  type SaveLineupBody,
  type DismissDashboardTaskBody,
  type CreatePlayerBody,
  type UpdatePlayerBody,
  type UpdateTeamSettingsBody,
  type UpdatePreferencesBody,
} from "@workspace/api-client-react";

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
 * Scope: this is the allowlist of mutations whose paused-offline
 * state is safe to dehydrate, persist across reloads, and replay
 * automatically when the iPad comes back online. Each one must be:
 *   - idempotent (server-side REPLACE / last-writer-wins semantics)
 *   - free of unserializable variables (Files, Blobs, etc.)
 *   - safe to re-run minutes-to-hours after the original click
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
 *     the network drops.
 *   - Anything that uploads a File / Blob (box-score image extract,
 *     image roster import) — those bytes can't survive a reload.
 *   - Destructive mutations whose variables can drift (e.g. a
 *     `deletePlayer` queued offline could delete the wrong row if
 *     IDs were renumbered server-side; in practice we soft-delete
 *     so this is mostly fine, but we keep the allowlist small until
 *     we have a real coach reporting the missing case).
 *
 * Mutation keys come from Orval's generated
 * `get<Op>MutationOptions()` — they're the operationId in array
 * form (e.g. `["updateGame"]`). Grep `mutationKey = ` in
 * `lib/api-client-react/src/generated/api.ts` to see the full list.
 */
export function registerMutationDefaults(queryClient: QueryClient): void {
  queryClient.setMutationDefaults(["updateGame"], {
    mutationFn: async (vars: { id: number; data: UpdateGameBody }) => {
      return updateGame(vars.id, vars.data);
    },
  });

  queryClient.setMutationDefaults(["saveLineup"], {
    mutationFn: async (vars: { id: number; data: SaveLineupBody }) => {
      return saveLineup(vars.id, vars.data);
    },
  });

  queryClient.setMutationDefaults(["dismissDashboardTask"], {
    mutationFn: async (vars: { data: DismissDashboardTaskBody }) => {
      return dismissDashboardTask(vars.data);
    },
  });

  // Roster edits. createPlayer is borderline (replaying it would create
  // a duplicate row if the server already accepted it but the client
  // never saw the 200), but the realistic offline scenario — coach
  // adds a kid in the parking lot before practice — is one we'd
  // rather replay than lose. updatePlayer and deletePlayer are
  // straightforward last-writer-wins on a known id.
  queryClient.setMutationDefaults(["createPlayer"], {
    mutationFn: async (vars: { data: CreatePlayerBody }) => {
      return createPlayer(vars.data);
    },
  });

  queryClient.setMutationDefaults(["updatePlayer"], {
    mutationFn: async (vars: { id: number; data: UpdatePlayerBody }) => {
      return updatePlayer(vars.id, vars.data);
    },
  });

  queryClient.setMutationDefaults(["deletePlayer"], {
    mutationFn: async (vars: { id: number }) => {
      return deletePlayer(vars.id);
    },
  });

  // Settings / preferences. Both are PATCH-style replaces against a
  // single per-coach row, so replaying a queued offline edit can
  // never resurrect the wrong record.
  queryClient.setMutationDefaults(["updateTeamSettings"], {
    mutationFn: async (vars: { data: UpdateTeamSettingsBody }) => {
      return updateTeamSettings(vars.data);
    },
  });

  queryClient.setMutationDefaults(["updatePreferences"], {
    mutationFn: async (vars: { data: UpdatePreferencesBody }) => {
      return updatePreferences(vars.data);
    },
  });
}
