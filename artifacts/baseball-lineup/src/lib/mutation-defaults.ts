import type { QueryClient } from "@tanstack/react-query";
import {
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
 *   - AI routes: `generateLineup`, `generatePracticePlan`,
 *     `extractBoxScore`, image roster import. These are
 *     non-deterministic, expensive, and out of scope for the
 *     offline-mode work — replaying a queued AI call hours later
 *     would surprise the coach and waste budget.
 *   - Anything that uploads a File / Blob (image roster import,
 *     box-score image extract) — those bytes can't survive a reload.
 *   - **Non-idempotent CREATE operations** (createGame, createPlayer,
 *     createPractice, createTournament). Without an Idempotency-Key
 *     header (server-side support is a follow-up task), a replay
 *     after an ambiguous network failure could create a duplicate
 *     row. They stay synchronous-only for now — the coach gets an
 *     error if they're offline when they hit "Create", instead of
 *     a silent duplicate later.
 *   - **DELETE operations** (deleteGame, deletePlayer, deletePractice,
 *     deleteTournament, deleteGamePitchCount, deleteBoxScore). A
 *     replayed delete after a server-side success returns 404, which
 *     would surface to the coach as a misleading "couldn't delete"
 *     toast. Once the conflict layer can recognize "already
 *     deleted" as terminal-success we can add them back.
 *
 * Mutation keys come from Orval's generated
 * `get<Op>MutationOptions()` — they're the operationId in array
 * form (e.g. `["updateGame"]`). Grep `mutationKey = ` in
 * `lib/api-client-react/src/generated/api.ts` to see the full list.
 */
export function registerMutationDefaults(queryClient: QueryClient): void {
  // ── Games ────────────────────────────────────────────────────────────
  queryClient.setMutationDefaults(["updateGame"], {
    mutationFn: async (vars: { id: number; data: UpdateGameBody }) => {
      return updateGame(vars.id, vars.data);
    },
  });
  queryClient.setMutationDefaults(["snapshotPlan"], {
    mutationFn: async (vars: { id: number }) => {
      return snapshotPlan(vars.id);
    },
  });
  queryClient.setMutationDefaults(["clearPlanSnapshot"], {
    mutationFn: async (vars: { id: number }) => {
      return clearPlanSnapshot(vars.id);
    },
  });

  // ── Lineups ──────────────────────────────────────────────────────────
  queryClient.setMutationDefaults(["saveLineup"], {
    mutationFn: async (vars: { id: number; data: SaveLineupBody }) => {
      return saveLineup(vars.id, vars.data);
    },
  });

  // ── Dashboard ────────────────────────────────────────────────────────
  queryClient.setMutationDefaults(["dismissDashboardTask"], {
    mutationFn: async (vars: { data: DismissDashboardTaskBody }) => {
      return dismissDashboardTask(vars.data);
    },
  });

  // ── Roster ───────────────────────────────────────────────────────────
  // updatePlayer is last-writer-wins on a known id. Create / delete
  // are intentionally NOT included (see "NOT included on purpose" in
  // the file docblock).
  queryClient.setMutationDefaults(["updatePlayer"], {
    mutationFn: async (vars: { id: number; data: UpdatePlayerBody }) => {
      return updatePlayer(vars.id, vars.data);
    },
  });

  // ── Settings / preferences ──────────────────────────────────────────
  // Both are PATCH-style replaces against a single per-coach row, so
  // replaying a queued offline edit can never resurrect the wrong record.
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
  queryClient.setMutationDefaults(["completeOnboarding"], {
    mutationFn: async () => {
      return completeOnboarding();
    },
  });

  // ── Tournaments ──────────────────────────────────────────────────────
  queryClient.setMutationDefaults(["updateTournament"], {
    mutationFn: async (vars: { id: number; data: UpdateTournamentBody }) => {
      return updateTournament(vars.id, vars.data);
    },
  });

  // ── Pitch counts ─────────────────────────────────────────────────────
  // Server upsert keyed on (gameId, playerId) — idempotent by design.
  queryClient.setMutationDefaults(["upsertGamePitchCount"], {
    mutationFn: async (vars: { id: number; data: UpsertPitchCountBody }) => {
      return upsertGamePitchCount(vars.id, vars.data);
    },
  });

  // ── Box score (manual edits, not the AI extract path) ───────────────
  // saveBoxScore body is fully structured JSON (batting lines + pitch
  // counts + score) — no Blob — so a queued edit can ride through.
  // The server REPLACES all lines for the game in a transaction, which
  // makes re-firing a queued save safe even if the network flipped
  // mid-flight (idempotent at the row level).
  queryClient.setMutationDefaults(["saveBoxScore"], {
    mutationFn: async (vars: { id: number; data: SaveBoxScoreBody }) => {
      return saveBoxScore(vars.id, vars.data);
    },
  });

  // ── Practices ────────────────────────────────────────────────────────
  queryClient.setMutationDefaults(["updatePractice"], {
    mutationFn: async (vars: { id: number; data: UpdatePracticeBody }) => {
      return updatePractice(vars.id, vars.data);
    },
  });
  queryClient.setMutationDefaults(["replacePracticeAttendance"], {
    mutationFn: async (vars: { id: number; data: ReplaceAttendanceBody }) => {
      return replacePracticeAttendance(vars.id, vars.data);
    },
  });
}
