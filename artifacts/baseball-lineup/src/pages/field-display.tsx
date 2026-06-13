import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import confetti from "canvas-confetti";
import { useRoute, useLocation } from "wouter";
import {
  useGetGame,
  useGetGameLineup,
  useSaveLineup,
  useUpdateGame,
  useGetTournament,
  useGetGamePitchCounts,
  useUpsertGamePitchCount,
  getGetGameQueryKey,
  getGetGameLineupQueryKey,
  getGetSeasonStatsQueryKey,
  getGetPlayerStatsQueryKey,
  getGetTournamentQueryKey,
  getGetGamePitchCountsQueryKey,
  type LineupEntry,
  type Game,
  type UpdateGameBody,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { categoryForPos } from "@/components/game-detail/utils";
import { type SportId } from "@workspace/sport-profiles";
import { useHeartbeat } from "@/hooks/use-heartbeat";
import { shortenTeamName, formatOpponentForMatchup } from "@/lib/team-name";
import { formatPlayerNameShort } from "@/lib/player-name";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Crown, Flag, ListOrdered, Map as MapIcon, Maximize2, Minus, Moon, MoreVertical, Play, Plus, RotateCcw, Sparkles, Sun, SunDim, Trophy, Volume2, VolumeX, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ALL_FIELD_POSITIONS,
  POSITION_LAYOUT,
  POSITION_ACCENT,
  FIELD_LIGHTING,
} from "@/components/field-display/constants";
import type {
  FieldPos,
  MoveTarget,
  TPAvailability,
} from "@/components/field-display/types";
import {
  getLightingMode,
  formatSavedAgo,
  loadJSON,
  saveJSON,
  clearKey,
  setQuotaErrorListener,
} from "@/components/field-display/utils";
import {
  playRunCheerSound,
  playFanfareSound,
  fireScoredRunCheer,
  fireTakeTheLeadCelebration,
  fireChampionshipWelcome,
} from "@/components/field-display/audio-helpers";
import { ScoreStepper } from "@/components/field-display/score-stepper";
import { GameTimer } from "@/components/field-display/game-timer";
import { PitcherChip } from "@/components/field-display/pitcher-chip";
import { DialogScoreInput } from "@/components/field-display/dialog-score-input";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── "No bench 2 of 3 innings" mid-game guardrail ──
// Mirrors the lineup generator's rule: a player must not sit the bench in 2
// (or more) of any 3 consecutive innings. The generator enforces this when it
// builds a lineup; here we WARN the dugout coach when a live position change
// would create a fresh violation (the coach can still override — real-game
// situations sometimes demand it). Only fires when the coach has the
// `global_no_bench_two_of_three` constraint turned on.
type FdConstraint = { type: string; active: boolean };
async function fetchConstraintsForFieldDisplay(): Promise<FdConstraint[]> {
  const r = await fetch(`${BASE}/api/constraints`, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`GET /api/constraints failed (${r.status})`);
  const data: unknown = await r.json().catch(() => null);
  return Array.isArray(data) ? (data as FdConstraint[]) : [];
}

// playerId → set of innings that player is benched, for a given lineup.
function benchedInningsByPlayer(entries: LineupEntry[]): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const e of entries) {
    if (e.position !== "Bench") continue;
    let s = m.get(e.playerId);
    if (!s) {
      s = new Set<number>();
      m.set(e.playerId, s);
    }
    s.add(e.inning);
  }
  return m;
}

// True if, across any 3-consecutive-inning window that CONTAINS `inning`, the
// player is benched in 2+ of those innings.
function violatesTwoOfThreeAround(benched: Set<number>, inning: number): boolean {
  for (const start of [inning - 2, inning - 1, inning]) {
    let count = 0;
    for (let i = start; i < start + 3; i++) if (benched.has(i)) count++;
    if (count >= 2) return true;
  }
  return false;
}

