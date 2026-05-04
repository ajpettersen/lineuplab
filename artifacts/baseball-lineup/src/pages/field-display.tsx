import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetGame,
  useGetGameLineup,
  useSaveLineup,
  getGetGameQueryKey,
  getGetGameLineupQueryKey,
  getGetSeasonStatsQueryKey,
  getGetPlayerStatsQueryKey,
  type LineupEntry,
  type Game,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, Moon, Sun, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

const FIELD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;

/**
 * Drag-and-drop "where am I dropping" payload, attached to each droppable
 * via @dnd-kit's `data` field and pulled out in handleDragEnd. Field Display
 * only ever shows one inning at a time so we don't carry inning info in the
 * payload — the component reads `currentInning` directly when applying moves.
 *   tile       → drop onto an occupied position chip (swap)
 *   emptyField → drop onto an empty position chip (move into open slot)
 *   benchArea  → drop onto the bench strip itself (send to bench)
 */
type MoveTarget =
  | { kind: "tile"; entryId: number; position: string }
  | { kind: "emptyField"; position: string }
  | { kind: "benchArea" };

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Diamond-shaped position layout for the dugout-fence iPad. Coordinates are
 * percentages of the field's bounding box so the SVG/CSS layout scales to
 * any screen size. Picked to match how a coach in the dugout naturally reads
 * the field: pitcher in the middle, catcher behind home, infielders form an
 * arc, outfielders along the back.
 */
const POSITION_LAYOUT: Record<
  (typeof FIELD_POSITIONS)[number],
  { top: string; left: string }
> = {
  CF: { top: "11%", left: "50%" },
  LF: { top: "20%", left: "22%" },
  RF: { top: "20%", left: "78%" },
  SS: { top: "46%", left: "38%" },
  "2B": { top: "46%", left: "62%" },
  "3B": { top: "58%", left: "23%" },
  "1B": { top: "58%", left: "77%" },
  P: { top: "62%", left: "50%" },
  C: { top: "88%", left: "50%" },
};

/**
 * Color-code each position by group so the field reads at a glance from
 * across the dugout. Pitcher = bold gold (matches the at-bat hero accent),
 * infield = warm amber, outfield = cool sky, catcher = neutral white. The
 * accent shows up on the position pill above each player chip.
 */
const POSITION_ACCENT: Record<(typeof FIELD_POSITIONS)[number], string> = {
  P: "bg-amber-400 text-slate-950",
  C: "bg-slate-100 text-slate-900",
  "1B": "bg-amber-300 text-slate-900",
  "2B": "bg-amber-300 text-slate-900",
  "3B": "bg-amber-300 text-slate-900",
  SS: "bg-amber-300 text-slate-900",
  LF: "bg-sky-300 text-slate-900",
  CF: "bg-sky-300 text-slate-900",
  RF: "bg-sky-300 text-slate-900",
};

/**
 * Time-of-day lighting for the field. Bands picked to match how a youth
 * baseball/softball season actually plays out:
 *   morning   05:00–08:59  early Saturday tournament games — soft golden light
 *   day       09:00–15:59  bright midday — the default cheery green field
 *   evening   16:00–18:59  weeknight games at the start of the season —
 *                          warm orange "golden hour" wash over the field
 *   night     19:00–04:59  weeknight games mid-summer or late tournaments —
 *                          dark grass with stadium-light pools from the back
 *
 * Driven off the game's scheduled start time (`game.gameDate`), not wall
 * clock — once a game starts at 7pm it stays "night" for the duration even
 * if it runs late into the evening, so the visual identity is stable.
 */
type LightingMode = "morning" | "day" | "evening" | "night";

function getLightingMode(gameDate: string | undefined): LightingMode {
  if (!gameDate) return "day";
  const d = new Date(gameDate);
  if (Number.isNaN(d.getTime())) return "day";
  const h = d.getHours();
  if (h >= 5 && h < 9) return "morning";
  if (h >= 9 && h < 16) return "day";
  if (h >= 16 && h < 19) return "evening";
  return "night";
}

