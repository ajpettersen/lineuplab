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
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, Moon, Sun } from "lucide-react";
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

  // Polling interval: 5s feels live without hammering the API. The query is
  // also re-fetched on window focus (default react-query behavior) so a
  // coach who taps the iPad screen sees the freshest data right away.
  const POLL_MS = 5000;

  const { data: game } = useGetGame(id, {
    query: {
      enabled: !!id,
      queryKey: getGetGameQueryKey(id),
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: true,
    },
  });
  const { data: lineup = [] } = useGetGameLineup(id, {
    query: {
      enabled: !!id,
      queryKey: getGetGameLineupQueryKey(id),
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: true,
    },
  });

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

  // Coach can tap a batter to mark them as "currently up" — the row pulses
  // and the on-deck/in-the-hole rows show below. Stored as the player's
  // index in battingOrderRows (not the slot number). Because polling can
  // shrink or reorder the batting list while the iPad is showing it, an
  // effect below pins the index back to the same player (by playerId) when
  // possible, or clamps into range if that player is gone — otherwise the
  // hero card silently goes blank exactly when a phone edit lands.
  const [currentBatterIdx, setCurrentBatterIdx] = useState(0);

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

  // Reconcile the at-bat index against polled changes to the batting order.
  // Only depends on the LIST length / shape — never on currentBatterIdx —
  // because we must not undo a coach's Next/Prev tap. When phone edits land
  // and the list shrinks, we clamp the index into range so the hero never
  // blanks out at the worst possible moment. (We intentionally don't try to
  // chase the same player across reorders: simple is safer than clever for
  // the dugout-fence case, and a same-length reorder is rare mid-game.)
  useEffect(() => {
    if (battingOrder.length === 0) {
      if (currentBatterIdx !== 0) setCurrentBatterIdx(0);
      return;
    }
    if (currentBatterIdx >= battingOrder.length) {
      setCurrentBatterIdx(currentBatterIdx % battingOrder.length);
    }
    // We deliberately omit currentBatterIdx from the dep array — adding it
    // would make this effect fight Next/Prev clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battingOrder.length]);

  // Score line on the header.
  const ourScore = game?.ourScore ?? 0;
  const oppScore = game?.opponentScore ?? 0;

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
          qc.invalidateQueries({ queryKey });
          qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() });
        } catch {
          // Drop any queued follow-up drags — they were computed assuming
          // this save succeeded. Refetch authoritative state and let the
          // coach redo. (Network failures at the field are rare; when they
          // happen, snapping to server truth + a toast is the safest UX.)
          pendingLineupRef.current = null;
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

  // Derive at-bat / on-deck / in-the-hole rows once so the hero block at the
  // top of the sidebar and the row highlighting in the full list stay in sync.
  const atBatRow = battingOrder[currentBatterIdx];
  const onDeckRow =
    battingOrder.length > 0
      ? battingOrder[(currentBatterIdx + 1) % battingOrder.length]
      : undefined;
  const inHoleRow =
    battingOrder.length > 0
      ? battingOrder[(currentBatterIdx + 2) % battingOrder.length]
      : undefined;

  const advanceBatter = () =>
    setCurrentBatterIdx((i) =>
      battingOrder.length === 0 ? 0 : (i + 1) % battingOrder.length,
    );
  const rewindBatter = () =>
    setCurrentBatterIdx((i) =>
      battingOrder.length === 0
        ? 0
        : (i - 1 + battingOrder.length) % battingOrder.length,
    );

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
          <div
            aria-live="polite"
            className={`hidden md:flex items-center gap-2 text-xs uppercase tracking-wider font-semibold transition-opacity duration-500 ${
              justUpdated ? "text-emerald-400 opacity-100" : "text-slate-400 opacity-90"
            }`}
            data-testid="text-update-status"
          >
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                justUpdated ? "bg-emerald-400 animate-pulse" : "bg-emerald-500/70"
              }`}
              aria-hidden="true"
            />
            {justUpdated ? "Just updated" : "Live"}
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
            style={{
              background:
                "radial-gradient(ellipse 75% 60% at 50% 60%, rgb(38, 120, 60) 0%, rgb(22, 86, 40) 55%, rgb(8, 38, 18) 100%)",
            }}
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

            {/* Soft top vignette so the inning header reads cleanly over the
                top of the bright grass */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/30 to-transparent" />

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

        {/* Batting panel: sticky AT BAT hero on top, scrollable order below */}
        <aside className="border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900/40 flex flex-col min-h-0 lg:overflow-hidden">
          {/* Hero: who's up + on deck/in the hole + Next Batter (always visible, no scrolling) */}
          <div className="shrink-0 border-b border-slate-800 p-3 sm:p-4 bg-slate-900/60">
            {atBatRow ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-[10px] uppercase tracking-[0.3em] text-amber-400 font-bold">
                    At Bat
                  </span>
                </div>
                <div
                  className="flex items-center gap-3"
                  data-testid="hero-at-bat"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <span className="inline-flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-full bg-amber-400 text-slate-950 text-xl sm:text-2xl font-black tabular-nums shadow-lg">
                    {atBatRow.order ?? "—"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xl sm:text-2xl font-bold leading-tight truncate text-white">
                      {atBatRow.playerName}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="rounded-md bg-slate-800/60 border border-slate-700/60 px-2.5 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold leading-none">
                      On Deck
                    </div>
                    <div
                      className="mt-1 text-sm font-bold text-slate-100 truncate leading-tight"
                      data-testid="text-on-deck"
                    >
                      {onDeckRow?.playerName ?? "—"}
                    </div>
                  </div>
                  <div className="rounded-md bg-slate-800/40 border border-slate-700/40 px-2.5 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold leading-none">
                      In the Hole
                    </div>
                    <div
                      className="mt-1 text-sm font-bold text-slate-200 truncate leading-tight"
                      data-testid="text-in-hole"
                    >
                      {inHoleRow?.playerName ?? "—"}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-2 mt-3">
                  <Button
                    variant="outline"
                    onClick={rewindBatter}
                    className="h-12 w-12 p-0 border-slate-700 bg-slate-800/60 text-slate-100 hover:bg-slate-700"
                    aria-label="Previous batter"
                    data-testid="button-prev-batter"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    onClick={advanceBatter}
                    className="h-12 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-base shadow-lg"
                    data-testid="button-next-batter"
                  >
                    Next Batter
                    <ChevronRight className="h-5 w-5 ml-1" />
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-slate-400 text-sm py-2">
                No batting order yet. Set one from the game page.
              </div>
            )}
          </div>

          {/* Full batting order: scrolls inside the sidebar so the hero stays put */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-[10px] sm:text-xs uppercase tracking-[0.3em] text-slate-500 font-semibold">
                Batting Order
              </h2>
              <span className="text-[10px] uppercase tracking-wider text-slate-600">
                tap to set up
              </span>
            </div>
            <ol className="flex flex-col gap-1.5">
              {battingOrder.length === 0 && (
                <li className="text-slate-500 text-sm">No batting order yet.</li>
              )}
              {battingOrder.map((r, i) => {
                const isUp = i === currentBatterIdx;
                const isOnDeck = i === (currentBatterIdx + 1) % battingOrder.length;
                const isHole = i === (currentBatterIdx + 2) % battingOrder.length;
                const slotLabel = r.order != null ? r.order : "—";
                return (
                  <li key={r.playerId}>
                    <button
                      type="button"
                      onClick={() => setCurrentBatterIdx(i)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border transition-colors text-left ${
                        isUp
                          ? "bg-amber-400/95 border-amber-300 text-slate-950 shadow"
                          : isOnDeck
                            ? "bg-slate-800/80 border-slate-600 text-slate-100"
                            : isHole
                              ? "bg-slate-800/40 border-slate-700 text-slate-200"
                              : "bg-slate-900/40 border-slate-800 text-slate-300 hover:bg-slate-800/60"
                      }`}
                      data-testid={`batter-row-${i}`}
                    >
                      <span
                        className={`inline-flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full text-xs sm:text-sm font-bold tabular-nums ${
                          isUp
                            ? "bg-slate-950 text-amber-300"
                            : "bg-slate-700 text-slate-100"
                        }`}
                      >
                        {slotLabel}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm sm:text-base font-bold leading-tight truncate">
                          {r.playerName}
                        </span>
                        {(isUp || isOnDeck || isHole) && (
                          <span
                            className={`block text-[9px] sm:text-[10px] uppercase tracking-wider font-semibold mt-0.5 leading-none ${
                              isUp ? "text-slate-700" : "text-slate-500"
                            }`}
                          >
                            {isUp ? "At Bat" : isOnDeck ? "On Deck" : "In the Hole"}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
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