// Players who would NEWLY break the 2-of-3 rule because of a change to
// `inning` (present in `next` but not already broken in `prev`). Returns
// distinct display names in lineup order.
function findNewBenchRuleViolations(
  prev: LineupEntry[],
  next: LineupEntry[],
  inning: number,
): string[] {
  const prevB = benchedInningsByPlayer(prev);
  const nextB = benchedInningsByPlayer(next);
  const nameById = new Map<number, string>();
  for (const e of next) if (!nameById.has(e.playerId)) nameById.set(e.playerId, e.playerName);
  const names: string[] = [];
  for (const [pid, set] of nextB) {
    if (!violatesTwoOfThreeAround(set, inning)) continue;
    const prevSet = prevB.get(pid) ?? new Set<number>();
    if (violatesTwoOfThreeAround(prevSet, inning)) continue; // already broken — don't re-nag
    const name = nameById.get(pid) ?? "A player";
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Rotation tally — an at-a-glance, opt-in panel that counts how many
 * innings each player is slated for INFIELD / OUTFIELD / BENCH across the
 * WHOLE saved lineup (every inning, not just the current one). It lets a
 * coach spot who's been parked on the bench too long while dragging chips
 * around. Pitching is deliberately ignored ("pitching irrespective") — a
 * pitcher's innings don't land in any of the three buckets, matching how
 * the coach reasons about field rotation separately from the arm.
 *
 * Categories come from the sport-aware `categoryForPos`: baseball yields
 * Infield/Outfield, basketball yields Guard/Forward/Center. We tack Bench
 * on at the end. Rows sort by bench count DESC (most-benched first) so the
 * players who most need to get back on the field surface at the front.
 */
interface RotationTallyRow {
  playerId: number;
  name: string;
  counts: Record<string, number>;
  bench: number;
}

// Short column labels keyed off the sport-aware category name.
const ROTATION_CAT_SHORT: Record<string, string> = {
  Infield: "IF",
  Outfield: "OF",
  Guard: "G",
  Forward: "F",
  Center: "C",
  Bench: "B",
};

function computeRotationTally(
  entries: LineupEntry[],
  sport: SportId,
): { rows: RotationTallyRow[]; fieldCats: string[] } {
  const byPlayer = new Map<number, RotationTallyRow>();
  const fieldCats: string[] = [];
  for (const e of entries) {
    const cat = categoryForPos(e.position, sport);
    if (cat === "Pitching") continue; // pitching irrespective
    let row = byPlayer.get(e.playerId);
    if (!row) {
      row = { playerId: e.playerId, name: e.playerName, counts: {}, bench: 0 };
      byPlayer.set(e.playerId, row);
    }
    row.counts[cat] = (row.counts[cat] ?? 0) + 1;
    if (cat === "Bench") {
      row.bench += 1;
    } else if (!fieldCats.includes(cat)) {
      fieldCats.push(cat);
    }
  }
  const rows = [...byPlayer.values()].sort(
    (a, b) => b.bench - a.bench || a.name.localeCompare(b.name),
  );
  return { rows, fieldCats };
}

// Team-name shortening lives in `@/lib/team-name` so the Dashboard hero
// card and recent-games lists share the exact same logic — coaches see
// "Edina vs Minnetonka" everywhere instead of one screen showing the
// full "Edina Green 10AA" and another showing the trimmed name.

/* ─────────────────────────────────────────────────────────────────────────
 * Offline support for the dugout-fence iPad.
 *
 * Park WiFi and cellular at youth ballfields are notoriously flaky — the
 * iPad is frequently strapped to the fence with intermittent connectivity
 * for the duration of a 2-hour game. We need three things to keep the
 * coach's experience smooth:
 *
 *   1) READS work offline. The lineup the iPad was last showing has to
 *      stay on screen even if the network drops. We persist successful
 *      query data to localStorage and hydrate React Query's cache from
 *      it on mount via `initialData` — so a Safari refresh while offline
 *      still renders the most recent lineup the iPad ever saw.
 *
 *   2) WRITES work offline. A coach can drag-drop defensive moves on the
 *      iPad with no connectivity. The optimistic UI update is identical
 *      to the online case (the chip snaps to its new spot instantly).
 *      Instead of POSTing immediately, we persist the desired final
 *      lineup snapshot to localStorage and leave it there until network
 *      returns. Note we persist a SNAPSHOT, not a queue of mutations:
 *      because each save sends the entire lineup (server REPLACE), the
 *      latest snapshot is always sufficient — multiple offline drags
 *      coalesce into a single POST when the iPad reconnects.
 *
 *   3) AUTO-SYNC on reconnect. When `navigator.onLine` flips back to
 *      true, we drain the persisted snapshot through the existing
 *      single-flight save chain. The chain logic already coalesces with
 *      newer drags, so reconnect during continued editing is safe.
 *
 * Conflict policy: the iPad's offline edits WIN over any phone edits
 * made during the offline window. Rationale: the dugout coach is the
 * live source of truth during a game; phone edits during this time are
 * unusual; "last writer wins" with the iPad as last writer matches the
 * mental model. If a parent on a phone made a change while the iPad was
 * offline, that change is overwritten when the iPad reconnects with
 * its accumulated offline state.
 * ────────────────────────────────────────────────────────────────────── */

/** localStorage key for the last-good lineup query result, scoped per game. */
const lineupCacheKey = (gameId: number) => `fd-lineup-cache-v1:${gameId}`;
/** localStorage key for the last-good game record (header data), per game. */
const gameCacheKey = (gameId: number) => `fd-game-cache-v1:${gameId}`;
/** localStorage key for an offline-pending lineup snapshot waiting to POST. */
const pendingSaveKey = (gameId: number) => `fd-pending-save-v1:${gameId}`;
/** localStorage key for an offline-pending game patch (score, etc) waiting
 *  to PATCH. Same offline semantics as `pendingSaveKey` but for the game
 *  record rather than the lineup. */
const pendingGamePatchKey = (gameId: number) =>
  `fd-pending-game-patch-v1:${gameId}`;

/**
 * Track `navigator.onLine` plus the browser's `online`/`offline` events.
 * Returns true when the browser believes it has connectivity. Note this
 * is a HEURISTIC: a true `online` doesn't guarantee the API is reachable
 * (captive portals, server down, etc), but a `false` reliably means we
 * have no network. We pair this with explicit error handling on the POST
 * itself so a captive-portal "online but blocked" scenario still falls
 * back to the offline pending queue.
 */
function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // Sync once on mount in case the browser already flipped before we
    // attached our listeners.
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  return online;
}

/**
 * Dugout / fence-iPad display. Read-only big-text view of the current
 * inning's defense plus the batting order. Polls the lineup every few
 * seconds so a change made on the coach's phone shows up on the iPad
 * without anyone touching it. Designed to fill the screen — no app
 * navigation, no header — because the iPad is strapped to the fence.
 */
export default function FieldDisplay() {
  const [, params] = useRoute("/games/:id/display");
  const [, setLocation] = useLocation();
  const id = parseInt(params?.id ?? "0");
  // "Is this game complete?" exit prompt. Every path out of the field
  // display (top-left Exit, top-right End Game, mobile kebab → Exit,
  // mobile kebab → End game) opens this single dialog so a coach
  // can't accidentally walk away from a finished game without being
  // offered the box-score upload + final-score finalize flow. See
  // <EndGameDialog/> further down for the actual options.
  const [endGameDialogOpen, setEndGameDialogOpen] = useState(false);
  // Final-score capture inside the End Game dialog. Coaches asked for
  // the score to land in the same offline-aware patch chain as the
  // header steppers — this lets them confirm/edit the score AT exit
  // time (rather than having to navigate to /games/:id and edit there
  // on a flaky parking-lot connection where /games/:id has no
  // localStorage queue). Both Just Exit and Mark Complete & Finish
  // funnel any change through saveGamePatchOptimistically before
  // navigating, so the score survives a WiFi drop the same way a
  // mid-game tap would.
  const [dialogOurScore, setDialogOurScore] = useState(0);
  const [dialogOppScore, setDialogOppScore] = useState(0);
  const { teamName, teamShortName, activeFieldPositions, sport } = useTeamSettings();
  // Field Display renders OUTSIDE the main `<Layout>` shell (it owns the
  // whole viewport for the dugout iPad), so the Layout-mounted
  // `useHeartbeat()` doesn't fire here. Without this call, a coach
  // running a real game for 90+ minutes would look "offline" to the
  // master-admin "last seen" view the entire time. Mounting the
  // heartbeat directly is cheap (no-op when tab is hidden, internal
  // signed-in gate) and means active game-day usage now actually
  // registers.
  useHeartbeat();
  const qc = useQueryClient();
  const { toast } = useToast();
  const saveLineup = useSaveLineup();
  // Per-game pitch counts. Loaded so the "how many pitches did Sarah
  // throw?" prompt that fires on pitcher removal can ADD to whatever's
  // already on file rather than overwrite it (the upsert endpoint is
  // REPLACE-semantics). Cheap query — one tiny row per pitcher this
  // game — and the same data is the source of truth for the Tournament
  // Pitches Panel above, so loading it here also keeps that panel
  // fresher on the iPad.
  const { data: gamePitchCounts = [] } = useGetGamePitchCounts(id, {
    query: { enabled: id > 0, queryKey: getGetGamePitchCountsQueryKey(id) },
  });
  const upsertPitchCount = useUpsertGamePitchCount();
  // Queue of "this pitcher just came off the mound" prompts. Each entry
  // pops a small modal asking for pitch count; submitting (or skipping)
  // shifts the next one in. A queue (not a single value) so two rapid
  // P swaps both get captured — see saveLineupOptimistically below for
  // detection. Skip = "don't record", not "record 0" — coaches may not
  // be tracking pitches this game at all.
  const [pitcherPromptQueue, setPitcherPromptQueue] = useState<
    { playerId: number; playerName: string }[]
  >([]);
  // Tapped-out-pitcher confirm state. When a coach drags somebody onto
  // "P" who has 0 pitches left today, we stash the would-be lineup +
  // the violation details here and pop an AlertDialog. Confirm commits
  // the move; Cancel just drops it — there's no undo to perform
  // because we never wrote anything optimistically (the check runs
  // BEFORE _commitLineupSave). One pitcher per dialog: a single drag
  // can only put one player on the mound at a time.
  const [tappedOutWarning, setTappedOutWarning] = useState<{
    nextLineup: LineupEntry[];
    playerName: string;
    pitchesToday: number;
    dailyMax: number | null;
  } | null>(null);
  // "No bench 2 of 3 innings" confirm state. When a live alignment change
  // would newly bench a player 2 of 3 consecutive innings AND that rule is
  // turned on, we stash the would-be lineup + the affected player names and
  // pop an AlertDialog. Confirm commits; Cancel drops the staged move. Same
  // bail-before-commit pattern as tappedOutWarning above.
  const [benchRuleWarning, setBenchRuleWarning] = useState<{
    nextLineup: LineupEntry[];
    playerNames: string[];
  } | null>(null);
  // Whether the coach has the "no bench 2 of 3 innings" rule active. Shares
  // the ["constraints"] query cache with the Constraints page. Failures are
  // non-fatal — the warning just stays off.
  const { data: fdConstraints } = useQuery({
    queryKey: ["constraints"],
    queryFn: fetchConstraintsForFieldDisplay,
    retry: 1,
    staleTime: 60_000,
  });
  const noBenchTwoOfThreeActive = !!fdConstraints?.some(
    (c) => c.type === "global_no_bench_two_of_three" && c.active,
  );
  // Game-record updater for score input. networkMode 'always' so our
  // explicit navigator.onLine gate inside flushGameSave is what controls
  // when a request actually goes out — without 'always', React Query's
  // built-in offline pause would queue mutateAsync indefinitely and hang
  // the save chain when the iPad is offline.
  const updateGame = useUpdateGame({
    mutation: { networkMode: "always" },
  });

  // Sensor config: distance-based activation for BOTH mouse and touch so
  // chips begin dragging the instant the coach moves their finger — no
  // long-press, no two-step "tap then drag". An earlier 150ms touch
  // delay was meant to prevent accidental drags during page scroll, but
  // (a) the field display is `lg:overflow-hidden` on iPad/desktop, so
  // there's nothing to scroll, and (b) the long-press felt broken to
  // dugout coaches who expected raw drag. 8px tolerance is enough to
  // distinguish a tap from a drag without making the chip feel sticky.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
  );
  // Tracks the entry whose chip is currently being dragged so we can hide
  // the original (it's flying around in the DragOverlay) and so the
  // bench/field can mute the same player elsewhere if they show twice.
  const [activeDragEntryId, setActiveDragEntryId] = useState<number | null>(null);

  // Tap-to-swap "coach mode": with one finger free (other hand on a clipboard
  // or a glove), tap one chip to select it, then tap a destination — another
  // chip to swap, an empty position, or anywhere on the bench — to apply.
  // Drag-and-drop still works in parallel; tap is the in-game shortcut.
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  // Post-drag click suppression. When a real drag ends, some browsers fire a
  // synthetic `click` on the chip the finger lifted from — without this guard
  // that click would route to the tap-to-swap handler and re-select the chip
  // (or worse, trigger an unintended second swap). 300ms is the same window
  // game-detail uses for the same problem.
  const lastDragEndAtRef = useRef<number>(0);
  const justFinishedDragging = () => Date.now() - lastDragEndAtRef.current < 300;

  // Single-flight save coordination. The dugout coach can fire off 2-3
  // drags in quick succession (e.g. Aiden ↔ Mason, then Mason ↔ Owen),
  // and a parent's phone might be editing the same lineup at the same
  // time. Two hazards we have to defend against:
  //   1) Overlapping POSTs racing — server REPLACE means whichever lands
  //      last "wins", which could undo an earlier successful drag.
  //   2) Stale-snapshot rollback on a late failure clobbering newer
  //      successful state.
  // Solution: chain saves through a single promise so only one POST is
  // ever in flight, and have each save read the LATEST optimistic state
  // at save-time (rather than the state captured when the drag fired).
  // Multiple drags during an in-flight save coalesce into a single
  // follow-up POST with the final coalesced state.
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingLineupRef = useRef<LineupEntry[] | null>(null);
  // Parallel single-flight chain for game-record patches (score updates).
  // Same coalescing semantics as lineup, but the pending object is a
  // partial Game patch (e.g. { ourScore: 4 }) — multiple in-flight patches
  // merge field-by-field so updating ours+theirs across rapid taps doesn't
  // lose either field's value.
  const saveGameQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingGamePatchRef = useRef<UpdateGameBody | null>(null);

  // Online/offline + has-unsynced-changes status, surfaced in the header
  // badge. Both flags are initialized lazily from localStorage so a refresh
  // while offline (with persisted pending edits) still shows the correct
  // "Offline · will sync" state on first paint. Tracked separately by side
  // (lineup vs score) since their save chains are independent, then OR'd
  // into one user-facing flag for the badge.
  const online = useOnlineStatus();
  const [hasUnsyncedLineup, setHasUnsyncedLineup] = useState<boolean>(
    () => loadJSON(pendingSaveKey(id)) != null,
  );
  const [hasUnsyncedScore, setHasUnsyncedScore] = useState<boolean>(
    () => loadJSON(pendingGamePatchKey(id)) != null,
  );
  const hasUnsyncedChanges = hasUnsyncedLineup || hasUnsyncedScore;
  // Wall-clock timestamp of the last server save (lineup or game patch).
  // Drives the "Saved 30s ago" subtext under the Live badge so coaches
  // have a concrete number, not just "Live". Null until the first save
  // or successful initial fetch this session.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // Forces re-render every 15s so the relative "Xm ago" display ticks
  // forward without us refetching anything.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  // Polling interval: 5s feels live without hammering the API. The query is
  // also re-fetched on window focus (default react-query behavior) so a
  // coach who taps the iPad screen sees the freshest data right away.
  // React Query's onlineManager pauses polling automatically when offline,
  // so a flaky-WiFi park doesn't generate a flood of failed fetches — it
  // just sits on the cached lineup until reconnect.
  const POLL_MS = 5000;

  // Hydrate React Query's cache from localStorage on first render so the
  // page renders the last-known lineup immediately, even with no network.
  // Memoized per game id so we don't repeatedly hit localStorage on every
  // render (initialData closures fire a lot). If the cache is empty, return
  // undefined so React Query falls back to its normal fetching state.
  const initialGame = useMemo<Game | undefined>(() => {
    const cached = loadJSON<Game>(gameCacheKey(id));
    if (!cached) return undefined;
    // Apply any pending offline score patch on top of the cached server
    // game so the UI shows the coach's pending value immediately on
    // first paint — without this, we'd briefly render the stale server
    // score, then flicker to the patched value once the restore-pending
    // effect runs after first commit.
    const pendingPatch = loadJSON<UpdateGameBody>(pendingGamePatchKey(id));
    return pendingPatch ? { ...cached, ...pendingPatch } : cached;
  }, [id]);
  const initialLineup = useMemo<LineupEntry[] | undefined>(() => {
    // If we have an offline-pending snapshot from a previous session,
    // prefer it (it's the freshest desired state, not the server's). The
    // restore-pending effect below also seeds pendingLineupRef so the
    // online-flip effect knows to drain it.
    const pending = loadJSON<LineupEntry[]>(pendingSaveKey(id));
    if (pending) return pending;
    return loadJSON<LineupEntry[]>(lineupCacheKey(id));
  }, [id]);

  // Pause the 5s background poll while we still have unsynced writes
  // for that side. Without this, a successful GET (which still works on
  // a flaky/captive-portal connection where POST/PATCH fails) overwrites
  // the optimistic UI with stale server state — the coach sees their
  // edits "revert" mid-game even though the pending write is safely in
  // localStorage. Polling resumes automatically the moment the pending
  // queue drains and `hasUnsynced*` flips false. We also disable
  // `refetchOnWindowFocus` for the same reason: tabbing back to the
  // iPad with pending writes shouldn't refetch and clobber.
  const { data: game } = useGetGame(id, {
    query: {
      enabled: !!id,
      queryKey: getGetGameQueryKey(id),
      refetchInterval: hasUnsyncedScore ? false : POLL_MS,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: !hasUnsyncedScore,
      initialData: initialGame,
      // Mark stale so a refetch still happens once online — initialData
      // is just a paint-time placeholder, not authoritative.
      initialDataUpdatedAt: 0,
    },
  });
  const { data: lineup = [] } = useGetGameLineup(id, {
    query: {
      enabled: !!id,
      queryKey: getGetGameLineupQueryKey(id),
      refetchInterval: hasUnsyncedLineup ? false : POLL_MS,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: !hasUnsyncedLineup,
      initialData: initialLineup,
      initialDataUpdatedAt: 0,
    },
  });
  // Tournament metadata (rolling pitcher availability). Only fires when
  // the game is part of a tournament — most league fixtures aren't, so
  // the GET is skipped. We don't gate on the overlay toggle so the data
  // is already warm the moment the coach flips it on. Re-fetches
  // alongside the lineup poll so a stat-keeper adding pitch counts in
  // another tab reflects here within ~5s.
  const tournamentId = game?.tournamentId ?? null;
  const { data: tournament } = useGetTournament(tournamentId ?? 0, {
    query: {
      enabled: tournamentId != null,
      queryKey: getGetTournamentQueryKey(tournamentId ?? 0),
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: true,
    },
  });

  // Persist successful query data to localStorage so a Safari refresh
  // while offline still has something to render. Only writes when data
  // exists — we don't want to write `[]` on a transient empty fetch and
  // wipe out the previously-cached lineup.
  useEffect(() => {
    if (!id) return;
    if (game) saveJSON(gameCacheKey(id), game);
  }, [id, game]);
  useEffect(() => {
    if (!id) return;
    if (lineup.length > 0) saveJSON(lineupCacheKey(id), lineup);
  }, [id, lineup]);

  // Render slots in canonical L→R order (per ALL_FIELD_POSITIONS). Start
  // from the team's currently-active positions, then UNION in any position
  // that's actually present in this game's saved entries — so a historical
  // lineup saved when the team used CF still shows its CF slot even after
  // switching to LCF/RCF (and vice versa). Mirrors the `displayPositions`
  // pattern in game-detail.tsx so the dugout iPad stays in sync with the
  // lineup grid. Filters out anything unknown so a bad team_settings row
  // can't blow up the page.
  const displayedFieldPositions: readonly FieldPos[] = useMemo(() => {
    const known = new Set<string>(ALL_FIELD_POSITIONS);
    const union = new Set<string>();
    for (const p of activeFieldPositions) if (known.has(p)) union.add(p);
    for (const e of lineup) {
      if (e.position !== "Bench" && known.has(e.position)) union.add(e.position);
    }
    return ALL_FIELD_POSITIONS.filter((p) => union.has(p));
  }, [activeFieldPositions, lineup]);

  // Restore offline-pending edits (lineup snapshot AND game patch) from a
  // previous session into the in-memory refs so the existing flush chains
  // can drain them. The React Query cache was already hydrated with the
  // pending values via `initialLineup` / `initialGame`, so the UI is
  // already showing the right thing — we just need to wire up the save
  // side. Runs once per game id.
  useEffect(() => {
    if (!id) return;
    const onlineNow = typeof navigator !== "undefined" && navigator.onLine;

    const pendingLine = loadJSON<LineupEntry[]>(pendingSaveKey(id));
    if (pendingLine) {
      pendingLineupRef.current = pendingLine;
      setHasUnsyncedLineup(true);
      if (onlineNow) flushSave();
    }
    const pendingPatch = loadJSON<UpdateGameBody>(pendingGamePatchKey(id));
    if (pendingPatch) {
      pendingGamePatchRef.current = pendingPatch;
      setHasUnsyncedScore(true);
      if (onlineNow) flushGameSave();
    }
    // Run-once-per-game-id; the flush functions are stable enough for our
    // purposes (closures over stable ids).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // When the browser flips from offline → online, drain any pending
  // snapshots through their respective single-flight chains. Both flush
  // functions are safe no-ops when their pending refs are null, so
  // calling them on every online event is fine. React Query's
  // onlineManager will also resume polling automatically, which gives
  // us the post-reconnect refresh for free.
  useEffect(() => {
    if (!online) return;
    // Re-assert any pending optimistic state on the cache BEFORE
    // flushing, in case the App-level <OnlineResumer>'s
    // qc.invalidateQueries() (also fired on this same `online` event)
    // forked a refetch that lands first and clobbers the dugout
    // coach's offline drags. flushSave/flushGameSave each re-apply
    // again as a second layer of defense, but doing it here too means
    // the UI never visibly flickers through the stale server state.
    if (pendingLineupRef.current) {
      qc.setQueryData(getGetGameLineupQueryKey(id), pendingLineupRef.current);
    }
    if (pendingGamePatchRef.current) {
      const patch = pendingGamePatchRef.current;
      qc.setQueryData(getGetGameQueryKey(id), (prev: Game | undefined) =>
        prev ? { ...prev, ...patch } : prev,
      );
    }
    flushSave();
    flushGameSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // BACKUP DRAIN TIMER. The browser's `online` event is unreliable on
  // flaky cell connections — the radio can recover without firing it,
  // and React Query's onlineManager has the same blind spot. While we
  // believe we're online and still have pending writes, retry every
  // 30s. Cheap (no-op when pending refs are null) and gives us a
  // belt-and-suspenders recovery path for "we're back on WiFi but the
  // browser never noticed" scenarios at the field.
  useEffect(() => {
    if (!online || !hasUnsyncedChanges) return;
    const t = window.setInterval(() => {
      if (typeof navigator !== "undefined" && navigator.onLine) {
        flushSave();
        flushGameSave();
      }
    }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, hasUnsyncedChanges]);

  // (Removed the "All changes saved" success toast — coaches found it
  // noisy on the score steppers since every +1 tap that drained the
  // pending queue popped a confirmation. The header's <SyncStatusChip>
  // already shows "Syncing N" → hidden when idle, which is enough.)

  // Subscribe to the module-level quota-error listener so we can warn
  // the coach exactly once if localStorage refuses a write (private
  // mode, full disk). After the warning, we degrade silently — the
  // session keeps working, just won't survive a refresh.
  const quotaWarnedRef = useRef(false);
  useEffect(() => {
    setQuotaErrorListener(() => {
      if (quotaWarnedRef.current) return;
      quotaWarnedRef.current = true;
      toast({
        title: "Device storage is full",
        description:
          "Edits will keep working this session, but won't survive a refresh until storage is cleared.",
        variant: "destructive",
        duration: 8000,
      });
    });
    return () => setQuotaErrorListener(null);
  }, [toast]);

  // Coach-controlled "what inning is on the screen right now". Defaults to 1
  // and is bumped manually with the arrows so the display doesn't change
  // mid-inning just because somebody saved a future-inning tweak.
  const innings = game?.innings ?? 6;
  const [currentInning, setCurrentInning] = useState(1);
  useEffect(() => {
    // If the game shrinks (end-early) below the inning we're showing, snap
    // back to the last valid inning so the screen never goes blank. Wait
    // until the game has actually loaded — otherwise we'd compare against
    // the placeholder `?? 6` and risk thrashing during initial hydration.
    if (!game) return;
    if (currentInning > innings) setCurrentInning(innings);
  }, [innings, currentInning, game]);

  // Pitch-limit-approaching warning (tournament games only). Fires
  // one toast per pitcher per game when the active pitcher's
  // tournament-day pitch count crosses 80% of their resolved daily
  // cap. Gives the coach a real heads-up window to start warming a
  // reliever before they hit the tapped-out wall at 100% (which is
  // gated by `tappedOutWarning` on the NEXT drag-onto-P — by then
  // it's too late to plan). One-shot per pitcher per game, gated by
  // `fd-pitch-warn-v1:<gameId>:<playerId>` in localStorage so it
  // doesn't re-fire on the 5s poll or a page refresh. Mid-game
  // count corrections that pull the value back under threshold do
  // NOT reset the flag — the warning already did its job, and
  // re-arming would just nag a coach who fat-fingered a +5 button.
  useEffect(() => {
    if (tournamentId == null || !id) return;
    if (!tournament?.pitcherAvailability) return;
    const activePitcherId = lineup.find(
      (e) => e.inning === currentInning && e.position === "P",
    )?.playerId;
    if (activePitcherId == null) return;
    const avail = tournament.pitcherAvailability.find(
      (a) => a.playerId === activePitcherId,
    );
    if (!avail || avail.dailyMax == null) return;
    // Threshold = ceil(80%) so a cap of 75 fires at 60, not 60.0.
    // Skip the warning entirely once they're AT the cap — the
    // tapped-out warning on the next P swap covers that territory
    // and we don't want to double-toast for the same event.
    const threshold = Math.ceil(avail.dailyMax * 0.8);
    if (avail.pitchesToday < threshold) return;
    if (avail.pitchesToday >= avail.dailyMax) return;
    const key = `fd-pitch-warn-v1:${id}:${activePitcherId}`;
    try {
      if (localStorage.getItem(key) === "1") return;
      localStorage.setItem(key, "1");
    } catch {
      // Private mode / quota — fall through and toast anyway. One
      // extra toast per render is preferable to a silent failure
      // because the cap warning is genuinely safety-critical.
    }
    const remaining = Math.max(0, avail.dailyMax - avail.pitchesToday);
    toast({
      title: `${avail.playerName} approaching daily cap`,
      description: `${avail.pitchesToday}/${avail.dailyMax} pitches today · ${remaining} left. Consider warming a reliever.`,
      duration: 8000,
    });
  }, [
    tournamentId,
    tournament?.pitcherAvailability,
    lineup,
    currentInning,
    id,
    toast,
  ]);

  // Show "Just updated" pulse when the lineup data changes. Driven off a
  // string fingerprint of the lineup so we don't false-trigger on identical
  // re-fetches. The pulse fades after ~3s.
  const fingerprint = useMemo(
    () =>
      lineup
        .map((e) => `${e.inning}:${e.position}:${e.playerId}:${e.battingOrder}`)
        .sort()
        .join("|"),
    [lineup],
  );
  const [justUpdated, setJustUpdated] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    if (!hasMounted) {
      setHasMounted(true);
      return;
    }
    setJustUpdated(true);
    const t = window.setTimeout(() => setJustUpdated(false), 3000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  // Defense for the current inning, keyed by position. Only one player per
  // position per inning is supported (server enforces). `entryId` is the
  // server-assigned lineup row id we need for drag-and-drop save mutations.
  const fieldByPos = useMemo(() => {
    const map = new Map<string, { name: string; playerId: number; entryId: number }>();
    for (const e of lineup) {
      if (e.inning !== currentInning) continue;
      if (e.position === "Bench") continue;
      map.set(e.position, { name: e.playerName, playerId: e.playerId, entryId: e.id });
    }
    return map;
  }, [lineup, currentInning]);

  // Bench list for the current inning, name-sorted so the dugout can spot
  // their kids quickly. `entryId` is carried so each bench chip can be
  // dragged onto a field position (the row's `position` flips from
  // "Bench" to the dropped-on position via the same save mutation).
  const benchEntries = useMemo(() => {
    return lineup
      .filter((e) => e.inning === currentInning && e.position === "Bench")
      .map((e) => ({ name: e.playerName, entryId: e.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [lineup, currentInning]);

  // Batting order: collapse per-player, take the first non-null order. Players
  // with no order (true bench-only in nine-man mode) land at the bottom.
  const battingOrder = useMemo(() => {
    type Row = { playerId: number; playerName: string; order: number | null };
    const byPlayer = new Map<number, Row>();
    for (const e of lineup) {
      const incoming = e.battingOrder ?? null;
      const existing = byPlayer.get(e.playerId);
      if (!existing) {
        byPlayer.set(e.playerId, {
          playerId: e.playerId,
          playerName: e.playerName,
          order: incoming,
        });
      } else if (existing.order == null && incoming != null) {
        existing.order = incoming;
      }
    }
    return Array.from(byPlayer.values()).sort((a, b) => {
      if (a.order != null && b.order != null) return a.order - b.order;
      if (a.order != null) return -1;
      if (b.order != null) return 1;
      return a.playerName.localeCompare(b.playerName);
    });
  }, [lineup]);

  // Per-player Infield/Outfield/Bench inning counts across the whole saved
  // lineup (pitching ignored). Drives the opt-in rotation tally panel.
  const rotationTally = useMemo(
    () => computeRotationTally(lineup, sport),
    [lineup, sport],
  );

  // Score line on the header.
  const ourScore = game?.ourScore ?? 0;
  const oppScore = game?.opponentScore ?? 0;

  // ── Take-the-lead celebration 🎆 ─────────────────────────────────
  // Fire confetti whenever the team flips from tied-or-behind to
  // ahead. The ref carries the previously-observed margin so we can
  // detect a transition (margin <= 0 → margin > 0) instead of merely
  // a positive margin (which would fire on every render while ahead).
  //
  // Guarded against three false positives:
  //   1. Initial mount — ref starts unset; first observation just
  //      seeds it without firing.
  //   2. Game already finished — no celebration after the final out.
  //   3. Quick toggles — a 600ms cooldown so a coach who taps the
  //      stepper a couple times to fix a typo doesn't get spammed.
  //
  // Coaches can mute via the kebab menu (persisted to localStorage).
  const CELEBRATE_KEY = "fd-celebrate-take-lead";
  const SOUND_KEY = "fd-celebrate-sound";
  const [celebrate, setCelebrate] = useState<boolean>(() => {
    try {
      if (typeof window === "undefined") return true;
      const v = localStorage.getItem(CELEBRATE_KEY);
      return v == null ? true : v === "1";
    } catch {
      return true;
    }
  });
  // Sound is OPT-OUT but loud-by-default would be rude in a quiet
  // dugout — we still default it ON because the user explicitly
  // asked for sound. They can mute from the kebab.
  const [celebrateSound, setCelebrateSound] = useState<boolean>(() => {
    try {
      if (typeof window === "undefined") return true;
      const v = localStorage.getItem(SOUND_KEY);
      return v == null ? true : v === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CELEBRATE_KEY, celebrate ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [celebrate]);
  useEffect(() => {
    try {
      localStorage.setItem(SOUND_KEY, celebrateSound ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [celebrateSound]);

  // Championship Mode — "pump up the kids" treatment for big tournament
  // games. Adds a pulsing gold frame glow, animated rainbow chyron
  // shimmer, glowing scoreboard numerals, and CROWN icons on the
  // tournament pre-title. The field/lineup themselves stay static (no
  // rotation, no chip movement) so the coach reading the iPad isn't
  // distracted — only the chrome around them gets cranked up. Only
  // meaningful for tournament games; the kebab toggle is hidden for
  // league fixtures.
  //
  // Driven PER GAME by the `games.isChampionship` data flag (set in the
  // Edit Game dialog). A flagged game auto-lights up; the coach can still
  // flip it for the current session via the kebab.
  // We deliberately do NOT persist a global per-device toggle anymore:
  // doing so used to leak the gold treatment onto later, non-championship
  // tournament games on the same iPad. The flag itself is the durable
  // signal, so persistence now lives in the DB, scoped to the right game.
  //   null  → no manual choice this session; follow the game's flag
  //   true  → coach forced it ON for this session
  //   false → coach forced it OFF for this session
  const [champOverride, setChampOverride] = useState<boolean | null>(null);
  // Reset the manual override whenever we switch to a different game so
  // the new game starts by honoring its own flag (the component isn't
  // guaranteed to remount on a route-param change).
  useEffect(() => {
    setChampOverride(null);
  }, [id]);
  const championshipMode = champOverride ?? Boolean(game?.isChampionship);

  // Web Audio context — created lazily on first user gesture (iOS
  // Safari requires the unlock to happen during a touch/click handler,
  // and the score-stepper clicks themselves satisfy that). We attach
  // a one-shot pointerdown listener so a coach who taps ANYWHERE in
  // the page also primes the context, even if the first event they
  // trigger is the take-lead show via a teammate's tap.
  const audioCtxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const ensure = () => {
      if (audioCtxRef.current) return;
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        audioCtxRef.current = new Ctor();
      } catch {
        /* audio unavailable */
      }
    };
    const onGesture = () => {
      ensure();
      if (audioCtxRef.current?.state === "suspended") {
        void audioCtxRef.current.resume();
      }
    };
    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, []);

  // Dedicated full-viewport canvas the celebration paints into. We
  // mount it ourselves (rather than letting canvas-confetti auto-
  // create one on document.body) for two reasons:
  //   1. We can pin z-index to the max so it always sits ABOVE the
  //      iPad-only fullscreen / dim overlays. The library's default
  //      canvas has no z-index and was being painted under the
  //      sidebar/header stacking contexts on iPad — coaches saw
  //      nothing on the big screen even though it worked on phones.
  //   2. We can drive a coordinated CSS screen-flash on top of the
  //      same overlay (see celebrateFlashRef below).
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const confettiFireRef = useRef<ReturnType<
    typeof confetti.create
  > | null>(null);
  useEffect(() => {
    const c = confettiCanvasRef.current;
    if (!c) return;
    confettiFireRef.current = confetti.create(c, {
      resize: true,
      useWorker: true,
    });
    return () => {
      confettiFireRef.current?.reset();
      confettiFireRef.current = null;
    };
  }, []);
  const celebrateFlashRef = useRef<HTMLDivElement | null>(null);

  const prevMarginRef = useRef<number | null>(null);
  const prevOurScoreRef = useRef<number | null>(null);
  const lastCelebrationAtRef = useRef<number>(0);
  const lastRunCheerAtRef = useRef<number>(0);
  useEffect(() => {
    if (!game) return;
    const margin = ourScore - oppScore;
    const prevMargin = prevMarginRef.current;
    const prevOurs = prevOurScoreRef.current;
    prevMarginRef.current = margin;
    prevOurScoreRef.current = ourScore;
    if (prevMargin == null || prevOurs == null) return; // seeding read
    if (!celebrate) return;
    // Treat completed/cancelled games as locked — no celebration for
    // a stat-keeper retroactively editing yesterday's final score.
    const status = (game as { status?: string }).status;
    if (status === "completed" || status === "cancelled") return;

    const tookLead = prevMargin <= 0 && margin > 0;
    const scoredRun = ourScore > prevOurs;

    if (tookLead) {
      const now = Date.now();
      if (now - lastCelebrationAtRef.current < 600) return;
      lastCelebrationAtRef.current = now;
      // Big show wins — skip the small "scored a run" cheer this tick
      // so we don't double-fire on the same stepper tap.
      void fireTakeTheLeadCelebration(
        confettiFireRef.current,
        celebrateFlashRef.current,
      );
      if (celebrateSound) playFanfareSound(audioCtxRef.current);
      return;
    }

    if (scoredRun) {
      const now = Date.now();
      // Coalesce rapid +1 taps (typo-fix) into a single cheer.
      if (now - lastRunCheerAtRef.current < 600) return;
      lastRunCheerAtRef.current = now;
      void fireScoredRunCheer(confettiFireRef.current);
      if (celebrateSound) playRunCheerSound(audioCtxRef.current);
    }
  }, [game, ourScore, oppScore, celebrate, celebrateSound]);

  // Sync the End Game dialog's score editors from the live game state
  // every time the dialog opens — the coach may have tapped the
  // header steppers since the last open and we want the dialog to
  // reflect the current optimistic score, not a stale one. Only
  // overwrites on the open transition so typing inside the dialog
  // isn't fighting a re-sync.
  useEffect(() => {
    if (endGameDialogOpen) {
      setDialogOurScore(ourScore);
      setDialogOppScore(oppScore);
    }
    // We intentionally only depend on endGameDialogOpen — the score
    // values are read on the open transition only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endGameDialogOpen]);

  // Persist any dialog-edited score through the offline-aware patch
  // chain. Only PATCHes the fields that actually differ so a no-op
  // exit doesn't generate a wasted PATCH. Returns nothing — the patch
  // chain handles its own queuing.
  const persistDialogScores = () => {
    const patch: UpdateGameBody = {};
    if (dialogOurScore !== ourScore) patch.ourScore = dialogOurScore;
    if (dialogOppScore !== oppScore) patch.opponentScore = dialogOppScore;
    if (Object.keys(patch).length > 0) saveGamePatchOptimistically(patch);
  };

  // Pick the field lighting palette based on the game's scheduled start.
  // Memoized so a 5s lineup poll doesn't re-derive on every tick — only when
  // the game date itself changes (very rare during a live game).
  // Brightness mode — tri-state cycle that lets the coach pick a screen
  // treatment on the fly without diving into settings:
  //   • "auto"     — default; time-of-day lighting palette + standard chip
  //                  contrast. The right call for shaded dugouts and
  //                  evening games.
  //   • "sunlight" — force the brightest grass palette, drop the field's
  //                  inner shadow, lay a faint white wash over the page
  //                  to lift mid-tones, and bump chip contrast. Designed
  //                  for direct sun on the iPad/phone screen where the
  //                  dim factory backlight makes everything look gray.
  //   • "dim"      — translucent black overlay across the whole page so
  //                  the iPad isn't burning battery between innings.
  // Persisted to localStorage so an accidental Exit → back doesn't lose
  // the setting mid-game. Old `fd-dim-mode` boolean key is migrated on
  // first read so existing dim-mode users don't lose their preference.
  // Declared above the `lighting` memo because the memo reads
  // `sunlightMode` to override the time-of-day palette.
  type BrightnessMode = "auto" | "sunlight" | "dim";
  const BRIGHTNESS_KEY = "fd-brightness-mode";
  const DIM_KEY_LEGACY = "fd-dim-mode";
  const [brightnessMode, setBrightnessMode] = useState<BrightnessMode>(() => {
    try {
      if (typeof window === "undefined") return "auto";
      const v = localStorage.getItem(BRIGHTNESS_KEY);
      if (v === "auto" || v === "sunlight" || v === "dim") return v;
      // Migrate the old boolean dim flag.
      if (localStorage.getItem(DIM_KEY_LEGACY) === "1") return "dim";
      return "auto";
    } catch {
      return "auto";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(BRIGHTNESS_KEY, brightnessMode);
      // Drop the legacy key once we've upgraded so it doesn't drift.
      localStorage.removeItem(DIM_KEY_LEGACY);
    } catch {
      // Private mode / storage disabled — silent no-op.
    }
  }, [brightnessMode]);
  const cycleBrightness = () =>
    setBrightnessMode((m) =>
      m === "auto" ? "sunlight" : m === "sunlight" ? "dim" : "auto",
    );
  const dimMode = brightnessMode === "dim";
  const sunlightMode = brightnessMode === "sunlight";

  // ── Tournament pitches overlay ──
  // When the active game belongs to a tournament, coaches asked for a
  // quick in-game peek at "who's still got pitches left this weekend"
  // without having to navigate to the tournament page. Preference
  // persists per-device so a coach who likes it on keeps it on across
  // innings/games.
  //
  // Defaults to ON for tournament games — coaches told us it's the
  // whole point of opening Field Display during a tournament weekend
  // and they kept missing the kebab toggle. Hiding it stays a single
  // tap away in the kebab.
  const TOURNEY_PITCHES_KEY = "fd-show-tournament-pitches";
  const [showTournamentPitches, setShowTournamentPitches] = useState<boolean>(() => {
    try {
      if (typeof window === "undefined") return true;
      const v = localStorage.getItem(TOURNEY_PITCHES_KEY);
      return v == null ? true : v === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TOURNEY_PITCHES_KEY, showTournamentPitches ? "1" : "0");
    } catch {
      // Private mode — silent.
    }
  }, [showTournamentPitches]);

  // ── Rotation tally overlay ──
  // Opt-in panel showing per-player Infield/Outfield/Bench inning counts
  // (pitching ignored) so the coach can keep rotation fair while dragging.
  // Defaults OFF and only appears when the coach deliberately taps "Show
  // rotation" (or the kebab) — the dugout iPad faces the players, and a
  // coach doesn't want kids reading who's slated for the most bench time.
  // The choice persists per-device once they opt in.
  const ROTATION_TALLY_KEY = "fd-show-rotation-tally";
  const [showRotationTally, setShowRotationTally] = useState<boolean>(() => {
    try {
      if (typeof window === "undefined") return false;
      return localStorage.getItem(ROTATION_TALLY_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(ROTATION_TALLY_KEY, showRotationTally ? "1" : "0");
    } catch {
      // Private mode — silent.
    }
  }, [showRotationTally]);

  // Tournament splash — when the game is a tournament fixture, dial
  // up the broadcast-graphic accents (animated gold shimmer on the
  // header underline + the LINEUP chyron, "TOURNAMENT" pre-title with
  // a Trophy icon). Purely visual; no behavioral changes. The
  // tournament-specific batting-order math (top-of-order OPS, etc.)
  // already runs upstream in the lineup generator.
  const isTournament = game?.gameType === "tournament";
  // ── Stakes Ladder ─────────────────────────────────────────────────
  // ONE Field Display, five escalating game-context rungs. The persistent
  // chrome is painted in the TEAM's accent color (see the broadcast→accent
  // migration); gold returns ONLY at the championship rungs, where the
  // `[data-fd-mode]` CSS re-points --accent to the fixed broadcast gold so
  // it reads as a sparing "trophy metal" reward on top of the team's own
  // identity — NOT as the app's default accent.
  //
  // Rung derivation (priority order):
  //   champ-elevated → championship game AND our team currently leads
  //                    (the momentum PEAK; reuses the same take-the-lead
  //                     beat that already fires celebration confetti)
  //   champ          → championship game (flagged, or kebab-forced)
  //   bracket        → tournament game in the bracket stage
  //   pool           → any other tournament game
  //   league         → everything else (calm, team-quiet default)
  const bracketStage =
    game?.bracketStage === "bracket"
      ? "bracket"
      : game?.bracketStage === "pool"
        ? "pool"
        : null;
  const fieldMode: "league" | "pool" | "bracket" | "champ" | "champ-elevated" =
    isTournament && championshipMode
      ? ourScore > oppScore
        ? "champ-elevated"
        : "champ"
      : isTournament && bracketStage === "bracket"
        ? "bracket"
        : isTournament
          ? "pool"
          : "league";

  // One-shot joyful "welcome to the championship!" confetti. Fires once
  // when Championship Mode flips ON for this game (game loads as a
  // championship, or the coach toggles it via the kebab) — a soft, party-
  // colored sprinkle, NOT the big take-the-lead barrage. Deliberately
  // gentle so it delights the kids without being stress-inducing.
  // The component isn't guaranteed to remount on a route-param change, so
  // the latch keys on `id` (below) and we gate on `game?.id === id` to
  // ensure each game — including navigating straight from one championship
  // game to another — gets exactly one welcome and never fires off stale
  // previous-game data mid-navigation.
  const prevChampOnRef = useRef(false);
  const champWelcomeIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (champWelcomeIdRef.current !== id) {
      champWelcomeIdRef.current = id;
      prevChampOnRef.current = false;
    }
    const champOn = isTournament && championshipMode && game?.id === id;
    if (champOn && !prevChampOnRef.current) {
      fireChampionshipWelcome(confettiFireRef.current);
    }
    prevChampOnRef.current = champOn;
  }, [id, isTournament, championshipMode, game?.id]);

  // Time-of-day palette, unless the coach has flipped on Sunlight mode —
  // in which case force the brightest preset (`morning`) regardless of
  // game time, so a 7pm tournament under stadium lights still gets the
  // washed-out-by-sun treatment when needed (e.g. east-facing dugout
  // staring straight into a low afternoon sun).
  const lighting = useMemo(
    () =>
      sunlightMode
        ? FIELD_LIGHTING.morning
        : FIELD_LIGHTING[getLightingMode(game?.gameDate)],
    [game?.gameDate, sunlightMode],
  );

  // Dim Mode — drops a translucent black overlay across the whole page so the
  // iPad's backlight isn't pumping out full brightness during dead time
  // (between innings, between games on a 3-game weekend, etc). On LCD iPads
  // this is a perceptual dimmer that also nudges the user to drop the system
  // brightness slider; on OLED it directly saves battery because dark pixels
  // are off pixels. Persisted to localStorage so an accidental Exit → back
  // doesn't lose the setting mid-game.
  // Phone-portrait tab state. The field display has three responsive layouts:
  //   - Phone portrait (max-md:portrait:): single-panel-at-a-time with a
  //     bottom tab bar — coach swaps between FIELD (diagram + bench strip)
  //     and ORDER (full-bleed batting list) instead of stacking them.
  //   - Phone landscape (max-lg:landscape:) and iPad/desktop (lg:): the
  //     original split layout — both panels visible at once.
  // The tab state is purely UI-only; nothing else in the page reads it.
  // Defaults to "field" because that's what coaches glance at most often
  // mid-inning. State is intentionally not persisted — switching games or
  // reloading should land back on the field.
  const [mobileTab, setMobileTab] = useState<"field" | "order">("field");

  /**
   * Apply a single drag-drop move to the lineup. Mirrors the semantics from
   * game-detail.tsx so a coach who learned the gestures on the planning view
   * gets the same behavior on the dugout-fence iPad:
   *   field  → field player    : SWAP positions (both stay on the field)
   *   field  → bench player    : SWAP (source onto bench, bench onto field)
   *   field  → empty field cell: MOVE (source position becomes "Open")
   *   field  → bench area      : MOVE source to bench
   *   bench  → field player    : SWAP (source takes pos, displaced → bench)
   *   bench  → empty field cell: MOVE (bench player into open slot)
   *   bench  → bench player    : no-op
   *   bench  → bench area      : no-op
   * All operations are constrained to `currentInning` (the only inning the
   * iPad is showing); cross-inning drops aren't possible because chips for
   * other innings aren't even rendered.
   */
  const applyMove = (sourceEntryId: number, target: MoveTarget): LineupEntry[] | null => {
    const sourceEntry = lineup.find((e) => e.id === sourceEntryId);
    if (!sourceEntry) return null;
    if (sourceEntry.inning !== currentInning) return null;

    if (target.kind === "tile") {
      if (target.entryId === sourceEntry.id) return null;
      const targetEntry = lineup.find((e) => e.id === target.entryId);
      if (!targetEntry) return null;
      if (targetEntry.inning !== currentInning) return null;
      if (sourceEntry.position === "Bench" && targetEntry.position === "Bench") return null;
      if (targetEntry.position === "Bench") {
        // Field source onto bench player → swap, both seats keep an occupant.
        return lineup.map((e) => {
          if (e.id === sourceEntry.id) return { ...e, position: "Bench" };
          if (e.id === targetEntry.id) return { ...e, position: sourceEntry.position };
          return e;
        });
      }
      if (sourceEntry.position === "Bench") {
        // Bench source onto field player → source takes the field, target sits.
        return lineup.map((e) => {
          if (e.id === sourceEntry.id) return { ...e, position: targetEntry.position };
          if (e.id === targetEntry.id) return { ...e, position: "Bench" };
          return e;
        });
      }
      // Field-to-field swap.
      const sourcePos = sourceEntry.position;
      const targetPos = targetEntry.position;
      return lineup.map((e) => {
        if (e.id === sourceEntry.id) return { ...e, position: targetPos };
        if (e.id === targetEntry.id) return { ...e, position: sourcePos };
        return e;
      });
    }
    if (target.kind === "emptyField") {
      if (sourceEntry.position === target.position) return null;
      return lineup.map((e) =>
        e.id === sourceEntry.id ? { ...e, position: target.position } : e,
      );
    }
    // benchArea
    if (sourceEntry.position === "Bench") return null;
    return lineup.map((e) =>
      e.id === sourceEntry.id ? { ...e, position: "Bench" } : e,
    );
  };

  /**
   * Apply an optimistic lineup change and persist it. The chip snaps to its
   * new spot the instant the coach lifts their finger (cache update is
   * synchronous), then a serialized background save POSTs to the server.
   *
   * Concurrency model:
   *   • Cache update is immediate — UI never waits on the network.
   *   • Saves are chained through `saveQueueRef` so only one POST is in
   *     flight at a time. The server's REPLACE semantics mean racing POSTs
   *     could undo each other; serializing prevents that entirely.
   *   • Each chained save reads the LATEST optimistic lineup
   *     (`pendingLineupRef.current`) at save-time, not at queue-time. So
   *     three rapid drags during one in-flight save coalesce into a single
   *     follow-up POST carrying the final state — fewer server round trips
   *     and the server only ever sees consistent snapshots.
   *   • `cancelQueries` inside each save aborts any in-flight 5s poll so
   *     a stale poll response can't overwrite our optimistic state.
   *   • On failure we DON'T roll back to a snapshot (which could be stale
   *     and clobber newer successful state). Instead we invalidate the
   *     lineup so React Query refetches the authoritative server state,
   *     and toast so the coach knows their drag didn't take.
   *   • On success we also invalidate season + per-player stats queries —
   *     position counts changed, so fairness math on the Stats tab needs
   *     a refresh on next view.
   */
  const flushSave = () => {
    const queryKey = getGetGameLineupQueryKey(id);
    // Wrap the ENTIRE queued body in try/catch — if anything outside the
    // mutateAsync (e.g. cancelQueries) ever rejects, the chain promise
    // would become permanently rejected and every future flushSave
    // would silently no-op. Belt-and-suspenders: also append a terminal
    // `.catch(()=>{})` to the reassigned chain so we can never end up
    // with a rejected saveQueueRef.
    saveQueueRef.current = saveQueueRef.current
      .then(async () => {
        const toSave = pendingLineupRef.current;
        if (!toSave) return;
        // ── DATA-LOSS FIX (May 2026, Part 2) ──
        // Re-assert the optimistic cache on every drain attempt. The
        // App-level <OnlineResumer> calls qc.invalidateQueries() with
        // no key filter on the browser `online` event, which forks a
        // refetch of THIS lineup query that returns the stale server
        // snapshot — clobbering the dugout coach's offline drags
        // before flushSave can POST them. We can't change OnlineResumer
        // (it's needed for the rest of the app's queue), so we make
        // the field display defensive: any time we still have pending
        // edits, the cache reflects them. Cheap; setQueryData is a
        // synchronous structural-share write.
        qc.setQueryData(queryKey, toSave);
        // OFFLINE FAST-PATH: if the browser knows we have no network, do
        // not even attempt the POST. Leave pendingLineupRef + the
        // localStorage backup in place; the online-flip effect will
        // re-call flushSave when connectivity returns.
        if (typeof navigator !== "undefined" && !navigator.onLine) return;

        // Mark as in-flight so a follow-up drag during this save sets a
        // fresh ref value (which the next chained .then will pick up).
        pendingLineupRef.current = null;
        try {
          await qc.cancelQueries({ queryKey });
          await saveLineup.mutateAsync({
            id,
            data: {
              entries: toSave.map((e) => ({
                playerId: e.playerId,
                inning: e.inning,
                position: e.position,
                battingOrder: e.battingOrder ?? null,
              })),
            },
          });
          // Save succeeded. Only clear the offline backup if NO newer
          // drag came in while we were saving — if pendingLineupRef is
          // already non-null, the next chained save will handle it and
          // we must not wipe its localStorage entry.
          if (pendingLineupRef.current == null) {
            clearKey(pendingSaveKey(id));
            setHasUnsyncedLineup(false);
          }
          setLastSavedAt(Date.now());
          qc.invalidateQueries({ queryKey });
          qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() });
        } catch {
          // ───────── DATA-LOSS FIX (May 2026) ─────────
          // We used to distinguish "offline drop" (restore pending) from
          // "real server error" (CLEAR pending + refetch + toast). The
          // problem: `navigator.onLine` reports `true` on flaky/captive-
          // portal connections where the actual fetch fails, so a coach
          // editing the lineup at a sketchy ballpark would have their
          // edits silently wiped — pending cleared, query invalidated,
          // and the screen snapped back to the stale server state. The
          // `online` event eventually firing did NOT recover the data
          // because by then we'd already destroyed the localStorage
          // backup.
          //
          // New policy: ANY thrown error is treated as transient. Keep
          // the pending write in localStorage + ref, do NOT invalidate
          // the query (which would overwrite optimistic state with stale
          // server data), and let the backup-drain timer / online-event
          // / next user action retry the POST. Worst case on a real
          // 4xx/5xx is the coach sees "Offline · will sync" forever —
          // they can reload to inspect — but no edit is ever lost
          // without a successful round trip.
          if (pendingLineupRef.current == null) {
            pendingLineupRef.current = toSave;
            saveJSON(pendingSaveKey(id), toSave);
          }
          setHasUnsyncedLineup(true);
        }
      })
      .catch(() => {
        // Defensive — keep the queue alive no matter what.
      });
  };

  /**
   * Inner save — commits the move to React Query, localStorage, and the
   * pending-write queue, then ALSO queues a pitcher-removal prompt if
   * the move took someone off the mound. Split out from
   * `saveLineupOptimistically` so the tapped-out-pitcher warning below
   * can gate the move behind a confirm dialog without duplicating any
   * of the save/queue logic.
   */
  const _commitLineupSave = (nextLineup: LineupEntry[]) => {
    // ── Pitcher-removal detection ──
    // Compare who's at "P" in the CURRENT inning before vs. after the
    // move. Anyone who came off the mound — whether swapped to bench
    // or swapped with another fielder — gets prompted for their pitch
    // count so the tournament-day availability math stays honest. We
    // read PREVIOUS state from the React-Query cache (since `lineup`
    // here is the closed-over value at apply-time, which is the right
    // pre-move snapshot). One drag can only displace one P slot, so we
    // queue removals serially rather than batch-prompting.
    const prevP = lineup
      .filter((e) => e.inning === currentInning && e.position === "P")
      .map((e) => e.playerId);
    const nextP = nextLineup
      .filter((e) => e.inning === currentInning && e.position === "P")
      .map((e) => e.playerId);
    const removedPlayerIds = prevP.filter((pid) => !nextP.includes(pid));
    if (removedPlayerIds.length > 0) {
      // Find each removed player's display name from the current cache
      // and stage prompts. The prompt UI honors a queue so two rapid
      // P swaps (unusual but possible) both get captured.
      const additions = removedPlayerIds
        .map((pid) => {
          const entry = lineup.find((e) => e.playerId === pid);
          return entry ? { playerId: pid, playerName: entry.playerName } : null;
        })
        .filter((x): x is { playerId: number; playerName: string } => x != null);
      if (additions.length > 0) {
        setPitcherPromptQueue((q) => [...q, ...additions]);
      }
    }

    const queryKey = getGetGameLineupQueryKey(id);
    qc.setQueryData(queryKey, nextLineup);
    pendingLineupRef.current = nextLineup;
    // Persist the offline backup BEFORE attempting the POST so a Safari
    // crash / iPad reboot mid-save doesn't lose the drag. flushSave will
    // clear this entry on success.
    saveJSON(pendingSaveKey(id), nextLineup);
    setHasUnsyncedLineup(true);
    // flushSave is offline-aware: it'll skip the POST and just leave
    // pending in place if we're offline, then drain on reconnect.
    flushSave();
  };

  const saveLineupOptimistically = (nextLineup: LineupEntry[]) => {
    // ── Tapped-out-pitcher guardrail ──
    // For tournaments we know each pitcher's pitchesAvailableToday
    // (server computes it from tournament daily/total caps minus
    // logged pitches). Before we let a coach drop someone onto "P"
    // who's at or over their cap, we surface a confirm: the cap might
    // be wrong, or the coach might be intentionally overriding (rules
    // vary by league), but it should never be a SILENT mistake. Only
    // pitchers being NEWLY assigned to P in this inning are checked —
    // re-saving a lineup that already had a tapped-out pitcher on the
    // mound (e.g. a non-P drag elsewhere) shouldn't nag.
    const prevPForCheck = lineup
      .filter((e) => e.inning === currentInning && e.position === "P")
      .map((e) => e.playerId);
    const nextPForCheck = nextLineup
      .filter((e) => e.inning === currentInning && e.position === "P")
      .map((e) => e.playerId);
    const newlyOnMound = nextPForCheck.filter((pid) => !prevPForCheck.includes(pid));
    if (tournamentId != null && tournament?.pitcherAvailability && newlyOnMound.length > 0) {
      for (const pid of newlyOnMound) {
        const avail = tournament.pitcherAvailability.find((a) => a.playerId === pid);
        // Null cap = "no cap configured" — render path treats it as
        // "—", so we treat it the same here (no warning). Only block
        // when a real numeric cap has been hit or crossed.
        if (avail && avail.pitchesAvailableToday !== null && avail.pitchesAvailableToday <= 0) {
          setTappedOutWarning({
            nextLineup,
            playerName: avail.playerName,
            pitchesToday: avail.pitchesToday,
            dailyMax: avail.dailyMax,
          });
          // Bail BEFORE committing — the dialog's Confirm action calls
          // _commitLineupSave(nextLineup) directly. Cancel just drops
          // the staged move so the drag effectively undoes itself.
          return;
        }
      }
    }
    // ── "No bench 2 of 3 innings" guardrail ──
    // If the coach has the rule on and this move would NEWLY put someone on
    // the bench in 2 of 3 consecutive innings, surface a confirm so it's
    // never a silent mistake. Coach can still override (Bench anyway).
    if (noBenchTwoOfThreeActive) {
      const violators = findNewBenchRuleViolations(
        lineup,
        nextLineup,
        currentInning,
      );
      if (violators.length > 0) {
        setBenchRuleWarning({ nextLineup, playerNames: violators });
        return;
      }
    }
    _commitLineupSave(nextLineup);
  };

  /**
   * Game-patch sibling of `flushSave`. Drains `pendingGamePatchRef` (a
   * partial Game body like `{ ourScore: 5 }`) through a single-flight
   * chain with the same offline detection + coalescing semantics:
   *
   *   • Single in-flight at a time (saveGameQueueRef chain).
   *   • Reads the LATEST pending patch at save-time (so rapid taps
   *     coalesce — newer fields overwrite older for the same key,
   *     different keys merge).
   *   • Skips the actual PATCH if `navigator.onLine` is false; the
   *     online-flip effect re-calls flushGameSave on reconnect.
   *   • On offline-failure mid-flight, restores `pendingGamePatchRef`
   *     only if no NEWER patch came in during the in-flight window.
   *   • On real server error, drops the pending patch + invalidates
   *     so the UI snaps back to the server's authoritative score, plus
   *     a toast so the coach knows their tap didn't take.
   */
  const flushGameSave = () => {
    const queryKey = getGetGameQueryKey(id);
    saveGameQueueRef.current = saveGameQueueRef.current
      .then(async () => {
        const patch = pendingGamePatchRef.current;
        if (!patch) return;
        // Re-assert optimistic patch on the cache for the same reason
        // as flushSave above — the App-level <OnlineResumer> can have
        // refetched and clobbered our optimistic score during the
        // offline → online flip. Merge so any newly-fetched server
        // fields ride along; our pending field values overwrite.
        qc.setQueryData(queryKey, (prev: Game | undefined) =>
          prev ? { ...prev, ...patch } : prev,
        );
        if (typeof navigator !== "undefined" && !navigator.onLine) return;

        pendingGamePatchRef.current = null;
        try {
          await qc.cancelQueries({ queryKey });
          await updateGame.mutateAsync({ id, data: patch });
          if (pendingGamePatchRef.current == null) {
            clearKey(pendingGamePatchKey(id));
            setHasUnsyncedScore(false);
          }
          setLastSavedAt(Date.now());
          qc.invalidateQueries({ queryKey });
        } catch {
          // Same data-loss-prevention policy as flushSave above. Treat
          // every failed PATCH as transient and keep the pending patch
          // in localStorage + ref so the retry timer (or the next
          // online-event flip) drains it. We must NOT invalidate the
          // query here — doing so refetches stale server data and
          // wipes the coach's optimistic score from the screen, which
          // is what was happening on flaky-WiFi setups where
          // `navigator.onLine` lies.
          if (pendingGamePatchRef.current == null) {
            pendingGamePatchRef.current = patch;
            saveJSON(pendingGamePatchKey(id), patch);
          }
          setHasUnsyncedScore(true);
        }
      })
      .catch(() => {
        // Defensive — keep the chain alive no matter what.
      });
  };

  /**
   * Apply a partial game patch (e.g. `{ ourScore: 5 }`) optimistically:
   * update React Query's cache, merge into the pending ref so multiple
   * rapid updates coalesce (latest value wins per field), persist the
   * merged pending to localStorage so a refresh doesn't lose it, and
   * kick the save chain. flushGameSave skips the PATCH when offline.
   */
  const saveGamePatchOptimistically = (patch: UpdateGameBody) => {
    const queryKey = getGetGameQueryKey(id);
    qc.setQueryData(queryKey, (prev: Game | undefined) =>
      prev ? { ...prev, ...patch } : prev,
    );
    // Merge field-by-field: newer field values overwrite older for the
    // same key (e.g. two rapid +1 taps on ourScore: only the latest
    // ourScore matters), but different keys accumulate (ourScore +
    // opponentScore both ride along in a single PATCH).
    pendingGamePatchRef.current = {
      ...pendingGamePatchRef.current,
      ...patch,
    };
    saveJSON(pendingGamePatchKey(id), pendingGamePatchRef.current);
    setHasUnsyncedScore(true);
    flushGameSave();
  };

  const handleDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (!id.startsWith("player-")) return;
    setActiveDragEntryId(parseInt(id.slice("player-".length), 10));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragEntryId(null);
    lastDragEndAtRef.current = Date.now();
    if (!e.over) return;
    const sourceId = String(e.active.id);
    if (!sourceId.startsWith("player-")) return;
    const sourceEntryId = parseInt(sourceId.slice("player-".length), 10);
    const target = e.over.data.current as MoveTarget | undefined;
    if (!target) return;
    const next = applyMove(sourceEntryId, target);
    if (next) saveLineupOptimistically(next);
  };

  const handleDragCancel = () => {
    setActiveDragEntryId(null);
    lastDragEndAtRef.current = Date.now();
  };

  // ── Tap-to-swap handlers ──
  // Tapping a chip selects it (golden ring + banner). Tapping a second chip
  // swaps the two for the current inning. Tapping the same chip again
  // cancels the selection. Tapping an empty position or the bench (when
  // something is selected) moves the selection there. All paths route through
  // applyMove + saveLineupOptimistically so the offline queue / single-flight
  // POST chain handles the persistence the same way drag does.
  const handleChipTap = (entryId: number) => {
    // Suppress the synthetic click that browsers fire on the source chip
    // immediately after a drag ends — without this, every drag would also
    // re-select its source for tap-to-swap.
    if (justFinishedDragging()) return;
    if (selectedEntryId === entryId) {
      setSelectedEntryId(null);
      return;
    }
    if (selectedEntryId == null) {
      setSelectedEntryId(entryId);
      return;
    }
    const tapped = lineup.find((e) => e.id === entryId);
    if (!tapped || tapped.inning !== currentInning) {
      // Stale/cross-inning — just shift selection to the freshly tapped chip.
      setSelectedEntryId(entryId);
      return;
    }
    const next = applyMove(selectedEntryId, {
      kind: "tile",
      entryId,
      position: tapped.position,
    });
    if (next) saveLineupOptimistically(next);
    setSelectedEntryId(null);
  };

  const handleEmptyFieldTap = (position: FieldPos) => {
    if (justFinishedDragging()) return;
    if (selectedEntryId == null) return;
    const next = applyMove(selectedEntryId, { kind: "emptyField", position });
    if (next) saveLineupOptimistically(next);
    setSelectedEntryId(null);
  };

  const handleBenchAreaTap = () => {
    if (justFinishedDragging()) return;
    if (selectedEntryId == null) return;
    const next = applyMove(selectedEntryId, { kind: "benchArea" });
    if (next) saveLineupOptimistically(next);
    setSelectedEntryId(null);
  };

  // Clear any in-progress selection when the inning changes (chips for the
  // selected entry are no longer rendered) or when a drag begins (the drag
  // path will own the swap).
  useEffect(() => {
    setSelectedEntryId(null);
  }, [currentInning]);
  useEffect(() => {
    if (activeDragEntryId != null) setSelectedEntryId(null);
  }, [activeDragEntryId]);

  // Resolve the selected chip's display details for the swap-mode banner.
  const selectedInfo = useMemo(() => {
    if (selectedEntryId == null) return null;
    const e = lineup.find((x) => x.id === selectedEntryId && x.inning === currentInning);
    return e ? { name: e.playerName, position: e.position } : null;
  }, [selectedEntryId, lineup, currentInning]);

  // Resolve the floating chip's player name for the DragOverlay preview.
  const activeDragInfo = useMemo(() => {
    if (activeDragEntryId == null) return null;
    const entry = lineup.find((e) => e.id === activeDragEntryId);
    return entry ? { name: entry.playerName, position: entry.position } : null;
  }, [activeDragEntryId, lineup]);

  // Toggle browser fullscreen — gives an iPad-mounted display the most real
  // estate possible. Falls back gracefully if the API isn't available (some
  // older iPad Safari versions).
  const toggleFullscreen = () => {
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
    };
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (document.fullscreenElement) {
      void (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    } else {
      void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
    }
  };

  // Keep the iPad screen awake while this page is open. Wake Lock is supported
  // on iPadOS 16.4+ Safari and recent Chrome/Edge. iOS auto-releases the lock
  // whenever the tab is backgrounded, the device locks, or low-power mode kicks
  // in. To survive a 2-hour ballgame we MUST listen for the sentinel's
  // "release" event (clear our reference so it can be reacquired) and try to
  // reacquire on every visibility / focus / pageshow event.
  useEffect(() => {
    type WakeLockSentinel = {
      release: () => Promise<void>;
      addEventListener: (type: "release", cb: () => void) => void;
      removeEventListener: (type: "release", cb: () => void) => void;
    };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const onRelease = () => {
      // Browser/OS released our lock (background, lock screen, low-power).
      // Null our ref so the next visibility/focus event can re-request it.
      lock = null;
    };

    const acquire = async () => {
      if (cancelled || lock) return;
      if (document.visibilityState !== "visible") return;
      try {
        const next = await nav.wakeLock!.request("screen");
        if (cancelled) {
          void next.release();
          return;
        }
        next.addEventListener("release", onRelease);
        lock = next;
      } catch {
        // Throws when the page isn't visible, when permission is denied,
        // or on unsupported browsers — fall back to OS auto-lock silently.
      }
    };

    void acquire();
    const tryReacquire = () => void acquire();
    document.addEventListener("visibilitychange", tryReacquire);
    window.addEventListener("focus", tryReacquire);
    window.addEventListener("pageshow", tryReacquire);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", tryReacquire);
      window.removeEventListener("focus", tryReacquire);
      window.removeEventListener("pageshow", tryReacquire);
      if (lock) {
        lock.removeEventListener("release", onRelease);
        void lock.release();
      }
    };
  }, []);

  if (!id) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-slate-950 text-slate-100">
        <p>Game not found.</p>
      </div>
    );
  }

  return (
    // Lock the page to the viewport on tablet+ so the field, bench, and
    // sidebar all fit without scrolling. On phones (sub-lg) we relax the
    // height so the stacked layout can grow naturally.
    <div
      className={`min-h-[100dvh] max-lg:h-[100dvh] lg:h-[100dvh] bg-black text-slate-100 flex flex-col select-none max-lg:overflow-hidden lg:overflow-hidden ${
        fieldMode === "champ" || fieldMode === "champ-elevated"
          ? "fd-championship"
          : ""
      } ${fieldMode === "champ-elevated" ? "fd-champ-elevated" : ""}`}
      data-fd-mode={fieldMode}
      data-championship={
        fieldMode === "champ" || fieldMode === "champ-elevated"
          ? "true"
          : undefined
      }
    >
      {/* Take-the-lead celebration overlay — portaled to document.body
       *  so it can't be clipped by any ancestor stacking context (the
       *  iPad layout has several full-viewport overlays for dim mode,
       *  fullscreen letterboxing, etc. that were sitting on top of the
       *  library's auto-created canvas). Pointer-events none so it
       *  never eats taps. zIndex set on the parent element wrapper. */}
      {typeof document !== "undefined" &&
        createPortal(
          <div
            aria-hidden="true"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2147483646,
              pointerEvents: "none",
            }}
          >
            <canvas
              ref={confettiCanvasRef}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            />
            <div
              ref={celebrateFlashRef}
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(circle at 50% 45%, rgba(255,210,76,0.55) 0%, rgba(255,210,76,0.25) 30%, rgba(28,61,122,0) 70%)",
                opacity: 0,
                transition: "opacity 220ms ease-out",
                pointerEvents: "none",
                mixBlendMode: "screen",
              }}
            />
          </div>,
          document.body,
        )}
      {/* Stakes Ladder banner — escalating game-context ribbon. Absent in
       *  plain league play; appears for pool/bracket and turns into a gold
       *  trophy ribbon at the championship rungs. shrink-0 so it never
       *  steals flex space from the field. aria-hidden — the same context
       *  is already conveyed by the game record + matchup title for AT
       *  users, and this is decorative chrome. */}
      {fieldMode !== "league" && (
        <div
          className="fd-stakes-banner"
          data-fd-mode={fieldMode}
          aria-hidden="true"
          data-testid="fd-stakes-banner"
        >
          {fieldMode === "pool"
            ? "Pool Play"
            : fieldMode === "bracket"
              ? "Bracket \u00B7 Win or Go Home"
              : "\u{1F3C6} Championship \u{1F3C6}"}
        </div>
      )}
      {/* Floating trophy flecks — championship PEAK only (our team leading
       *  the title game). Deterministic offsets so they don't re-jitter on
       *  every render; the whole layer is hidden under
       *  prefers-reduced-motion (see index.css). */}
      {fieldMode === "champ-elevated" && (
        <div className="fd-champ-flecks" aria-hidden="true">
          {Array.from({ length: 16 }).map((_, i) => (
            <span
              key={i}
              style={{
                left: `${(i * 6.3) % 100}%`,
                animationDelay: `-${((i * 0.7) % 6).toFixed(2)}s`,
                animationDuration: `${5 + (i % 4)}s`,
              }}
            />
          ))}
        </div>
      )}
      {/* ── Header — broadcast lower-third (combined: team + inning + score + actions) ──
       *
       * Mobile layout note: the original single-row header packed exit +
       * team-name + inning controls + live status + timer + score steppers +
       * end-game + brightness + fullscreen onto one line, which overflowed
       * the right edge of phone viewports — coaches couldn't see (or tap)
       * Exit, Fullscreen, or the score. Now the header wraps to two rows on
       * mobile (`flex-wrap`), Exit is enlarged into a real touch target, and
       * the secondary actions (End Game / Brightness / Fullscreen) collapse
       * into a kebab dropdown below the `sm` breakpoint. The desktop layout
       * is unchanged.
       */}
      {/* Mobile layout strategy:
       *  - Header is a wrapping flex row at every viewport. The identity
       *    cluster (Exit + team-vs-opp) gets `w-full` on mobile so it
       *    forces a row-break, owning row 1 by itself — the team name
       *    no longer fights the inning chip for horizontal space.
       *  - Center (inning chip) + right (timer/score/kebab) then sit
       *    together on row 2. The header's existing `justify-between`
       *    naturally pins inning to the left edge and scores to the
       *    right edge of that row, no extra wrapper needed.
       *  - Desktop layout is byte-identical to before because at `sm:`
       *    the left cluster reverts to `flex-1` and all three clusters
       *    fit on a single row.
       *  Earlier iteration used a `sm:contents` shim around center+right
       *  to coerce a justify-between row on mobile; that triggered a
       *  visual overlap of the inning chevron and the Exit button on
       *  iPad Safari (display:contents has known quirks as a flex item
       *  in WebKit). The wrapper-free approach above sidesteps both. */}
      <header
        className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 sm:px-6 pb-2 ${isTournament ? "border-b-0" : "border-b-4 border-accent"} bg-[#0f172a] shadow-[0_4px_20px_rgba(0,0,0,0.5)] shrink-0 relative z-10`}
        style={{
          // iPad status bar (clock / WiFi / battery) sits on top of the
          // page in installed-PWA / fullscreen mode (we set
          // `apple-mobile-web-app-status-bar-style: black-translucent`
          // in index.html) AND in landscape Safari above ~iPadOS 17.
          // Without this inset the inning ▲ chevron + EXTRA / battery
          // icons collide with the status bar — coaches reported the
          // top inning chevron was unreachable on a real iPad. The
          // `max()` keeps the original 0.5 rem padding for browsers
          // where the inset is 0 (e.g. desktop, non-PWA mobile). We
          // only override paddingTop here; horizontal padding is left
          // to the px-3 sm:px-6 classes above so the desktop layout
          // keeps its original 1.5 rem side margins.
          paddingTop: "max(0.5rem, env(safe-area-inset-top))",
        }}
      >
        {/* Left cluster: exit + team vs opponent */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 w-full sm:w-auto sm:flex-1">
          {/* Mobile Exit (back chevron). The earlier iteration removed
           *  this on the theory that the right-side End Game button
           *  was the single source of truth — but on phones the
           *  right-side button is gone (it collapses into the kebab),
           *  so coaches lost the obvious "get me out of here" gesture
           *  AND had to hunt for End Game inside a 3-item dropdown
           *  packed into the header's right edge near the safe-area.
           *  This back-chevron sits in the conventional top-left
           *  position, has a real 44×44 touch target, and opens the
           *  SAME EndGameDialog as everything else (so the score-entry
           *  + Just exit / Mark complete prompt still gates the bounce
           *  back to game-detail). Desktop is unchanged.
           */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEndGameDialogOpen(true)}
            className="sm:hidden h-11 w-11 p-0 shrink-0 border-accent/60 bg-[#0f172a] text-accent hover:bg-amber-950/40 hover:text-amber-200 rounded-md"
            data-testid="button-mobile-exit"
            aria-label="Exit field display"
            title="Exit field display"
            style={{ touchAction: "manipulation" }}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          {/* Team-vs-opponent title.
           *  (The desktop standalone "Exit" button was removed —
           *  coaches reported it was duplicative with the top-right
           *  "End Game" button since both opened the SAME end-game
           *  dialog. On desktop the End Game button is right there
           *  inline. On mobile we put the back-chevron above so the
           *  exit affordance isn't buried in the kebab.)
           *
           *  Sized down from the original text-4xl on lg because the
           *  header carries a lot of fixed-width siblings (inning chip,
           *  game timer, score steppers, dim toggle) and the leftover
           *  flex-1 space can't fit ~20-character team names at that
           *  size — they truncated mid-word. text-2xl on lg gives us
           *  comfortable room for typical youth-league names like
           *  "Wilsonville Blazers vs Scrappers" while still reading as
           *  a broadcast lower-third. tracking-wide (instead of
           *  tracking-wider) trims a few more pixels per character.
           *  whitespace-nowrap + min-w-0 means the truncate only
           *  engages on truly extreme names — the common case shows
           *  in full. */}
          {/* Team-vs-opponent title is hidden on phone-landscape so the
           *  inning + timer + score + kebab can fit on a single row.
           *  The exit chevron above stays visible so coaches still have
           *  the obvious "get me out" gesture. iPad portrait is sub-lg
           *  but portrait, so it KEEPS the title (room to breathe). */}
          <div className="min-w-0 flex-1 max-lg:landscape:hidden">
            <div className="font-display uppercase tracking-wide text-base sm:text-lg lg:text-2xl font-bold leading-none flex items-baseline gap-2 sm:gap-3 min-w-0">
              {/* Team-name display priority — kept consistent with the
               *  Schedule list and Game Detail header so editing the
               *  opponent on a game card updates the field display the
               *  same way:
               *  1) Coach-set short name from Settings (deliberate override
               *     for tight headers).
               *  2) Otherwise the FULL team name from settings (e.g.
               *     "Minnetonka Blue") — NOT auto-shortened, because the
               *     coach explicitly asked for the full settings name to
               *     show on every matchup.
               *  3) "Team" placeholder if settings haven't loaded yet.
               * Tooltip always shows the FULL official name so coaches can
               * still confirm they're looking at the right matchup. */}
              <span className="text-white truncate" title={teamName || undefined}>
                {teamShortName || teamName || "Team"}
              </span>
              <span className="text-slate-500 font-normal text-xs sm:text-sm shrink-0">vs.</span>
              {/* Opponent has no per-team short-name field, so just auto-shorten
               *  to the city. Falls back to the raw stored value if the
               *  shortener returns empty (matches Schedule list behavior). */}
              <span className="text-accent truncate" title={game?.opponent ?? undefined}>
                {formatOpponentForMatchup(game?.opponent, teamName) || game?.opponent || ""}
              </span>
            </div>
          </div>
        </div>

        {/* Center cluster: broadcast inning badge + compact controls.
         *  The black-bg + side-border "broadcast chip" treatment is
         *  scoped to `sm:` because on a phone, where the chip sits on
         *  its own row next to the score steppers, the heavy bg made
         *  the inning controls look like a free-floating modal that
         *  didn't belong with the rest of the header. */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0 sm:bg-[#050d1a] sm:border-l sm:border-r sm:border-[#1a2a42] px-0 sm:px-4 py-1">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setCurrentInning((i) => Math.max(1, i - 1))}
            disabled={currentInning <= 1}
            className="h-10 w-10 sm:h-11 sm:w-11 p-0 border-[#1a2a42] bg-[#0f172a] text-slate-100 hover:bg-slate-800 hover:text-accent disabled:opacity-30 rounded-none"
            data-testid="button-prev-inning"
            aria-label="Previous inning"
            /* `touch-action: manipulation` removes iOS Safari's 300 ms
             * "wait for double-tap-to-zoom" delay AND prevents the browser
             * from interpreting the tap as a potential zoom gesture, which
             * was making the chevron feel like it required two taps to
             * advance. */
            style={{ touchAction: "manipulation" }}
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <div className="text-center min-w-[68px] sm:min-w-[96px] px-1">
            <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.25em] text-slate-400 leading-none font-display font-semibold">
              Inning
            </div>
            <div
              className="text-2xl sm:text-3xl font-bold tabular-nums leading-none mt-1 font-['Roboto_Mono'] text-accent flex items-center justify-center gap-1"
              data-testid="text-current-inning"
            >
              <span aria-hidden="true" className="text-accent text-base sm:text-lg leading-none">▲</span>
              <span>{currentInning}</span>
              <span className="text-slate-600 text-sm sm:text-base font-bold">
                / {innings}
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            size="lg"
            onClick={() => setCurrentInning((i) => Math.min(innings, i + 1))}
            disabled={currentInning >= innings}
            className="h-10 w-10 sm:h-11 sm:w-11 p-0 border-[#1a2a42] bg-[#0f172a] text-slate-100 hover:bg-slate-800 hover:text-accent disabled:opacity-30 rounded-none"
            data-testid="button-next-inning"
            aria-label="Next inning"
            /* See prev-inning button for the touch-action rationale. */
            style={{ touchAction: "manipulation" }}
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
          {/* Extra-innings nudger.
            *
            * Only appears when the coach has navigated to the LAST inning
            * (the chevron-right is disabled at that point — this is the
            * "we're tied, going extras" escape hatch). Tapping bumps
            * `game.innings` by one through the same offline-aware PATCH
            * chain as score, so it survives a WiFi drop and instantly
            * unblocks the next-inning chevron above. We cap at 12 to
            * keep the inning chip readable in the broadcast bar — twelve
            * innings of youth ball is already a Cal Ripken story. */}
          {currentInning >= innings && innings < 12 && (
            <Button
              variant="outline"
              size="lg"
              onClick={() =>
                saveGamePatchOptimistically({ innings: innings + 1 })
              }
              className="h-10 px-2 sm:h-11 sm:px-3 border-accent/60 bg-[#0f172a] text-accent hover:bg-amber-950/40 hover:text-amber-200 rounded-none flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] font-display font-semibold"
              data-testid="button-add-extra-inning"
              aria-label="Add extra inning"
              title="Add an extra inning"
              /* Same touch-action rationale as the prev/next chevrons —
               * keep the inning cluster feeling instant on iOS. */
              style={{ touchAction: "manipulation" }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Extra</span>
            </Button>
          )}
          {/* Phone-portrait Start/Timer placement.
           *  On phone portrait the right cluster only has room for the
           *  3-dot kebab, so the GameTimer (Start button → running clock)
           *  was getting hidden behind score steppers and never seen. We
           *  render a second GameTimer here, INSIDE the inning cluster,
           *  visible only on phone portrait — so coaches see "Start" sit
           *  immediately to the right of the inning chevrons where they
           *  expect game-control buttons to live. The right-cluster
           *  GameTimer is hidden on phone portrait via `max-sm:hidden`.
           *  Two component instances tick independently but read the
           *  same `startedAt` prop so the displayed time matches; cost
           *  is one extra setInterval, acceptable for header-only UI. */}
          <div className="sm:hidden ml-1">
            <GameTimer
              startedAt={game?.startedAt ?? null}
              onStart={() =>
                saveGamePatchOptimistically({
                  startedAt: new Date().toISOString(),
                })
              }
              onReset={() => saveGamePatchOptimistically({ startedAt: null })}
              effectiveTimeLimits={game?.effectiveTimeLimits ?? null}
              bracketStage={
                game?.bracketStage === "pool" || game?.bracketStage === "bracket"
                  ? game.bracketStage
                  : null
              }
              gameId={game?.id}
            />
          </div>
        </div>

        {/* Right cluster: live status, score, fullscreen */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0 sm:flex-1 sm:justify-end">
          {/* Connection status badge.
            * Three visual states (priority order):
            *   OFFLINE — amber WifiOff icon + "Offline" or "Offline · will
            *             sync" if there are queued drag-drop edits waiting
            *             to POST when connectivity returns.
            *   JUST UPDATED — green pulse + "Just updated" for ~3s after
            *             any incoming lineup change (poll or our own save).
            *   LIVE — steady green dot + "Live" when online and idle.
            * The data-testid stays the same so existing e2e tests still
            * locate the element; the text content varies by state. */}
          <div
            aria-live="polite"
            className={`hidden md:flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-display font-semibold px-2 py-1 border transition-opacity duration-500 ${
              !online
                ? "text-amber-400 border-amber-400/60 bg-amber-950/30 opacity-100"
                : justUpdated
                  ? "text-emerald-400 border-emerald-400/60 bg-emerald-950/30 opacity-100"
                  : "text-slate-400 border-[#1a2a42] bg-[#050d1a] opacity-90"
            }`}
            data-testid="text-update-status"
            data-online={online ? "true" : "false"}
            data-pending={hasUnsyncedChanges ? "true" : "false"}
          >
            {!online ? (
              <>
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{hasUnsyncedChanges ? "Offline · will sync" : "Offline"}</span>
              </>
            ) : (
              <>
                <span
                  className={`inline-block h-2 w-2 ${
                    justUpdated ? "bg-emerald-400 animate-pulse" : "bg-emerald-500/70"
                  }`}
                  aria-hidden="true"
                />
                <span>
                  {hasUnsyncedChanges
                    ? "Syncing…"
                    : justUpdated
                      ? "Just updated"
                      : lastSavedAt != null
                        ? `Saved ${formatSavedAgo(lastSavedAt, Date.now())}`
                        : "Live"}
                </span>
              </>
            )}
          </div>
          {/* Tournament time-limit clock. "Start Game" button until the
            * coach taps it on first pitch, then a running MM:SS display
            * that ticks every second. Same offline-aware PATCH chain as
            * the score steppers below, so a tap during a WiFi drop is
            * saved locally and synced on reconnect — and parents on
            * their phones see the same elapsed time as the dugout iPad.
            * See GameTimer docblock for sync semantics. */}
          {/* Hidden on phone portrait — duplicate GameTimer renders
           *  inside the inning cluster above so Start sits next to the
           *  inning chevrons. sm+ keeps this one visible in the right
           *  cluster (the desktop layout). */}
          <div className="hidden sm:flex">
            <GameTimer
              startedAt={game?.startedAt ?? null}
              onStart={() =>
                saveGamePatchOptimistically({
                  startedAt: new Date().toISOString(),
                })
              }
              onReset={() => saveGamePatchOptimistically({ startedAt: null })}
              effectiveTimeLimits={game?.effectiveTimeLimits ?? null}
              bracketStage={
                game?.bracketStage === "pool" || game?.bracketStage === "bracket"
                  ? game.bracketStage
                  : null
              }
              gameId={game?.id}
            />
          </div>
          {/* Manual scoreboard input — until GameChanger integration
            * lands. Each side: tap chevron to step ±1, OR tap the
            * number to +1, OR swipe vertically on the number to ±1.
            * Score updates flow through the same offline-aware
            * single-flight save chain as lineup edits.
            *
            * Stepper labels use the SAME priority as the header
            * matchup title so the dugout iPad reads consistently:
            *  - own side: teamShortName override → full settings
            *    teamName → "Us" placeholder while loading.
            *  - opponent: city-shortened opponent → raw opponent →
            *    "Them" placeholder. Long names truncate inside the
            *    stepper column with a tooltip showing the full text.
            * See ScoreStepper docblock for gesture details. */}
          {/* Score steppers — DEFAULT placement (sm+, in the right
           *  cluster). Hidden on phone portrait; a duplicate row at the
           *  end of the header renders the same steppers full-width and
           *  left-aligned so the score is comfortable to read on a
           *  phone held vertically. */}
          <div className="hidden sm:flex items-center gap-1 sm:gap-2">
            <ScoreStepper
              value={ourScore}
              onChange={(next) =>
                saveGamePatchOptimistically({ ourScore: next })
              }
              ariaLabel="Our score"
              testId="score-stepper-ours"
              label={teamShortName || teamName || "Us"}
              championship={isTournament && championshipMode}
            />
            {/* Center-aligned dash so it sits at the same y as the
              * score numbers (which are now centered within their
              * column by the stepper's justify-center). */}
            <span className="text-3xl sm:text-4xl lg:text-5xl font-bold tabular-nums text-slate-700 leading-none font-['Roboto_Mono']">
              –
            </span>
            <ScoreStepper
              value={oppScore}
              onChange={(next) =>
                saveGamePatchOptimistically({ opponentScore: next })
              }
              ariaLabel="Opponent score"
              testId="score-stepper-opp"
              label={formatOpponentForMatchup(game?.opponent, teamName) || game?.opponent || "Them"}
              championship={isTournament && championshipMode}
            />
          </div>
          {/* End Game.
            *
            * Visible "I'm done coaching" button — distinct from the small
            * Exit chevron in the top-left because that one feels like
            * "step away" while this is a finalization. Confirms with a
            * native dialog (destructive enough to want a tap-tap, but
            * cheap enough to not warrant a full modal), then routes back
            * to the game-detail page where the coach can review/finalize
            * the score and mark the game complete. We do NOT auto-set
            * `status: "completed"` here on purpose — the score steppers
            * on the field display are good enough mid-game but a parent
            * keeping a real book usually wants to reconcile before
            * locking the record. */}
          {/* Top-right End Game (desktop). Same dialog target as the
           * Exit chevron and the mobile kebab — see the EndGameDialog
           * mounted near the bottom of the component for the actual
           * "mark complete + upload box score" branching. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEndGameDialogOpen(true)}
            className="hidden sm:flex items-center gap-1.5 border-accent/60 bg-[#0f172a] text-accent hover:bg-amber-950/40 hover:text-amber-200 px-3 py-1 text-[10px] uppercase tracking-[0.2em] font-display font-semibold rounded-none"
            data-testid="button-end-game"
            aria-label="End game or exit"
            title="End game or exit without ending"
          >
            <Flag className="h-3.5 w-3.5" aria-hidden="true" />
            End Game / Exit
          </Button>
          {/* Brightness cycle: Auto → Sunlight → Dim → Auto. One tap to
            * advance; the icon shows what mode is currently active so
            * the coach can read it at a glance without remembering what
            * the next tap does.
            *
            * Hidden below `sm` — the same action is available from the
            * mobile kebab dropdown to keep the phone header from
            * overflowing horizontally. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={cycleBrightness}
            className={`hidden sm:inline-flex px-2 ${
              sunlightMode
                ? "text-amber-300 hover:text-amber-200 hover:bg-slate-800/60"
                : dimMode
                  ? "text-accent hover:text-amber-200 hover:bg-slate-800/60"
                  : "text-slate-500 hover:text-white hover:bg-slate-800/60"
            }`}
            aria-label={
              sunlightMode
                ? "Sunlight mode on — tap to dim screen"
                : dimMode
                  ? "Dim mode on — tap to return to auto"
                  : "Auto brightness — tap for sunlight mode"
            }
            title={
              sunlightMode
                ? "Sunlight (max contrast for direct sun) — tap to dim"
                : dimMode
                  ? "Dim (saves battery) — tap to return to auto"
                  : "Auto brightness — tap for sunlight mode"
            }
            data-testid="button-brightness-mode"
            data-brightness-mode={brightnessMode}
          >
            {sunlightMode ? (
              <Sun className="h-4 w-4" />
            ) : dimMode ? (
              <Moon className="h-4 w-4" />
            ) : (
              <SunDim className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="hidden sm:inline-flex text-slate-500 hover:text-white hover:bg-slate-800/60 px-2"
            aria-label="Toggle fullscreen"
            data-testid="button-fullscreen"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          {/* Mobile-only "More" kebab.
           *
           * On phones the right-hand cluster used to keep growing past
           * the viewport edge, hiding End Game / Brightness / Fullscreen
           * entirely. Below the `sm` breakpoint we collapse those three
           * actions into a single dropdown so the header stays inside
           * the viewport and every action remains reachable with one
           * tap. (Desktop keeps the inline buttons unchanged.) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="sm:hidden">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 text-slate-200 hover:text-white hover:bg-slate-800/60 border border-slate-700/50 rounded-md"
                aria-label="More field display actions"
                data-testid="button-field-display-more"
                style={{ touchAction: "manipulation" }}
              >
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="min-w-[14rem]"
            >
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  cycleBrightness();
                }}
                data-testid="menu-brightness-mode"
              >
                {sunlightMode ? (
                  <Sun className="h-4 w-4 mr-2" />
                ) : dimMode ? (
                  <Moon className="h-4 w-4 mr-2" />
                ) : (
                  <SunDim className="h-4 w-4 mr-2" />
                )}
                <span>
                  {sunlightMode
                    ? "Sunlight — tap to dim"
                    : dimMode
                      ? "Dim — tap for auto"
                      : "Auto — tap for sunlight"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  toggleFullscreen();
                }}
                data-testid="menu-fullscreen"
              >
                <Maximize2 className="h-4 w-4 mr-2" />
                <span>Toggle fullscreen</span>
              </DropdownMenuItem>
              {tournamentId != null && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowTournamentPitches((v) => !v);
                  }}
                  data-testid="menu-tournament-pitches"
                >
                  <Trophy className="h-4 w-4 mr-2" />
                  <span>
                    {showTournamentPitches
                      ? "Hide tournament pitches"
                      : "Show tournament pitches"}
                  </span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setShowRotationTally((v) => !v);
                }}
                data-testid="menu-rotation-tally"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                <span>
                  {showRotationTally
                    ? "Hide rotation tally"
                    : "Show rotation tally"}
                </span>
              </DropdownMenuItem>
              {isTournament && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setChampOverride(!championshipMode);
                  }}
                  data-testid="menu-championship-mode"
                >
                  <Crown className="h-4 w-4 mr-2 text-accent" />
                  <span>
                    {championshipMode
                      ? "Exit Championship Mode"
                      : "Championship Mode"}
                  </span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setCelebrate((v) => !v);
                }}
                data-testid="menu-celebrate-take-lead"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                <span>
                  {celebrate
                    ? "Mute take-lead fireworks"
                    : "Take-lead fireworks: on"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setCelebrateSound((v) => !v);
                  // Prime the audio context on this gesture so the
                  // very next celebration can play without waiting for
                  // another tap.
                  if (!audioCtxRef.current) {
                    try {
                      const Ctor =
                        window.AudioContext ||
                        (
                          window as unknown as {
                            webkitAudioContext?: typeof AudioContext;
                          }
                        ).webkitAudioContext;
                      if (Ctor) audioCtxRef.current = new Ctor();
                    } catch {
                      /* audio unavailable */
                    }
                  }
                  void audioCtxRef.current?.resume();
                }}
                data-testid="menu-celebrate-sound"
              >
                {celebrateSound ? (
                  <Volume2 className="h-4 w-4 mr-2" />
                ) : (
                  <VolumeX className="h-4 w-4 mr-2" />
                )}
                <span>
                  {celebrateSound
                    ? "Mute celebration sounds"
                    : "Celebration sounds: on"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-accent focus:text-amber-200"
                onSelect={(e) => {
                  e.preventDefault();
                  setEndGameDialogOpen(true);
                }}
                data-testid="menu-end-game"
              >
                <Flag className="h-4 w-4 mr-2" />
                <span>End game / Exit</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Phone-portrait score row.
         *  Forces a row break (flex-wrap parent + basis-full child) and
         *  renders the score steppers full-width left-aligned, so the
         *  score sits on its own line below "inning + Start + kebab".
         *  Hidden on sm+ where the score lives inline in the right
         *  cluster above. */}
        <div className="sm:hidden basis-full w-full flex items-center gap-1 justify-start pt-1" data-testid="header-score-row-portrait">
          <ScoreStepper
            value={ourScore}
            onChange={(next) =>
              saveGamePatchOptimistically({ ourScore: next })
            }
            ariaLabel="Our score"
            testId="score-stepper-ours-portrait"
            label={teamShortName || teamName || "Us"}
            championship={isTournament && championshipMode}
          />
          <span className="text-3xl font-bold tabular-nums text-slate-700 leading-none font-['Roboto_Mono']">
            –
          </span>
          <ScoreStepper
            value={oppScore}
            onChange={(next) =>
              saveGamePatchOptimistically({ opponentScore: next })
            }
            ariaLabel="Opponent score"
            testId="score-stepper-opp-portrait"
            label={formatOpponentForMatchup(game?.opponent, teamName) || game?.opponent || "Them"}
            championship={isTournament && championshipMode}
          />
        </div>
        {/* Tournament splash — static gold gradient underline so the
         *  header reads as a "this game matters more" broadcast chyron.
         *  Absolutely positioned at the bottom of the header so it
         *  doesn't reflow any layout vs. the league-game border-b-4
         *  path. */}
        {isTournament && (
          <div
            aria-hidden="true"
            className={`${championshipMode ? "fd-champ-chyron" : "fd-tourney-shimmer"} absolute inset-x-0 bottom-0 h-1 sm:h-[5px] pointer-events-none`}
            data-testid="tournament-shimmer-header"
          />
        )}
        {/* Tournament pitches panel — compact "still available" board.
         * Only renders when (a) game has a tournamentId, (b) the coach
         * toggled it on from the kebab menu, and (c) the GET resolved.
         * Same `pitcherAvailability[]` source that powers PitchCountsCard
         * so the numbers always match the pitching tab.
         *
         * Mobile placement: on phones (sub-lg) we ONLY show this when
         * the coach is viewing the Order tab — otherwise it stole 70-
         * 90px of vertical space from the Field tab on small viewports
         * and the field diagram had nothing left to render in. The
         * panel is duplicated below the right-sidebar (Order panel)
         * for the desktop / iPad-landscape layout where both columns
         * are visible at once. */}
        {showTournamentPitches && tournamentId != null && (
          <div className={mobileTab === "order" ? "" : "max-md:hidden"}>
            <TournamentPitchesPanel
              availability={tournament?.pitcherAvailability ?? []}
              dailyMax={tournament?.effectiveDailyMax ?? null}
              tournamentMax={tournament?.effectiveTournamentMax ?? null}
              loading={!tournament}
              onClose={() => setShowTournamentPitches(false)}
            />
          </div>
        )}
        {/* Re-open affordance — when the coach has dismissed the
         *  tournament pitches panel, surface a small pill right where
         *  the panel used to be so they can pop it back without
         *  hunting through the kebab menu. Mirrors the panel's mobile
         *  visibility rule (Order tab only on phones) so it doesn't
         *  steal vertical space from the Field diagram. */}
        {!showTournamentPitches && tournamentId != null && (
          <div
            className={`flex justify-center ${mobileTab === "order" ? "" : "max-md:hidden"}`}
          >
            <button
              type="button"
              onClick={() => setShowTournamentPitches(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] sm:text-xs font-broadcast uppercase tracking-wider text-accent bg-[#06101f] border border-accent/40 border-t-0 rounded-b-md hover:bg-[#0a1730] active:bg-[#0d1c3a]"
              aria-label="Show tournament pitches"
              data-testid="button-show-tournament-pitches"
            >
              <Trophy className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              Show pitches
              <ChevronDown className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            </button>
          </div>
        )}
        {/* Rotation tally — opt-in per-player IF/OF/Bench inning counts.
         *  The panel itself is a floating HUD card portaled to <body>
         *  (see below) so it can't be clipped by the header's stacking
         *  context or squeezed into its flex-wrap row. Here in the header
         *  we only render the small "Show rotation" trigger when it's
         *  hidden — gated to the Order tab on phones so the Field tab
         *  header stays uncluttered (the kebab works as a universal
         *  trigger on either tab). */}
        {!showRotationTally && (
          <div
            className={`flex justify-center ${mobileTab === "order" ? "" : "max-md:hidden"}`}
          >
            <button
              type="button"
              onClick={() => setShowRotationTally(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] sm:text-xs font-broadcast uppercase tracking-wider text-sky-300 bg-[#06101f] border border-sky-400/40 border-t-0 rounded-b-md hover:bg-[#0a1730] active:bg-[#0d1c3a]"
              aria-label="Show rotation tally"
              data-testid="button-show-rotation-tally"
            >
              <RotateCcw className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              Show rotation
              <ChevronDown className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            </button>
          </div>
        )}
      </header>

      {/* Rotation tally floating card. Portaled to <body> so it floats
       *  above the field/sidebar regardless of ancestor stacking contexts
       *  (the header sits in its own z-10 context, and the sidebar at
       *  z-20 would otherwise paint over an in-header panel). It's a
       *  non-modal HUD anchored bottom-right so the coach can keep
       *  dragging chips on the field while it's open. */}
      {showRotationTally &&
        typeof document !== "undefined" &&
        createPortal(
          <RotationTallyPanel
            rows={rotationTally.rows}
            fieldCats={rotationTally.fieldCats}
            onClose={() => setShowRotationTally(false)}
          />,
          document.body,
        )}

      {/* ── Body: field on the left, batting panel on the right ──
       * Wrapped in a DndContext so chips on the field and on the bench can
       * be dragged onto each other to swap positions in the current inning.
       * The context only intercepts pointer events on elements that opt in
       * via useDraggable / useDroppable — the inning controls, dim toggle,
       * fullscreen, and the batting-order list are untouched. */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      {/* Two responsive layouts:
       *  - Below `lg` (phones in any orientation, iPad portrait): single
       *    panel at a time with a bottom toggle bar to switch between
       *    FIELD (defense) and ORDER (offense). iPad portrait used to
       *    fall through a coverage gap — now it shares the same clean
       *    one-thing-at-a-time UX as phones.
       *  - iPad-landscape and desktop (`lg:`, ≥1024px): full split with
       *    a 320–400px sidebar — both panels visible at once because
       *    there's room for it. */}
      <main className="flex-1 min-h-0 grid grid-cols-1 max-lg:overflow-hidden lg:grid-cols-[1fr_minmax(320px,400px)] lg:overflow-hidden bg-black">
        {/* Field section: diagram fills the available height; bench strip pinned below */}
        <section
          className={`flex flex-col p-3 sm:p-4 min-w-0 min-h-0 max-lg:overflow-hidden lg:overflow-hidden bg-[#03060a] ${
            mobileTab !== "field" ? "max-lg:hidden" : ""
          }`}
          data-testid="section-field"
        >
          {/* Field min-height is generous in portrait (so the diagram is
           *  large enough to drag chips on) but drops to 0 in landscape and
           *  on lg, where the parent already constrains height to the
           *  viewport and the field is allowed to fill whatever's left. */}
          <div
            className="relative w-full flex-1 min-h-[320px] sm:min-h-[420px] max-lg:min-h-0 lg:min-h-0 border-2 border-[#1a2a42] overflow-hidden shadow-[inset_0_0_60px_rgba(0,0,0,0.35)]"
            style={{ background: lighting.grassGradient }}
            data-lighting={lighting.label}
            data-testid={`field-lighting-${lighting.label}`}
          >
            {/* Field geometry: foul lines, skinned infield, basepaths, bases,
                pitcher's mound, home plate. The SVG stretches with the
                container (preserveAspectRatio="none") which is fine for a
                stylized broadcast-style diagram — the diamond stays roughly
                the right shape on iPad landscape, and the player chips below
                are anchored in the same percentage coordinate space so they
                always sit at their fielding position. */}
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <radialGradient id="fd-dirt" cx="50%" cy="68%" r="38%">
                  <stop offset="0%" stopColor="rgb(208, 142, 82)" />
                  <stop offset="75%" stopColor="rgb(158, 96, 50)" />
                  <stop offset="100%" stopColor="rgb(118, 70, 36)" />
                </radialGradient>
                <radialGradient id="fd-mound" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgb(195, 130, 78)" />
                  <stop offset="100%" stopColor="rgb(140, 88, 48)" />
                </radialGradient>
                <radialGradient id="fd-infieldGrass" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="rgb(20, 83, 45)" />
                  <stop offset="100%" stopColor="rgb(6, 46, 22)" />
                </radialGradient>
                {/* Broadcast-style mowing stripes — wider bands for that
                    telecast field-graphic look. */}
                <pattern
                  id="fd-stripes"
                  width="100"
                  height="8"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="100" height="4" fill="rgba(255,255,255,0.03)" />
                </pattern>
              </defs>

              {/* Mowing stripes overlay across the whole grass */}
              <rect width="100" height="100" fill="url(#fd-stripes)" />

              {/* Outfield warning track arc — crisp white at the back */}
              <path
                d="M 4 36 Q 50 -12 96 36"
                stroke="rgba(255,255,255,0.7)"
                strokeWidth="0.4"
                fill="none"
              />

              {/* Foul lines from home plate out past 1B and 3B to the corners — bright white */}
              <line
                x1="50" y1="92" x2="2" y2="32"
                stroke="rgba(255,255,255,0.9)" strokeWidth="0.5"
              />
              <line
                x1="50" y1="92" x2="98" y2="32"
                stroke="rgba(255,255,255,0.9)" strokeWidth="0.5"
              />

              {/* Skinned infield (dirt) — diamond between the four bases */}
              <path
                d="M 50 92 L 73 67 L 50 42 L 27 67 Z"
                fill="url(#fd-dirt)"
              />

              {/* Inner infield grass — sits inside the basepath strip so the
                  basepaths read as a clean white-edged dirt strip */}
              <path
                d="M 50 88 L 70 67 L 50 46 L 30 67 Z"
                fill="url(#fd-infieldGrass)"
              />

              {/* Basepath chalk outline — bright crisp white for broadcast feel */}
              <path
                d="M 50 92 L 73 67 L 50 42 L 27 67 Z"
                fill="none"
                stroke="rgba(255,255,255,0.95)"
                strokeWidth="0.4"
              />

              {/* Pitcher's mound */}
              <circle
                cx="50" cy="60" r="3.6"
                fill="url(#fd-mound)"
                stroke="rgba(255,255,255,0.6)"
                strokeWidth="0.2"
              />
              {/* Pitcher's rubber */}
              <rect x="48.5" y="59.7" width="3" height="0.6" fill="rgba(255,255,255,0.95)" />

              {/* Bases (rotated squares) */}
              <g fill="white" stroke="rgba(0,0,0,0.4)" strokeWidth="0.18">
                <rect x="48.5" y="40.5" width="3" height="3" transform="rotate(45 50 42)" />
                <rect x="71.5" y="65.5" width="3" height="3" transform="rotate(45 73 67)" />
                <rect x="25.5" y="65.5" width="3" height="3" transform="rotate(45 27 67)" />
              </g>

              {/* Home plate (pentagon) */}
              <polygon
                points="50,89 53,91.5 53,94.5 47,94.5 47,91.5"
                fill="white"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="0.18"
              />

              {/* Batter's boxes (subtle) */}
              <rect x="44.5" y="89.5" width="2" height="5" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.18" />
              <rect x="53.5" y="89.5" width="2" height="5" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.18" />
            </svg>

            {/* Soft top vignette — color shifts with lighting so the dugout
                reads correctly under any time-of-day palette (warm wash for
                dawn/dusk, deep slate for night, neutral black for midday). */}
            <div
              className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${lighting.topVignette}`}
            />

            {/* Time-of-day ambient wash. mix-blend-soft-light lets the warm
                color settle onto the grass and chips without washing them
                out — the player names stay legible and the position pills
                keep their accent colors, but the whole field picks up the
                hue of the time of day. */}
            {lighting.ambientOverlay && (
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 mix-blend-soft-light ${lighting.ambientOverlay}`}
              />
            )}

            {/* Stadium lights for night games. Three soft pools from the
                back of the outfield (top edge), additive-blended so they
                read as actual light rather than overlay tint. The grass
                gets brighter under them; the chips sit "in the light"
                naturally because they're rendered above this layer. */}
            {lighting.stadiumLights && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 mix-blend-screen"
                data-testid="stadium-lights"
                style={{
                  background:
                    "radial-gradient(ellipse 55% 38% at 18% 6%, rgba(255, 248, 220, 0.32), transparent 65%), radial-gradient(ellipse 65% 42% at 50% 0%, rgba(255, 248, 220, 0.22), transparent 65%), radial-gradient(ellipse 55% 38% at 82% 6%, rgba(255, 248, 220, 0.32), transparent 65%)",
                }}
              />
            )}

            {displayedFieldPositions.map((pos) => (
              <FieldPositionSlot
                key={pos}
                pos={pos}
                player={fieldByPos.get(pos)}
                layout={POSITION_LAYOUT[pos]}
                accent={POSITION_ACCENT[pos]}
                isBeingDragged={
                  activeDragEntryId != null &&
                  fieldByPos.get(pos)?.entryId === activeDragEntryId
                }
                selectedEntryId={selectedEntryId}
                onChipTap={handleChipTap}
                onEmptyTap={handleEmptyFieldTap}
              />
            ))}
          </div>

          {/* Tap-to-swap "coach mode" banner. Appears below the field whenever
              a chip is selected so the coach knows what to do next and can
              cancel without hunting for the chip again. */}
          {selectedInfo && (
            <div
              className="mt-2 sm:mt-3 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 bg-accent/15 border border-accent rounded-md text-accent text-xs sm:text-sm font-bold shadow-[0_2px_0_rgba(0,0,0,0.4)]"
              data-testid="swap-mode-banner"
              role="status"
              aria-live="polite"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-black text-[10px] font-bold shrink-0">
                {selectedInfo.position === "Bench" ? "B" : selectedInfo.position}
              </span>
              <span className="flex-1 truncate">
                {formatPlayerNameShort(selectedInfo.name)} selected — tap where to send
              </span>
              <button
                type="button"
                onClick={() => setSelectedEntryId(null)}
                className="inline-flex h-7 px-2 items-center justify-center rounded bg-accent/20 hover:bg-accent/30 text-accent text-[11px] font-bold uppercase tracking-wider"
                data-testid="button-cancel-swap"
                aria-label="Cancel swap"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Bench strip below the field — single compact line, also a drop
              zone so a fielder can be benched by dragging their chip onto it. */}
          <BenchStrip
            entries={benchEntries}
            activeDragEntryId={activeDragEntryId}
            selectedEntryId={selectedEntryId}
            isSwapTarget={selectedInfo != null && selectedInfo.position !== "Bench"}
            onChipTap={handleChipTap}
            onBenchAreaTap={handleBenchAreaTap}
          />
        </section>

        {/* Batting panel layout per viewport (unified):
         *  Single equal-distribution flex column at every viewport — 9
         *  batters get tall comfortable rows, 18 batters get shorter
         *  rows that still read clearly (min-h-[2.25rem] floor keeps
         *  them tappable). The list fills the panel height exactly and
         *  shows no scrollbar whenever the roster fits; only a deep
         *  roster that overflows the min-h floor scrolls (see the inner
         *  container's `overflow-y-auto` note below). The "currently at
         *  bat" tracker was removed because there's no way to know real
         *  game state without a GameChanger-style integration, and a
         *  stale indicator was worse than no indicator. */}
        <aside className={`max-lg:border-t-0 lg:border-t-0 lg:border-l border-[#1a2a42] bg-gradient-to-b from-[#0f172a] to-[#050d1a] flex flex-col min-w-0 min-h-0 max-lg:overflow-hidden lg:overflow-hidden shadow-[-10px_0_30px_rgba(0,0,0,0.5)] relative z-20 ${
          mobileTab !== "order" ? "max-lg:hidden" : ""
        }`}>
          {/* Broadcast-graphic LINEUP header — Oswald uppercase with a gold
           *  underline to feel like a TV chyron. Tournament games swap the
           *  static gold underline for an animated shimmer + add a small
           *  TROPHY pre-title above the heading so the panel reads as a
           *  TV "tournament graphic" insert. */}
          <div className={`relative shrink-0 bg-[#0f172a] ${isTournament ? "border-b-0" : "border-b-2 border-accent"} px-4 py-2 sm:py-3 text-center`}>
            {isTournament && (
              <div
                className="flex items-center justify-center gap-1.5 mb-1 text-accent/90"
                data-testid="tournament-pretitle"
              >
                {championshipMode ? (
                  <Crown className="fd-champ-crown h-3.5 w-3.5 sm:h-4 sm:w-4 drop-shadow-[0_0_6px_rgba(245,191,66,0.85)]" aria-hidden="true" />
                ) : (
                  <Trophy className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                )}
                <span className="font-display text-[9px] sm:text-[10px] font-bold tracking-[0.4em] uppercase">
                  {championshipMode ? "Championship" : "Tournament"}
                </span>
                {championshipMode ? (
                  <Crown className="fd-champ-crown fd-champ-crown--delay h-3.5 w-3.5 sm:h-4 sm:w-4 drop-shadow-[0_0_6px_rgba(245,191,66,0.85)]" aria-hidden="true" />
                ) : (
                  <Trophy className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                )}
              </div>
            )}
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[0.3em] uppercase text-accent leading-none">
              Lineup
            </h2>
            {isTournament && (
              <div
                aria-hidden="true"
                className={`${championshipMode ? "fd-champ-chyron" : "fd-tourney-shimmer"} absolute inset-x-0 bottom-0 h-[3px] pointer-events-none`}
                data-testid="tournament-shimmer-lineup"
              />
            )}
          </div>
          {/* The batting list tries to fit the panel WITHOUT an internal
           *  scroll — the dugout iPad is strapped to a fence and a coach
           *  glancing at it shouldn't have to swipe to see the bottom of
           *  the order. The wrapper is `flex flex-col`, the <ol> is
           *  `flex-1 min-h-0` so it owns all leftover vertical space, and
           *  each <li> uses `flex-1 basis-0` so 9 batters get tall comfy
           *  rows and 18 batters get shorter rows that still read clearly
           *  (min-h floor keeps them tappable). */}
          {/* `overflow-y-auto` at EVERY breakpoint is the safety net: the
           *  `flex-1 basis-0` rows only grow when they fit, so a roster
           *  that fits shows NO scrollbar (the common case, behaviour
           *  unchanged). But a deep roster on a short viewport — phone
           *  landscape (12+ batters × ~40px floor over ~280px), iPad
           *  portrait, OR even iPad landscape / desktop with a 15+ player
           *  roster — would otherwise hit the min-h floor and clip its
           *  last batters under `overflow-hidden`. Letting it scroll when
           *  (and only when) it overflows is the right answer at all
           *  sizes. */}
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col p-2 sm:p-3">
          {battingOrder.length === 0 ? (
            <div className="text-slate-500 text-sm">No batting order yet.</div>
          ) : (
            <ol
              className="flex flex-col flex-1 min-h-0 gap-1 max-lg:gap-1.5 lg:gap-1"
              data-testid="batting-order-list"
            >
              {battingOrder.map((r, idx) => {
                // Display sequential slot numbers (1..N) based on the
                // sorted index, NOT the stored `r.order` field. The
                // stored field can have gaps when a player is pulled
                // mid-game (e.g. dragged to bench, marked sick, or had
                // a per-inning entry without a battingOrder set), and
                // the dugout coach reads "4th batter" as "4th in this
                // visible list" — not "the player whose stored order
                // is 4". Renumbering here keeps the labels matching
                // the visual position so a removal doesn't leave the
                // 5th batter showing as #5 with #4 missing.
                // Players with no order at all (true bench-only) sort
                // last and still show "—" so they're not mistaken for
                // a real batting position.
                const slotLabel = r.order != null ? idx + 1 : "—";
                // No "currently at bat" highlight — there's no way to
                // know real game state without a GameChanger-style
                // integration, and a fake/stale indicator (we used to
                // always highlight row 0) was worse than no indicator.
                // When real at-bat tracking lands, reintroduce an
                // `isAtBat` flag and gate gold styling + an AB pill on it.
                return (
                  <li
                    key={r.playerId}
                    className={`relative flex items-stretch h-auto flex-1 basis-0 min-h-[2.25rem] sm:min-h-[2.5rem] overflow-hidden border border-transparent transition-all ${
                      idx % 2 === 0
                        ? "bg-slate-900/60"
                        : "bg-slate-900/30"
                    }`}
                    data-testid={`batter-row-${r.playerId}`}
                  >
                    <span className="shrink-0 w-10 sm:w-12 flex items-center justify-center font-display font-bold text-lg sm:text-xl tabular-nums bg-white/5 text-slate-400">
                      {slotLabel}
                    </span>
                    <span
                      className="flex-1 min-w-0 flex items-center px-2 sm:px-3 text-sm sm:text-base font-bold leading-tight truncate text-white"
                      title={r.playerName}
                    >
                      {formatPlayerNameShort(r.playerName)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          </div>
        </aside>
      </main>

      {/* Floating chip that follows the cursor / finger during a drag.
          dropAnimation={null} so the chip vanishes the moment the move
          lands — the optimistic cache update makes it instantly appear in
          its new spot, so animating the floating chip back to the source
          would just be confusing.
          Portal to <body> so the chip's `position: fixed` stays anchored
          to the viewport instead of getting trapped under any ancestor
          with a `transform`/`filter`/`will-change` style (the dim overlay
          and broadcast theme wrappers both qualify). Without the portal,
          the chip appears far from the cursor and the dragged tile just
          looks like it vanished. */}
      {createPortal(
        <DragOverlay dropAnimation={null} style={{ zIndex: 1000 }}>
          {activeDragInfo ? (
            <div
              className="flex items-stretch bg-[#0f172a] border border-[#1a2a42] shadow-[0_8px_0_rgba(0,0,0,0.7)] cursor-grabbing select-none overflow-hidden"
              data-testid="drag-overlay-chip"
            >
              <div className="bg-accent text-black font-bold font-['Roboto_Mono'] px-2 py-1 flex items-center justify-center text-xs uppercase tracking-wider min-w-[40px]">
                {activeDragInfo.position === "Bench" ? "BN" : activeDragInfo.position}
              </div>
              <div className="px-3 py-1 font-bold text-sm text-white whitespace-nowrap tracking-wide flex items-center">
                {formatPlayerNameShort(activeDragInfo.name)}
              </div>
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
      </DndContext>

      {/* Phone bottom tab bar — shown on phones in BOTH portrait and
       *  landscape. Pinned to the bottom of the viewport via the flex
       *  column so it never scrolls away. The main grid above is locked
       *  to the viewport on phones (overflow-hidden) so the field/lineup
       *  never hide behind it. Hidden on iPad/desktop where field +
       *  lineup are already visible side-by-side.
       *
       *  Landscape uses a shorter h-12 bar (vs h-16 in portrait) because
       *  vertical space is precious on a phone in landscape — every pixel
       *  the nav doesn't take is a pixel the field can use.
       *
       *  Two tabs only (FIELD and ORDER) — the bench is intentionally kept
       *  inside the FIELD tab as the existing BenchStrip drag-target so
       *  coaches can drag-and-drop between field and bench without
       *  leaving the panel. */}
      <nav
        className="hidden max-lg:flex shrink-0 h-16 max-lg:landscape:h-12 bg-[#050d1a] border-t border-[#1a2a42] z-30"
        aria-label="Field display section"
        data-testid="mobile-tab-bar"
      >
        <button
          type="button"
          onClick={() => setMobileTab("field")}
          aria-pressed={mobileTab === "field"}
          data-testid="mobile-tab-field"
          className={`flex-1 flex flex-col items-center justify-center gap-1 border-t-2 transition-colors ${
            mobileTab === "field"
              ? "border-accent text-white bg-white/5"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          <MapIcon className={`h-5 w-5 ${mobileTab === "field" ? "text-accent" : ""}`} aria-hidden="true" />
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em]">Field</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("order")}
          aria-pressed={mobileTab === "order"}
          data-testid="mobile-tab-order"
          className={`flex-1 flex flex-col items-center justify-center gap-1 border-t-2 transition-colors ${
            mobileTab === "order"
              ? "border-accent text-white bg-white/5"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          <ListOrdered className={`h-5 w-5 ${mobileTab === "order" ? "text-accent" : ""}`} aria-hidden="true" />
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em]">Order</span>
        </button>
      </nav>

      {/*
       * Dim overlay. Fixed/full-viewport so it works in fullscreen mode too.
       * pointer-events-none → taps pass straight through to the controls
       * underneath, so the coach can still hit Next Batter / Next Inning /
       * the dim toggle itself without disabling dim first. Smooth fade so it
       * doesn't snap at the eye when toggled. 40% opacity = clearly dimmer
       * without becoming unreadable in any reasonable lighting.
       */}
      <div
        aria-hidden="true"
        data-testid="dim-overlay"
        className={`pointer-events-none fixed inset-0 z-50 bg-black transition-opacity duration-300 ${
          dimMode ? "opacity-40" : "opacity-0"
        }`}
      />
      {/* Sunlight wash. Lays a faint white veil across the page (NOT the
       * field itself — the field gets its bright `morning` palette via
       * the `lighting` override above) to lift mid-tones in the dark
       * scoreboard chrome under direct outdoor sun. 12% is the sweet
       * spot — high enough to actually punch through glare on an iPad
       * at full brightness, low enough that chip text and the gold
       * accent line don't go washed out themselves. */}
      <div
        aria-hidden="true"
        data-testid="sunlight-overlay"
        className={`pointer-events-none fixed inset-0 z-50 bg-white transition-opacity duration-300 ${
          sunlightMode ? "opacity-[0.12]" : "opacity-0"
        }`}
      />

      {/* ── End-game / exit confirmation ──────────────────────────
       * Funnel for every "I'm leaving the field display" path. Three
       * options:
       *   1. Mark complete & finalize  — flips `game.status` to
       *      "completed" via the existing offline-aware patch chain
       *      (so it survives a flaky WiFi drop) and routes to the
       *      game-detail screen with `?openBoxScore=1`, which
       *      auto-opens the box-score upload dialog. This is the
       *      "happy path" — coach finishes the game, fills in the
       *      final score + uploads GameChanger screenshots in one
       *      flow.
       *   2. Just exit  — leave the game as-is (typically used
       *      between innings of a long doubleheader, or when a
       *      parent is taking over). Status untouched.
       *   3. Keep coaching  — close the dialog, no navigation.
       *
       * The score on the field display already syncs through the
       * same patch chain, so any pending +1 taps on the score
       * stepper are persisted before navigation happens. */}
      {/* Pitcher-removed pitch-count prompt. Renders one modal per
       *  queued removal; on submit/skip it shifts the queue. Submit
       *  ADDS to the existing pitch count on file so a multi-outing
       *  pitcher (came in, came out, came back in, came out again)
       *  accumulates correctly. Skip = "not tracking" — leaves the
       *  pitch count untouched so a coach who doesn't care about
       *  pitch limits isn't forced to type a number every swap. */}
      {/* Tapped-out-pitcher confirm. Coach has dragged someone onto P
       *  who has zero pitches available today under the tournament's
       *  daily cap. Cancel drops the move; Confirm commits it
       *  (sometimes the cap is wrong, or the coach is intentionally
       *  going over — but it should be a CHOICE, not silent). */}
      <AlertDialog
        open={tappedOutWarning != null}
        onOpenChange={(open) => { if (!open) setTappedOutWarning(null); }}
      >
        <AlertDialogContent data-testid="dialog-tapped-out-pitcher">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tappedOutWarning?.playerName} is at the daily pitch cap
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tappedOutWarning != null && (
                <>
                  {tappedOutWarning.playerName} has thrown{" "}
                  <span className="font-mono font-semibold">
                    {tappedOutWarning.pitchesToday}
                  </span>{" "}
                  pitch{tappedOutWarning.pitchesToday === 1 ? "" : "es"} today
                  {tappedOutWarning.dailyMax != null && (
                    <>
                      {" "}(cap:{" "}
                      <span className="font-mono font-semibold">
                        {tappedOutWarning.dailyMax}
                      </span>
                      )
                    </>
                  )}
                  . Putting them back on the mound may break tournament rules.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setTappedOutWarning(null)}
              data-testid="button-tapped-out-cancel"
            >
              Cancel move
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = tappedOutWarning;
                setTappedOutWarning(null);
                if (pending) _commitLineupSave(pending.nextLineup);
              }}
              data-testid="button-tapped-out-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Pitch anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* "No bench 2 of 3 innings" rule warning. Advisory — coach can override. */}
      <AlertDialog
        open={benchRuleWarning != null}
        onOpenChange={(open) => { if (!open) setBenchRuleWarning(null); }}
      >
        <AlertDialogContent data-testid="dialog-bench-rule">
          <AlertDialogHeader>
            <AlertDialogTitle>
              This benches{" "}
              {benchRuleWarning != null &&
                (benchRuleWarning.playerNames.length === 1
                  ? formatPlayerNameShort(benchRuleWarning.playerNames[0]!)
                  : `${benchRuleWarning.playerNames.length} players`)}{" "}
              2 of 3 innings
            </AlertDialogTitle>
            <AlertDialogDescription>
              {benchRuleWarning != null && (
                <>
                  Your "No bench 2 of 3 innings" rule says no one should sit{" "}
                  2 out of any 3 innings in a row. This change would do that for{" "}
                  <span className="font-semibold">
                    {benchRuleWarning.playerNames
                      .map((n) => formatPlayerNameShort(n))
                      .join(", ")}
                  </span>
                  .
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setBenchRuleWarning(null)}
              data-testid="button-bench-rule-cancel"
            >
              Cancel move
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = benchRuleWarning;
                setBenchRuleWarning(null);
                if (pending) _commitLineupSave(pending.nextLineup);
              }}
              data-testid="button-bench-rule-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Bench anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {pitcherPromptQueue.length > 0 && (
        <PitcherPitchesPrompt
          key={`${pitcherPromptQueue[0]!.playerId}-${pitcherPromptQueue.length}`}
          playerName={pitcherPromptQueue[0]!.playerName}
          existingPitches={
            gamePitchCounts.find(
              (pc) => pc.playerId === pitcherPromptQueue[0]!.playerId,
            )?.pitches ?? 0
          }
          // Skip is the ONLY user-initiated dequeue path. Failed
          // saves keep the prompt open (see onSubmit return value)
          // so a flaky-WiFi POST doesn't quietly drop the coach's
          // entered count. Successful saves dequeue in onSubmit.
          onSkip={() => setPitcherPromptQueue((q) => q.slice(1))}
          onSubmit={async (addPitches) => {
            const head = pitcherPromptQueue[0]!;
            const existing =
              gamePitchCounts.find((pc) => pc.playerId === head.playerId)
                ?.pitches ?? 0;
            // Clamp at the server's documented 0..500 range. We use
            // the clamped total in BOTH the POST and the success
            // toast so a coach who fat-fingered "1500" sees the
            // capped value reflected in the confirmation message
            // (instead of being told something different was saved
            // than what shows up on the tournament board).
            const clampedTotal = Math.max(0, Math.min(500, existing + addPitches));
            try {
              await upsertPitchCount.mutateAsync({
                id,
                data: { playerId: head.playerId, pitches: clampedTotal },
              });
            } catch {
              // Leave the prompt up so the coach can retry with the
              // same entered number — a dugout iPad on parking-lot
              // WiFi sees enough transient failures that auto-
              // dropping the entry would make this feature lossy.
              toast({
                title: "Couldn't save pitches",
                description: "Tap Save again, or Skip to dismiss.",
                variant: "destructive",
              });
              return false;
            }
            // Refresh the source-of-truth for the Tournament Pitches
            // Panel (PitchCounts query) AND the tournament-wide
            // availability board (Tournament query — its
            // pitcherAvailability[] is recomputed server-side from
            // these rows).
            qc.invalidateQueries({ queryKey: getGetGamePitchCountsQueryKey(id) });
            if (tournamentId != null) {
              qc.invalidateQueries({
                queryKey: getGetTournamentQueryKey(tournamentId),
              });
            }
            toast({
              title: "Pitches logged",
              description: `${head.playerName}: +${addPitches} (total ${clampedTotal})`,
            });
            setPitcherPromptQueue((q) => q.slice(1));
            return true;
          }}
        />
      )}
      <AlertDialog open={endGameDialogOpen} onOpenChange={setEndGameDialogOpen}>
        <AlertDialogContent data-testid="dialog-end-game">
          <AlertDialogHeader>
            <AlertDialogTitle>Is this game complete?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm the final score below — it'll be saved even if
              you're still on a flaky parking-lot connection. Mark
              complete to finalize and upload your box score, or just
              exit and pick this back up later.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Inline final-score capture. The header steppers already
            * sync through the offline-aware patch chain, but coaches
            * told us they often skip them mid-game and want one last
            * "what was the final score?" prompt at exit time. Both
            * exit paths below funnel any change through
            * persistDialogScores() before navigating, so a score
            * entered here on a parking-lot WiFi drop is queued in
            * localStorage and POSTed when the iPad reconnects. */}
          <div
            className="my-2 rounded-md border bg-muted/40 p-4"
            data-testid="end-game-score-editor"
          >
            <div className="grid grid-cols-2 gap-4">
              <DialogScoreInput
                label={teamShortName || teamName || "Us"}
                value={dialogOurScore}
                onChange={setDialogOurScore}
                testId="dialog-our-score"
              />
              <DialogScoreInput
                label={
                  formatOpponentForMatchup(game?.opponent, teamName) ||
                  game?.opponent ||
                  "Them"
                }
                value={dialogOppScore}
                onChange={setDialogOppScore}
                testId="dialog-opp-score"
              />
            </div>
          </div>

          <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel
              data-testid="button-end-game-keep-coaching"
              className="sm:mr-auto"
            >
              Keep coaching
            </AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // Persist score edits through the offline-aware patch
                // chain BEFORE navigating away. The chain queues to
                // localStorage if offline so the score isn't lost.
                persistDialogScores();
                setEndGameDialogOpen(false);
                setLocation(`/games/${id}`);
              }}
              data-testid="button-end-game-just-exit"
            >
              Just exit
            </Button>
            <AlertDialogAction
              onClick={() => {
                // Save score edits first, then optimistically flip
                // status. Both ride the same offline-aware patch chain,
                // so a captive-portal exit still records everything
                // and POSTs on reconnect.
                persistDialogScores();
                if ((game?.status ?? "upcoming") !== "completed") {
                  saveGamePatchOptimistically({ status: "completed" });
                }
                setEndGameDialogOpen(false);
                setLocation(`/games/${id}?openBoxScore=1`);
              }}
              data-testid="button-end-game-mark-complete"
            >
              <Flag className="h-4 w-4 mr-2" />
              Mark complete &amp; finish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components for drag & drop. Pulled out of the render loop so each
// chip can call useDraggable / useDroppable at the top level of its own
// component (React's rules-of-hooks).
// ─────────────────────────────────────────────────────────────────────────

interface FieldPositionSlotProps {
  pos: FieldPos;
  player: { name: string; playerId: number; entryId: number } | undefined;
  layout: { top: string; left: string };
  accent: string;
  isBeingDragged: boolean;
  /** Currently tap-selected entry, or null. Drives the gold ring highlight. */
  selectedEntryId: number | null;
  /** Tap a chip — selects, deselects, or swaps with the prior selection. */
  onChipTap: (entryId: number) => void;
  /** Tap an empty position — only meaningful while something is selected. */
  onEmptyTap: (pos: FieldPos) => void;
}

/**
 * Compact +/- stepper used inside the End Game dialog to capture the
 * final score. Intentionally simple (no swipe gestures, no broadcast
 * styling) so it reads clearly on the white AlertDialog surface — the
 * dugout-broadcast `<ScoreStepper>` looks wrong in this context. The
 * value flows out via `onChange`; the parent owns the persisted side
 * (it batches the change into the offline-aware patch chain on exit,
 * NOT on every tap, so a coach who rapidly taps +5 doesn't generate 5
 * separate PATCH attempts).
 */
/**
 * Modal that pops the moment a pitcher is dragged off the "P" slot,
 * asking the coach for the pitch count of the OUTING that just ended.
 * Lives as a sibling of the End-Game AlertDialog rather than reusing
 * `useConfirm` because we need a number entry, not a boolean. The
 * submitted value is ADDED to whatever's already on file (the upsert
 * endpoint is REPLACE — addition is done by the caller), so a relief
 * pitcher who comes back in later in the game accumulates correctly
 * across multiple outings. Skip is a first-class option so coaches
 * who aren't tracking pitch counts aren't forced to type a number on
 * every defensive shuffle.
 */
interface PitcherPitchesPromptProps {
  playerName: string;
  existingPitches: number;
  /**
   * Resolves to `true` when the save succeeded (caller should
   * dequeue) or `false` when it failed (caller should leave the
   * prompt open so the coach can retry without losing their input).
   */
  onSubmit: (addPitches: number) => Promise<boolean>;
  /** Coach explicitly dismissed — never called by save failures. */
  onSkip: () => void;
}

function PitcherPitchesPrompt({
  playerName,
  existingPitches,
  onSubmit,
  onSkip,
}: PitcherPitchesPromptProps) {
  const [raw, setRaw] = useState<string>("");
  // In-flight lock — prevents double-submits from a rapid double-tap
  // on Save AND blocks Skip / backdrop-close while a POST is mid-air.
  // Without this, a coach who tap-tap-taps Save on a slow connection
  // could fire two upserts and (worse) two queue-shifts, silently
  // discarding the next queued prompt.
  const [submitting, setSubmitting] = useState(false);
  const parsed = Number.parseInt(raw, 10);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 500;
  const adjust = (delta: number) => {
    if (submitting) return;
    const current = Number.isFinite(parsed) ? parsed : 0;
    const next = Math.max(0, Math.min(500, current + delta));
    setRaw(String(next));
  };
  const handleSave = async () => {
    if (submitting || !valid || parsed === 0) return;
    setSubmitting(true);
    try {
      // Caller dequeues internally on success; we just need to
      // release the lock on failure so the coach can retry.
      await onSubmit(parsed);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Block accidental backdrop / Esc dismissal while saving so
        // an iPad coach can't lose the in-flight entry by tapping
        // outside the modal mid-POST.
        if (!open && !submitting) onSkip();
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="dialog-pitcher-pitches">
        <DialogHeader>
          <DialogTitle>How many pitches did {playerName} throw?</DialogTitle>
          <DialogDescription>
            {existingPitches > 0
              ? `Already logged today: ${existingPitches}. We'll add to that total.`
              : "Logged on this game so the tournament pitch counts stay accurate."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center gap-3 py-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10"
            onClick={() => adjust(-5)}
            disabled={submitting}
            aria-label="Decrease by 5"
            data-testid="button-pitches-minus-5"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={500}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            autoFocus
            disabled={submitting}
            placeholder="0"
            className="h-12 w-24 text-center text-2xl font-mono"
            data-testid="input-pitches"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10"
            onClick={() => adjust(5)}
            disabled={submitting}
            aria-label="Increase by 5"
            data-testid="button-pitches-plus-5"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onSkip}
            disabled={submitting}
            data-testid="button-pitches-skip"
          >
            Skip
          </Button>
          <Button
            type="button"
            disabled={submitting || !valid || parsed === 0}
            onClick={handleSave}
            data-testid="button-pitches-save"
          >
            {submitting ? "Saving…" : "Save pitches"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One position cell on the diamond. Always droppable (so even an empty
 * "Open" slot accepts a drop and the dragged player moves into it). When
 * occupied, the chip body itself is also draggable.
 */
function FieldPositionSlot({
  pos,
  player,
  layout,
  accent,
  isBeingDragged,
  selectedEntryId,
  onChipTap,
  onEmptyTap,
}: FieldPositionSlotProps) {
  const dropData: MoveTarget = player
    ? { kind: "tile", entryId: player.entryId, position: pos }
    : { kind: "emptyField", position: pos };
  const { isOver, setNodeRef } = useDroppable({
    id: `field-${pos}`,
    data: dropData,
  });
  // "Tap target" = something is selected and tapping HERE will move it.
  // For an occupied chip that means swap (handled by onChipTap); for an
  // empty cell it means a one-tap move.
  const swapTargetable = selectedEntryId != null && (!player || player.entryId !== selectedEntryId);
  return (
    <div
      ref={setNodeRef}
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ top: layout.top, left: layout.left }}
      data-testid={`field-pos-${pos}`}
    >
      {player ? (
        <DraggableFieldChip
          pos={pos}
          accent={accent}
          name={player.name}
          entryId={player.entryId}
          isOver={isOver}
          isBeingDragged={isBeingDragged}
          isSelected={selectedEntryId === player.entryId}
          isSwapTarget={swapTargetable}
          onTap={() => onChipTap(player.entryId)}
        />
      ) : (
        <EmptyFieldChip
          pos={pos}
          isOver={isOver}
          isSwapTarget={swapTargetable}
          onTap={() => onEmptyTap(pos)}
        />
      )}
    </div>
  );
}

interface DraggableFieldChipProps {
  pos: string;
  accent: string;
  name: string;
  entryId: number;
  isOver: boolean;
  isBeingDragged: boolean;
  isSelected: boolean;
  isSwapTarget: boolean;
  onTap: () => void;
}

/** A filled position chip — the entire visible rectangle (including the
 *  position pill above it) is the drag handle so a coach with thick
 *  fingers can grab anywhere. Also a tap target: a quick tap (under the
 *  5px PointerSensor / 8px TouchSensor activation distance) selects the
 *  chip for tap-to-swap; a longer drag still works as before. */
function DraggableFieldChip({
  pos,
  accent: _accent,
  name,
  entryId,
  isOver,
  isBeingDragged,
  isSelected,
  isSwapTarget,
  onTap,
}: DraggableFieldChipProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `player-${entryId}`,
  });
  const hidden = isDragging || isBeingDragged;
  // Unified-pill chip (Variant A from the canvas mockups): one continuous
  // rounded shape — gold position label, thin gold divider, white name —
  // instead of a yellow badge protruding from a dark name block. Removes
  // the "staggered" look the coach flagged. Every chip now has the same
  // silhouette so the field reads as a clean roster, not a collage.
  // The `_accent` prop is kept in the signature to avoid changing the
  // parent contract — color is sourced from the broadcast palette.
  // Visual hierarchy of ring states (highest to lowest priority):
  //   isSelected  → solid gold ring (the chip you picked)
  //   isOver      → gold ring during a drag-hover
  //   isSwapTarget→ subtle dashed gold outline (tap-here-to-swap hint)
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onTap}
      role="button"
      aria-pressed={isSelected}
      aria-label={
        isSelected
          ? `${name} at ${pos}, selected — tap another spot to send, or tap again to cancel`
          : isSwapTarget
            ? `${name} at ${pos} — tap to swap`
            : `${name} at ${pos} — tap to select, or drag to move`
      }
      className={`relative inline-flex items-center bg-[#0b1a35]/95 border border-white/10 rounded-full shadow-lg touch-none cursor-grab active:cursor-grabbing select-none transition-all overflow-hidden ${
        isSelected
          ? "ring-2 ring-accent ring-offset-2 ring-offset-[#050d1a]"
          : isOver
            ? "ring-2 ring-accent"
            : isSwapTarget
              ? "outline outline-1 outline-dashed outline-accent/60 outline-offset-2"
              : ""
      } ${hidden ? "opacity-30" : ""}`}
      data-testid={`field-chip-${pos}`}
      title={
        isSelected
          ? `${name} selected — tap where to send`
          : `${name} — tap to select, or drag`
      }
    >
      <span className="text-accent font-bold font-['Roboto_Mono'] pl-2 max-lg:landscape:pl-2 sm:pl-3 lg:pl-3 pr-1 max-lg:landscape:pr-1 sm:pr-2 py-0.5 max-lg:landscape:py-0.5 sm:py-1 flex items-center justify-center text-[9px] max-lg:landscape:text-[9px] sm:text-xs uppercase tracking-wider min-w-[24px] max-lg:landscape:min-w-[24px] sm:min-w-[34px]">
        {pos}
      </span>
      <span className="w-px h-3 max-lg:landscape:h-3 sm:h-4 bg-accent/50" aria-hidden />
      <span className="pl-1 max-lg:landscape:pl-1 sm:pl-2 pr-2 max-lg:landscape:pr-2 sm:pr-3 py-0.5 max-lg:landscape:py-0.5 sm:py-1 flex items-center min-w-[52px] max-lg:landscape:min-w-[52px] sm:min-w-[96px] max-w-[96px] max-lg:landscape:max-w-[96px] sm:max-w-[170px]">
        <span className="text-[11px] max-lg:landscape:text-[11px] sm:text-sm font-bold leading-tight truncate text-white tracking-wide whitespace-nowrap">
          {formatPlayerNameShort(name)}
        </span>
      </span>
    </div>
  );
}

/** Empty position cell — not draggable, but the parent slot is droppable
 *  so a chip can be dragged onto it. Also a tap target while a swap is
 *  in progress: tap-here-to-send the selected chip to this open slot. */
function EmptyFieldChip({
  pos,
  isOver,
  isSwapTarget,
  onTap,
}: {
  pos: string;
  isOver: boolean;
  isSwapTarget: boolean;
  onTap: () => void;
}) {
  return (
    <div
      onClick={isSwapTarget ? onTap : undefined}
      role={isSwapTarget ? "button" : undefined}
      aria-label={isSwapTarget ? `Send selected player to ${pos}` : undefined}
      className={`relative inline-flex items-center border border-dashed rounded-full shadow-md transition-colors overflow-hidden ${
        isOver
          ? "bg-accent/20 border-accent"
          : isSwapTarget
            ? "bg-accent/10 border-accent/70 cursor-pointer"
            : "bg-[#0b1a35]/70 border-white/15"
      }`}
      data-testid={`field-chip-${pos}-empty`}
    >
      <span
        className={`font-bold font-['Roboto_Mono'] pl-2 max-lg:landscape:pl-2 sm:pl-3 pr-1 max-lg:landscape:pr-1 sm:pr-2 py-0.5 max-lg:landscape:py-0.5 sm:py-1 flex items-center justify-center text-[9px] max-lg:landscape:text-[9px] sm:text-xs uppercase tracking-wider min-w-[24px] max-lg:landscape:min-w-[24px] sm:min-w-[34px] ${
          isOver || isSwapTarget ? "text-black" : "text-slate-400"
        }`}
      >
        {pos}
      </span>
      <span
        className={`w-px h-3 max-lg:landscape:h-3 sm:h-4 ${
          isOver || isSwapTarget ? "bg-accent" : "bg-white/20"
        }`}
        aria-hidden
      />
      <span className="pl-1 max-lg:landscape:pl-1 sm:pl-2 pr-2 max-lg:landscape:pr-2 sm:pr-3 py-0.5 max-lg:landscape:py-0.5 sm:py-1 flex items-center min-w-[60px] max-lg:landscape:min-w-[60px] sm:min-w-[96px] max-w-[100px] max-lg:landscape:max-w-[100px] sm:max-w-[170px]">
        <span
          className={`text-[11px] max-lg:landscape:text-[11px] sm:text-sm font-bold leading-tight truncate italic whitespace-nowrap ${
            isOver || isSwapTarget ? "text-accent" : "text-slate-500"
          }`}
        >
          {isOver ? "Drop here" : isSwapTarget ? "Tap to send" : "Open"}
        </span>
      </span>
    </div>
  );
}

interface BenchStripProps {
  entries: { name: string; entryId: number }[];
  activeDragEntryId: number | null;
  selectedEntryId: number | null;
  /** True when the selected entry is currently on the FIELD — tapping the
   *  bench strip will send them to the bench. False when the selection is
   *  itself a bench player (tapping bench would be a no-op). */
  isSwapTarget: boolean;
  onChipTap: (entryId: number) => void;
  onBenchAreaTap: () => void;
}

/** Bench strip below the field — the whole strip is one drop zone so a
 *  fielder can be benched by dragging anywhere in the bar. Each name
 *  inside is itself draggable so a benched player can be subbed in. */
function BenchStrip({
  entries,
  activeDragEntryId,
  selectedEntryId,
  isSwapTarget,
  onChipTap,
  onBenchAreaTap,
}: BenchStripProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: "bench-area",
    data: { kind: "benchArea" } satisfies MoveTarget,
  });
  // Tapping anywhere in the strip background — but NOT a child chip — sends
  // the selected fielder to the bench. We compare currentTarget vs target so
  // taps on individual bench chips fall through to their own onClick.
  const handleStripClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isSwapTarget) return;
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest("[data-bench-chip]") == null) {
      onBenchAreaTap();
    }
  };
  return (
    <div
      ref={setNodeRef}
      onClick={handleStripClick}
      role={isSwapTarget ? "button" : undefined}
      aria-label={isSwapTarget ? "Send selected player to bench" : undefined}
      className={`mt-2 sm:mt-3 border bg-[#050d1a] px-3 sm:px-6 py-2 shrink-0 shadow-[0_4px_12px_rgba(0,0,0,0.45)] transition-colors ${
        isOver
          ? "border-accent ring-2 ring-accent/60 bg-amber-950/20"
          : isSwapTarget
            ? "border-accent/70 ring-1 ring-accent/40 cursor-pointer"
            : "border-[#1a2a42]"
      }`}
      data-testid="bench-strip"
    >
      <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
        <span className="text-[10px] sm:text-xs uppercase tracking-[0.3em] text-slate-400 font-display font-bold">
          {isSwapTarget ? "Tap to bench" : "Bench"}
        </span>
        {entries.length === 0 ? (
          <span className="text-sm text-slate-500">
            {isOver || isSwapTarget ? "Drop here to bench" : "—"}
          </span>
        ) : (
          <div className="flex gap-2 sm:gap-3 flex-wrap">
            {entries.map((entry) => (
              <DraggableBenchChip
                key={entry.entryId}
                name={entry.name}
                entryId={entry.entryId}
                isBeingDragged={entry.entryId === activeDragEntryId}
                isSelected={selectedEntryId === entry.entryId}
                isSwapTarget={selectedEntryId != null && selectedEntryId !== entry.entryId}
                onTap={() => onChipTap(entry.entryId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A single bench player name — draggable onto any field position to sub
 *  in (the displaced fielder takes the bench seat). Also a tap target for
 *  the tap-to-swap "coach mode": tap to select, tap again to deselect, or
 *  tap while another chip is selected to swap them. */
function DraggableBenchChip({
  name,
  entryId,
  isBeingDragged,
  isSelected,
  isSwapTarget,
  onTap,
}: {
  name: string;
  entryId: number;
  isBeingDragged: boolean;
  isSelected: boolean;
  isSwapTarget: boolean;
  onTap: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `player-${entryId}`,
  });
  const hidden = isDragging || isBeingDragged;
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Stop the parent BenchStrip's "tap-to-bench" handler from also
        // firing for this same click — tapping a bench player should
        // route through the chip's swap logic, not the bench-area drop.
        e.stopPropagation();
        onTap();
      }}
      role="button"
      aria-pressed={isSelected}
      aria-label={
        isSelected
          ? `${name} on bench, selected — tap a position to send`
          : isSwapTarget
            ? `${name} on bench — tap to swap with selected player`
            : `${name} on bench — tap to select, or drag to a position`
      }
      data-bench-chip
      className={`text-xs sm:text-sm font-bold text-slate-200 touch-none cursor-grab active:cursor-grabbing select-none px-2.5 sm:px-3 py-1 sm:py-1.5 bg-[#0b1a35]/95 border rounded-full shadow-md transition-all whitespace-nowrap tracking-wide ${
        isSelected
          ? "border-accent ring-2 ring-accent ring-offset-2 ring-offset-[#050d1a]"
          : isSwapTarget
            ? "border-accent outline outline-1 outline-dashed outline-accent/60 outline-offset-2"
            : "border-white/15 hover:border-accent"
      } ${hidden ? "opacity-30" : ""}`}
      data-testid={`bench-name-${name}`}
      title={
        isSelected
          ? `${name} selected — tap where to send`
          : `${name} — tap to select, or drag onto a position`
      }
    >
      {formatPlayerNameShort(name)}
    </span>
  );
}

// Re-export BASE so unused-import cleanup doesn't strip it; reserved for a
// future "share via QR code" feature on this screen.
export const __FIELD_DISPLAY_BASE = BASE;

/**
 * Compact "still available" board that drops in under the field-display
 * header when the active game belongs to a tournament. Shows each
 * pitcher's remaining-today + remaining-in-tournament budget, color-coded
 * so the dugout can scan it at a glance. Resting pitchers show their
 * "available on" date instead of a number so the coach doesn't burn a
 * called pitcher on a no-go.
 *
 * Sorted by descending "still has gas today" so the most-available arms
 * float to the top — the order a coach actually scans during a pitching
 * change. Players with no pitches recorded all weekend drop to the
 * bottom (still shown, since they're often the freshest option).
 */
function TournamentPitchesPanel({
  availability,
  dailyMax,
  tournamentMax,
  loading,
  onClose,
}: {
  availability: TPAvailability[];
  dailyMax: number | null;
  tournamentMax: number | null;
  loading: boolean;
  onClose: () => void;
}) {
  // Sort by fewest pitches LEFT today, ascending — coaches asked
  // for "who's about to hit their limit" at a glance, so the most
  // urgent (lowest remaining, including resting pitchers) lands at
  // the front of the row. Pitchers with no recorded daily cap get
  // pushed to the end (treated as +Infinity remaining) since we
  // genuinely don't know how much gas they have.
  //
  // Resting pitchers count as 0 remaining today and sort to the
  // very front so a coach scanning the panel sees who's unavailable
  // before anything else.
  const sorted = [...availability].sort((a, b) => {
    const aRest = a.restingUntil ? 0 : (a.pitchesAvailableToday ?? Number.POSITIVE_INFINITY);
    const bRest = b.restingUntil ? 0 : (b.pitchesAvailableToday ?? Number.POSITIVE_INFINITY);
    if (aRest !== bRest) return aRest - bRest;
    // Tiebreak: more pitches thrown today = more urgent / closer to cap.
    return b.pitchesToday - a.pitchesToday;
  });

  return (
    <div
      className="relative w-full bg-[#06101f] border-t border-accent/40 px-2 sm:px-4 py-2 sm:py-2.5"
      data-testid="tournament-pitches-panel"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-broadcast uppercase tracking-wider text-accent">
          <Trophy className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          Tournament Pitches
          {(dailyMax != null || tournamentMax != null) && (
            <span className="text-slate-400 normal-case tracking-normal font-sans text-[10px]">
              {dailyMax != null ? `daily ${dailyMax}` : ""}
              {dailyMax != null && tournamentMax != null ? " · " : ""}
              {tournamentMax != null ? `tournament ${tournamentMax}` : ""}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide tournament pitches"
          className="text-slate-400 hover:text-white p-1 -mr-1"
          data-testid="button-close-tournament-pitches"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {loading ? (
        <div className="text-[11px] text-slate-400 py-2">Loading availability…</div>
      ) : sorted.length === 0 ? (
        <div className="text-[11px] text-slate-400 py-2">
          No pitchers on the roster.
        </div>
      ) : (
        <div
          /* `touch-action: pan-x` keeps the horizontal swipe gesture
           * attached to this strip on mobile. Without it the parent
           * scroll container (the Order tab on phones) claims the
           * touch as a vertical pan the moment your finger moves at
           * all, so the pitcher chips off the right edge become
           * unreachable. Pairing it with `overscroll-behavior-x:
           * contain` prevents the swipe from triggering a browser
           * back-gesture once you scroll past the last chip. */
          className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 overscroll-x-contain"
          style={{ touchAction: "pan-x" }}
        >
          {sorted.map((p) => (
            <PitcherChip key={p.playerId} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

// Opt-in horizontal strip of per-player Infield/Outfield/Bench inning
// counts (pitching ignored). Rows arrive pre-sorted most-benched-first so
// the coach's eye lands on whoever's sat the longest. Each chip leads with
// the player's short name and a row of category counts; Bench is tinted
// amber and zero counts dim out so the meaningful numbers pop.
function RotationTallyPanel({
  rows,
  fieldCats,
  onClose,
}: {
  rows: RotationTallyRow[];
  fieldCats: string[];
  onClose: () => void;
}) {
  // Stable column order: the field categories that actually appeared, then
  // Bench last so it always sits at the right edge of every row.
  const cols = [...fieldCats, "Bench"];
  // One shared grid template drives the column header AND every body row so
  // the numbers line up in tidy columns. Name takes the slack; each count
  // column is a fixed 2.5rem so digits align no matter the roster.
  const gridCols = {
    gridTemplateColumns: `minmax(0,1fr) repeat(${cols.length}, 2.5rem)`,
  };
  return (
    <div
      /* Floating HUD card, anchored bottom-right. On phones it lifts above
       * the FIELD/ORDER tab bar (bottom-20) and spans most of the width;
       * on tablet/desktop it's a compact ~21rem card in the corner. The
       * whole thing is capped at 70vh and its body scrolls internally. */
      className="fixed z-[60] right-2 bottom-2 max-lg:bottom-20 max-lg:left-2 lg:left-auto w-auto lg:w-[21rem] max-w-[calc(100vw-1rem)] max-h-[70vh] flex flex-col rounded-xl border border-sky-400/30 bg-[#0a1424]/95 backdrop-blur-sm shadow-2xl shadow-black/70 overflow-hidden"
      data-testid="rotation-tally-panel"
      role="dialog"
      aria-label="Rotation tally"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/10 bg-[#0f1d33] shrink-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="flex items-center gap-1.5 text-xs font-broadcast uppercase tracking-wider text-sky-300">
            <RotateCcw className="h-3.5 w-3.5" />
            Rotation
          </span>
          <span className="text-[10px] text-slate-400 truncate">
            innings by area
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide rotation tally"
          className="text-slate-400 hover:text-white hover:bg-white/10 rounded-md p-1 -mr-1 shrink-0"
          data-testid="button-close-rotation-tally"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-slate-400 px-3 py-4 text-center">
          No lineup to tally yet.
        </div>
      ) : (
        <div
          /* Vertical scroll — rosters run 12-15 deep. `touch-action: pan-y`
           * keeps the pan attached to this list and `overscroll-contain`
           * stops it bubbling out once you hit the ends. */
          className="overflow-y-auto overscroll-contain min-h-0"
          style={{ touchAction: "pan-y" }}
        >
          {/* Sticky column header so the IF / OF / B labels stay visible
           * while the list scrolls under them. */}
          <div
            className="sticky top-0 z-10 grid items-center gap-x-1 px-3 py-1.5 bg-[#0a1424]/95 backdrop-blur-sm border-b border-white/5 text-[10px] font-broadcast uppercase tracking-wider text-slate-400"
            style={gridCols}
          >
            <span>Player</span>
            {cols.map((c) => (
              <span
                key={c}
                className={`text-center ${c === "Bench" ? "text-amber-300/80" : "text-sky-300/70"}`}
              >
                {ROTATION_CAT_SHORT[c] ?? c.slice(0, 2)}
              </span>
            ))}
          </div>
          <div className="px-1.5 py-1">
            {rows.map((r, i) => (
              <div
                key={r.playerId}
                className={`grid items-center gap-x-1 px-1.5 py-1.5 rounded-lg ${
                  i % 2 === 1 ? "bg-white/[0.03]" : ""
                }`}
                style={gridCols}
                data-testid={`rotation-tally-chip-${r.playerId}`}
              >
                <span className="text-sm font-medium text-white truncate min-w-0 pr-1">
                  {formatPlayerNameShort(r.name)}
                </span>
                {cols.map((c) => {
                  const n = c === "Bench" ? r.bench : (r.counts[c] ?? 0);
                  const isBench = c === "Bench";
                  return (
                    <span
                      key={c}
                      className={`text-center text-sm tabular-nums font-semibold ${
                        n === 0
                          ? "text-slate-600"
                          : isBench
                            ? "text-amber-300"
                            : "text-sky-200"
                      }`}
                    >
                      {n}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