interface LightingPalette {
  /** CSS background for the field card itself (the grass gradient). */
  grassGradient: string;
  /** Tailwind gradient classes for the soft top vignette. */
  topVignette: string;
  /** Optional warm/cool wash overlaid on the field with mix-blend-soft-light
   *  to simulate sun/dusk light without bleaching the chips. Null = none. */
  ambientOverlay: string | null;
  /** When true, render the 3 stadium-light pools at the top of the field. */
  stadiumLights: boolean;
  /** For data-testid so e2e tests can assert the right palette is active. */
  label: LightingMode;
}

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

/** localStorage with try/catch so private mode / quota errors don't crash. */
function loadJSON<T>(key: string): T | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / private mode — silently degrade. The in-memory
    // React Query cache and the pendingLineupRef still work for this
    // session; we just can't survive a refresh.
  }
}

function clearKey(key: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  } catch {
    // ignored
  }
}

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

const FIELD_LIGHTING: Record<LightingMode, LightingPalette> = {
  morning: {
    grassGradient:
      "radial-gradient(ellipse 75% 60% at 50% 60%, rgb(58, 142, 76) 0%, rgb(34, 102, 50) 55%, rgb(16, 56, 26) 100%)",
    topVignette: "from-amber-200/20 to-transparent",
    ambientOverlay:
      "bg-gradient-to-br from-amber-200/30 via-yellow-100/10 to-transparent",
    stadiumLights: false,
    label: "morning",
  },
  day: {
    grassGradient:
      "radial-gradient(ellipse 75% 60% at 50% 60%, rgb(38, 120, 60) 0%, rgb(22, 86, 40) 55%, rgb(8, 38, 18) 100%)",
    topVignette: "from-black/30 to-transparent",
    ambientOverlay: null,
    stadiumLights: false,
    label: "day",
  },
  evening: {
    grassGradient:
      "radial-gradient(ellipse 75% 60% at 50% 60%, rgb(48, 112, 58) 0%, rgb(28, 78, 38) 55%, rgb(12, 42, 22) 100%)",
    topVignette: "from-orange-500/30 via-rose-400/10 to-transparent",
    ambientOverlay:
      "bg-gradient-to-br from-orange-500/35 via-rose-400/15 to-transparent",
    stadiumLights: false,
    label: "evening",
  },
  night: {
    grassGradient:
      "radial-gradient(ellipse 75% 60% at 50% 60%, rgb(22, 78, 40) 0%, rgb(12, 48, 24) 55%, rgb(4, 22, 10) 100%)",
    topVignette: "from-slate-950/70 to-transparent",
    ambientOverlay: "bg-gradient-to-b from-slate-950/40 via-transparent to-slate-950/30",
    stadiumLights: true,
    label: "night",
  },
};

/**
 * Dugout / fence-iPad display. Read-only big-text view of the current
 * inning's defense plus the batting order. Polls the lineup every few
 * seconds so a change made on the coach's phone shows up on the iPad
 * without anyone touching it. Designed to fill the screen — no app
 * navigation, no header — because the iPad is strapped to the fence.
 */
export default function FieldDisplay() {
  const [, params] = useRoute("/games/:id/display");
  const id = parseInt(params?.id ?? "0");
  const { teamName, teamShortName } = useTeamSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const saveLineup = useSaveLineup();

  // Sensor config mirrors game-detail.tsx so the dugout iPad behaves the
  // same as a parent's phone: a 5px slop for mouse so a click isn't
  // misread as a drag, and a 150ms long-press + 5px tolerance for touch
  // so scrolling the page doesn't accidentally start a drag (and vice
  // versa). Field Display has no scroll on tablet+, but the mobile
  // fallback layout does, so the touch delay matters there.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );
  // Tracks the entry whose chip is currently being dragged so we can hide
  // the original (it's flying around in the DragOverlay) and so the
  // bench/field can mute the same player elsewhere if they show twice.
  const [activeDragEntryId, setActiveDragEntryId] = useState<number | null>(null);

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

  // Online/offline + has-unsynced-changes status, surfaced in the header
  // badge. `hasUnsyncedChanges` is initialized lazily from localStorage so
  // a refresh while offline (with persisted pending edits) still shows the
  // correct "Offline · will sync" state on first paint.
  const online = useOnlineStatus();
  const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState<boolean>(
    () => loadJSON(pendingSaveKey(id)) != null,
  );

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
  const initialGame = useMemo<Game | undefined>(
    () => loadJSON<Game>(gameCacheKey(id)),
    [id],
  );
  const initialLineup = useMemo<LineupEntry[] | undefined>(() => {
    // If we have an offline-pending snapshot from a previous session,
    // prefer it (it's the freshest desired state, not the server's). The
    // restore-pending effect below also seeds pendingLineupRef so the
    // online-flip effect knows to drain it.
    const pending = loadJSON<LineupEntry[]>(pendingSaveKey(id));
    if (pending) return pending;
    return loadJSON<LineupEntry[]>(lineupCacheKey(id));
  }, [id]);

  const { data: game } = useGetGame(id, {
    query: {
      enabled: !!id,
      queryKey: getGetGameQueryKey(id),
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: true,
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
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: true,
      initialData: initialLineup,
      initialDataUpdatedAt: 0,
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

  // Restore an offline-pending lineup snapshot (from a previous session)
  // into the in-memory ref so the existing flushSave logic can drain it.
  // We already hydrated React Query's cache with the same snapshot via
  // `initialLineup`, so the UI is already showing the right thing — we
  // just need to wire up the save side. Runs once per game id.
  useEffect(() => {
    if (!id) return;
    const pending = loadJSON<LineupEntry[]>(pendingSaveKey(id));
    if (!pending) return;
    pendingLineupRef.current = pending;
    setHasUnsyncedChanges(true);
    // If we mount already online, kick the chain immediately so the
    // pending POST happens without waiting for an online flip.
    if (typeof navigator !== "undefined" && navigator.onLine) {
      flushSave();
    }
    // Run-once-per-game-id; flushSave is stable enough for our purposes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // When the browser flips from offline → online, drain any pending
  // snapshot through the same single-flight save chain. flushSave is a
  // safe no-op when pendingLineupRef is null, so calling it on every
  // online event is fine. React Query's onlineManager will also resume
  // polling automatically, which gives us the post-reconnect refresh
  // for free without any extra work here.
  useEffect(() => {
    if (!online) return;
    flushSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // Coach-controlled "what inning is on the screen right now". Defaults to 1
  // and is bumped manually with the arrows so the display doesn't change
  // mid-inning just because somebody saved a future-inning tweak.
  const innings = game?.innings ?? 6;
  const [currentInning, setCurrentInning] = useState(1);
  useEffect(() => {
    // If the game shrinks (end-early) below the inning we're showing, snap
    // back to the last valid inning so the screen never goes blank.
    if (currentInning > innings) setCurrentInning(innings);
  }, [innings, currentInning]);

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

  // Score line on the header.
  const ourScore = game?.ourScore ?? 0;
  const oppScore = game?.opponentScore ?? 0;

  // Pick the field lighting palette based on the game's scheduled start.
  // Memoized so a 5s lineup poll doesn't re-derive on every tick — only when
  // the game date itself changes (very rare during a live game).
  const lighting = useMemo(
    () => FIELD_LIGHTING[getLightingMode(game?.gameDate)],
    [game?.gameDate],
  );

  // Dim Mode — drops a translucent black overlay across the whole page so the
  // iPad's backlight isn't pumping out full brightness during dead time
  // (between innings, between games on a 3-game weekend, etc). On LCD iPads
  // this is a perceptual dimmer that also nudges the user to drop the system
  // brightness slider; on OLED it directly saves battery because dark pixels
  // are off pixels. Persisted to localStorage so an accidental Exit → back
  // doesn't lose the setting mid-game.
  const DIM_KEY = "fd-dim-mode";
  const [dimMode, setDimMode] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(DIM_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(DIM_KEY, dimMode ? "1" : "0");
    } catch {
      // Private mode / storage disabled — silent no-op; the in-memory state
      // still works for this session.
    }
  }, [dimMode]);

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
            setHasUnsyncedChanges(false);
          }
          qc.invalidateQueries({ queryKey });
          qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() });
        } catch {
          // Distinguish a clean offline-drop from a real server error.
          // If the browser flipped offline mid-POST, restore pending so
          // we retry on reconnect. (Captive-portal/blocked-but-online
          // scenarios fall through to the toast path below — better to
          // show the coach a one-off error than silently lose the move.)
          if (typeof navigator !== "undefined" && !navigator.onLine) {
            // Restore only if no newer drag has set a fresher pending
            // (which would already be persisted by saveLineupOptimistically).
            if (pendingLineupRef.current == null) {
              pendingLineupRef.current = toSave;
              saveJSON(pendingSaveKey(id), toSave);
            }
            setHasUnsyncedChanges(true);
            return;
          }
          // Real server error: drop pending, refetch authoritative state,
          // toast the coach. Same logic as before — don't snapshot-rollback
          // because that could clobber newer successful state.
          if (pendingLineupRef.current == null) {
            clearKey(pendingSaveKey(id));
            setHasUnsyncedChanges(false);
          }
          qc.invalidateQueries({ queryKey });
          toast({
            title: "Couldn't save move",
            description: "Pulled the latest lineup from the server. Try again.",
            variant: "destructive",
          });
        }
      })
      .catch(() => {
        // Defensive — keep the queue alive no matter what.
      });
  };

  const saveLineupOptimistically = (nextLineup: LineupEntry[]) => {
    const queryKey = getGetGameLineupQueryKey(id);
    qc.setQueryData(queryKey, nextLineup);
    pendingLineupRef.current = nextLineup;
    // Persist the offline backup BEFORE attempting the POST so a Safari
    // crash / iPad reboot mid-save doesn't lose the drag. flushSave will
    // clear this entry on success.
    saveJSON(pendingSaveKey(id), nextLineup);
    setHasUnsyncedChanges(true);
    // flushSave is offline-aware: it'll skip the POST and just leave
    // pending in place if we're offline, then drain on reconnect.
    flushSave();
  };

  const handleDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (!id.startsWith("player-")) return;
    setActiveDragEntryId(parseInt(id.slice("player-".length), 10));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragEntryId(null);
    if (!e.over) return;
    const sourceId = String(e.active.id);
    if (!sourceId.startsWith("player-")) return;
    const sourceEntryId = parseInt(sourceId.slice("player-".length), 10);
    const target = e.over.data.current as MoveTarget | undefined;
    if (!target) return;
    const next = applyMove(sourceEntryId, target);
    if (next) saveLineupOptimistically(next);
  };

  const handleDragCancel = () => setActiveDragEntryId(null);

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
    <div className="min-h-[100dvh] lg:h-[100dvh] bg-slate-950 text-slate-100 flex flex-col select-none lg:overflow-hidden">
      {/* ── Header (combined: team + inning + score + actions) ── */}
      <header className="flex items-center justify-between gap-3 px-3 sm:px-6 py-2 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur shrink-0">
        {/* Left cluster: exit + team vs opponent */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <Link href={`/games/${id}`}>
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-300 hover:text-white hover:bg-slate-800 px-2 sm:px-3"
              data-testid="button-exit-display"
            >
              <ArrowLeft className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Exit</span>
            </Button>
          </Link>
          <div className="min-w-0">
            <div className="text-base sm:text-xl font-bold truncate leading-tight">
              {teamShortName || teamName || "Team"}
              <span className="mx-1.5 text-slate-500 font-normal">vs</span>
              <span className="truncate">{game?.opponent ?? ""}</span>
            </div>
          </div>
        </div>

        {/* Center cluster: compact inning controls (always visible) */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setCurrentInning((i) => Math.max(1, i - 1))}
            disabled={currentInning <= 1}
            className="h-11 w-11 sm:h-12 sm:w-12 p-0 border-slate-700 bg-slate-800/60 text-slate-100 hover:bg-slate-700 disabled:opacity-30"
            data-testid="button-prev-inning"
            aria-label="Previous inning"
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <div className="text-center min-w-[68px] sm:min-w-[88px]">
            <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.25em] text-slate-500 leading-none">
              Inning
            </div>
            <div
              className="text-3xl sm:text-4xl font-black tabular-nums leading-none mt-0.5"
              data-testid="text-current-inning"
            >
              {currentInning}
              <span className="text-slate-600 text-lg sm:text-xl font-bold">
                {" "}/ {innings}
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            size="lg"
            onClick={() => setCurrentInning((i) => Math.min(innings, i + 1))}
            disabled={currentInning >= innings}
            className="h-11 w-11 sm:h-12 sm:w-12 p-0 border-slate-700 bg-slate-800/60 text-slate-100 hover:bg-slate-700 disabled:opacity-30"
            data-testid="button-next-inning"
            aria-label="Next inning"
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
        </div>

        {/* Right cluster: live status, score, fullscreen */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0 flex-1 justify-end">
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
            className={`hidden md:flex items-center gap-2 text-xs uppercase tracking-wider font-semibold transition-opacity duration-500 ${
              !online
                ? "text-amber-400 opacity-100"
                : justUpdated
                  ? "text-emerald-400 opacity-100"
                  : "text-slate-400 opacity-90"
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
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    justUpdated ? "bg-emerald-400 animate-pulse" : "bg-emerald-500/70"
                  }`}
                  aria-hidden="true"
                />
                <span>{justUpdated ? "Just updated" : "Live"}</span>
              </>
            )}
          </div>
          <div className="text-xl sm:text-2xl font-bold tabular-nums">
            <span className="text-slate-300">{ourScore}</span>
            <span className="mx-1.5 text-slate-600">–</span>
            <span className="text-slate-300">{oppScore}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDimMode((d) => !d)}
            className={`px-2 ${
              dimMode
                ? "text-amber-300 hover:text-amber-200 hover:bg-slate-800"
                : "text-slate-300 hover:text-white hover:bg-slate-800"
            }`}
            aria-label={dimMode ? "Disable dim mode (brighten screen)" : "Enable dim mode (save battery)"}
            aria-pressed={dimMode}
            title={dimMode ? "Brighten" : "Dim screen to save battery"}
            data-testid="button-dim-mode"
          >
            {dimMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="text-slate-300 hover:text-white hover:bg-slate-800 px-2"
            aria-label="Toggle fullscreen"
            data-testid="button-fullscreen"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

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
      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_minmax(320px,400px)] lg:overflow-hidden">
        {/* Field section: diagram fills the available height; bench strip pinned below */}
        <section
          className="flex flex-col p-3 sm:p-4 min-h-0 lg:overflow-hidden"
          data-testid="section-field"
        >
          <div
            className="relative w-full flex-1 min-h-[420px] lg:min-h-0 rounded-2xl border border-emerald-950/60 overflow-hidden shadow-[inset_0_0_60px_rgba(0,0,0,0.45)]"
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
                  <stop offset="0%" stopColor="rgb(48, 130, 65)" />
                  <stop offset="100%" stopColor="rgb(28, 95, 45)" />
                </radialGradient>
                {/* Faint grass mowing stripes for that broadcast look */}
                <pattern
                  id="fd-stripes"
                  width="100"
                  height="6"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="100" height="3" fill="rgba(255,255,255,0.025)" />
                </pattern>
              </defs>

              {/* Mowing stripes overlay across the whole grass */}
              <rect width="100" height="100" fill="url(#fd-stripes)" />

              {/* Outfield warning track arc — subtle line at the back */}
              <path
                d="M 4 36 Q 50 -12 96 36"
                stroke="rgba(255,255,255,0.10)"
                strokeWidth="0.6"
                fill="none"
              />
              <path
                d="M 7 38 Q 50 -8 93 38"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="0.4"
                fill="none"
              />

              {/* Foul lines from home plate out past 1B and 3B to the corners */}
              <line
                x1="50" y1="92" x2="2" y2="32"
                stroke="rgba(255,255,255,0.55)" strokeWidth="0.35"
              />
              <line
                x1="50" y1="92" x2="98" y2="32"
                stroke="rgba(255,255,255,0.55)" strokeWidth="0.35"
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

              {/* Basepath chalk outline (just inside the dirt edge) */}
              <path
                d="M 50 92 L 73 67 L 50 42 L 27 67 Z"
                fill="none"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth="0.25"
              />

              {/* Pitcher's mound */}
              <circle
                cx="50" cy="60" r="3.6"
                fill="url(#fd-mound)"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="0.18"
              />
              {/* Pitcher's rubber */}
              <rect x="48.5" y="59.7" width="3" height="0.6" fill="rgba(255,255,255,0.85)" />

              {/* Bases (rotated squares) */}
              <g fill="white" stroke="rgba(0,0,0,0.35)" strokeWidth="0.15">
                <rect x="48.5" y="40.5" width="3" height="3" transform="rotate(45 50 42)" />
                <rect x="71.5" y="65.5" width="3" height="3" transform="rotate(45 73 67)" />
                <rect x="25.5" y="65.5" width="3" height="3" transform="rotate(45 27 67)" />
              </g>

              {/* Home plate (pentagon) */}
              <polygon
                points="50,89 53,91.5 53,94.5 47,94.5 47,91.5"
                fill="white"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth="0.15"
              />

              {/* Batter's boxes (subtle) */}
              <rect x="44.5" y="89.5" width="2" height="5" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.15" />
              <rect x="53.5" y="89.5" width="2" height="5" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.15" />
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

            {FIELD_POSITIONS.map((pos) => (
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
              />
            ))}
          </div>

          {/* Bench strip below the field — single compact line, also a drop
              zone so a fielder can be benched by dragging their chip onto it. */}
          <BenchStrip
            entries={benchEntries}
            activeDragEntryId={activeDragEntryId}
          />
        </section>

        {/* Batting panel: full batting order, fits the sidebar height with
         *  no scrolling. Each row is a flex child of an equal-distribution
         *  column (`flex-1 basis-0`) so 9 batters get larger rows and 18
         *  batters get smaller ones — the list always fills the sidebar
         *  exactly without ever requiring a scroll, which is the whole
         *  point of mounting an iPad to the dugout fence. The "currently
         *  at bat" tracker was removed because there's no way to know
         *  what's actually happening on the field without GameChanger
         *  integration, and a stale at-bat indicator was worse than no
         *  indicator. */}
        <aside className="border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900/40 flex flex-col min-h-0 lg:overflow-hidden p-3 sm:p-4">
          <h2 className="shrink-0 text-[10px] sm:text-xs uppercase tracking-[0.3em] text-slate-500 font-semibold mb-2">
            Batting Order
          </h2>
          {battingOrder.length === 0 ? (
            <div className="text-slate-500 text-sm">No batting order yet.</div>
          ) : (
            <ol
              className="flex-1 min-h-0 flex flex-col gap-1"
              data-testid="batting-order-list"
            >
              {battingOrder.map((r) => {
                const slotLabel = r.order != null ? r.order : "—";
                return (
                  <li
                    key={r.playerId}
                    className="flex-1 basis-0 min-h-0 flex items-center gap-2.5 px-2.5 rounded-lg border bg-slate-900/40 border-slate-800 text-slate-100"
                    data-testid={`batter-row-${r.playerId}`}
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums bg-slate-700 text-slate-100">
                      {slotLabel}
                    </span>
                    <span className="flex-1 min-w-0 text-sm sm:text-base font-bold leading-tight truncate">
                      {r.playerName}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </main>

      {/* Floating chip that follows the cursor / finger during a drag.
          dropAnimation={null} so the chip vanishes the moment the move
          lands — the optimistic cache update makes it instantly appear in
          its new spot, so animating the floating chip back to the source
          would just be confusing. */}
      <DragOverlay dropAnimation={null}>
        {activeDragInfo ? (
          <div
            className="rounded-xl bg-slate-950/95 border-2 border-amber-300 shadow-[0_10px_30px_rgba(0,0,0,0.7)] px-4 py-2 cursor-grabbing select-none"
            data-testid="drag-overlay-chip"
          >
            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-300 leading-none mb-1">
              {activeDragInfo.position === "Bench" ? "Bench" : activeDragInfo.position}
            </div>
            <div className="text-sm font-bold text-white leading-tight">
              {activeDragInfo.name}
            </div>
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>

      {/*
       * Dim overlay. Fixed/full-viewport so it works in fullscreen mode too.
       * pointer-events-none → taps pass straight through to the controls
       * underneath, so the coach can still hit Next Batter / Next Inning /
       * the dim toggle itself without disabling dim first. Smooth fade so it
       * doesn't snap at the eye when toggled. 40% opacity = clearly dimmer
       * without becoming unreadable in any reasonable lighting; tested
       * against the bright amber At Bat pill which is the highest-contrast
       * element on screen.
       */}
      <div
        aria-hidden="true"
        data-testid="dim-overlay"
        className={`pointer-events-none fixed inset-0 z-50 bg-black transition-opacity duration-300 ${
          dimMode ? "opacity-40" : "opacity-0"
        }`}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components for drag & drop. Pulled out of the render loop so each
// chip can call useDraggable / useDroppable at the top level of its own
// component (React's rules-of-hooks).
// ─────────────────────────────────────────────────────────────────────────

interface FieldPositionSlotProps {
  pos: string;
  player: { name: string; playerId: number; entryId: number } | undefined;
  layout: { top: string; left: string };
  accent: string;
  isBeingDragged: boolean;
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
}: FieldPositionSlotProps) {
  const dropData: MoveTarget = player
    ? { kind: "tile", entryId: player.entryId, position: pos }
    : { kind: "emptyField", position: pos };
  const { isOver, setNodeRef } = useDroppable({
    id: `field-${pos}`,
    data: dropData,
  });
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
        />
      ) : (
        <EmptyFieldChip pos={pos} isOver={isOver} />
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
}

/** A filled position chip — the entire visible rectangle (including the
 *  position pill above it) is the drag handle so a coach with thick
 *  fingers can grab anywhere. */
function DraggableFieldChip({
  pos,
  accent,
  name,
  entryId,
  isOver,
  isBeingDragged,
}: DraggableFieldChipProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `player-${entryId}`,
  });
  const hidden = isDragging || isBeingDragged;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`relative rounded-xl backdrop-blur-md shadow-[0_6px_20px_rgba(0,0,0,0.55)] border bg-slate-950/85 border-white/20 touch-none cursor-grab active:cursor-grabbing select-none transition-shadow ${
        isOver ? "ring-2 ring-amber-300 shadow-[0_0_24px_rgba(252,211,77,0.55)]" : ""
      } ${hidden ? "opacity-30" : ""}`}
      data-testid={`field-chip-${pos}`}
      title={`${name} — drag to swap with another player`}
    >
      <div
        className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-black tracking-[0.18em] uppercase shadow-md whitespace-nowrap ${accent}`}
      >
        {pos}
      </div>
      <div className="px-3 pt-3 pb-2 min-w-[96px] sm:min-w-[120px] max-w-[160px] sm:max-w-[180px] text-center">
        <div className="text-sm sm:text-base font-bold leading-tight truncate text-white">
          {name}
        </div>
      </div>
    </div>
  );
}

/** Empty position cell — not draggable, but the parent slot is droppable
 *  so a chip can be dragged onto it. Highlights when something hovers. */
function EmptyFieldChip({ pos, isOver }: { pos: string; isOver: boolean }) {
  return (
    <div
      className={`relative rounded-xl backdrop-blur-md shadow-[0_6px_20px_rgba(0,0,0,0.55)] border border-dashed transition-colors ${
        isOver
          ? "bg-amber-300/15 border-amber-300"
          : "bg-slate-950/45 border-white/10"
      }`}
      data-testid={`field-chip-${pos}-empty`}
    >
      <div
        className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-black tracking-[0.18em] uppercase shadow-md whitespace-nowrap ${
          isOver ? "bg-amber-300 text-slate-950" : "bg-slate-700 text-slate-400"
        }`}
      >
        {pos}
      </div>
      <div className="px-3 pt-3 pb-2 min-w-[96px] sm:min-w-[120px] max-w-[160px] sm:max-w-[180px] text-center">
        <div
          className={`text-sm sm:text-base font-bold leading-tight truncate italic ${
            isOver ? "text-amber-200" : "text-slate-500"
          }`}
        >
          {isOver ? "Drop here" : "Open"}
        </div>
      </div>
    </div>
  );
}

interface BenchStripProps {
  entries: { name: string; entryId: number }[];
  activeDragEntryId: number | null;
}

/** Bench strip below the field — the whole strip is one drop zone so a
 *  fielder can be benched by dragging anywhere in the bar. Each name
 *  inside is itself draggable so a benched player can be subbed in. */
function BenchStrip({ entries, activeDragEntryId }: BenchStripProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: "bench-area",
    data: { kind: "benchArea" } satisfies MoveTarget,
  });
  return (
    <div
      ref={setNodeRef}
      className={`mt-2 sm:mt-3 rounded-xl border bg-slate-900/70 backdrop-blur-md px-3 py-2 shrink-0 shadow-[0_4px_12px_rgba(0,0,0,0.35)] transition-colors ${
        isOver
          ? "border-amber-300 ring-2 ring-amber-300/60 bg-amber-950/30"
          : "border-slate-800/80"
      }`}
      data-testid="bench-strip"
    >
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[10px] sm:text-xs uppercase tracking-[0.3em] text-amber-300/90 font-bold">
          Bench
        </span>
        {entries.length === 0 ? (
          <span className="text-sm text-slate-500">
            {isOver ? "Drop here to bench" : "—"}
          </span>
        ) : (
          entries.flatMap((entry, i) => {
            const node = (
              <DraggableBenchChip
                key={entry.entryId}
                name={entry.name}
                entryId={entry.entryId}
                isBeingDragged={entry.entryId === activeDragEntryId}
              />
            );
            return i === 0
              ? [node]
              : [
                  <span key={`sep-${i}`} className="text-slate-600 text-sm" aria-hidden="true">
                    ·
                  </span>,
                  node,
                ];
          })
        )}
      </div>
    </div>
  );
}

/** A single bench player name — draggable onto any field position to sub
 *  in (the displaced fielder takes the bench seat). */
function DraggableBenchChip({
  name,
  entryId,
  isBeingDragged,
}: {
  name: string;
  entryId: number;
  isBeingDragged: boolean;
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
      className={`text-sm sm:text-base font-semibold text-slate-100 touch-none cursor-grab active:cursor-grabbing select-none px-1 py-0.5 rounded transition-opacity ${
        hidden ? "opacity-30" : ""
      }`}
      data-testid={`bench-name-${name}`}
      title={`${name} — drag onto a position to sub in`}
    >
      {name}
    </span>
  );
}

// Re-export BASE so unused-import cleanup doesn't strip it; reserved for a
// future "share via QR code" feature on this screen.
export const __FIELD_DISPLAY_BASE = BASE;
