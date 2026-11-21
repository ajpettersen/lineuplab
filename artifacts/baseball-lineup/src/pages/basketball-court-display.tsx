import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getGetGameQueryKey, useGetGame } from "@workspace/api-client-react";
import {
  ArrowLeft,
  Bell,
  BellOff,
  ChevronsRight,
  GripVertical,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Undo2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/lib/confirm";
import { useHeartbeat } from "@/hooks/use-heartbeat";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { formatClock } from "@/lib/basketball-rotation";
import {
  BASKETBALL_SETUP_KEY,
  fetchBasketballSetup,
  fetchGameLineup,
  gameLineupKey,
  gameRotationInput,
} from "@/lib/basketball-setup";
import {
  bench,
  courtSpots,
  groupOf,
  onCourtIds,
  currentShift,
  isFlexShift,
  makeSub,
  nextSub,
  nextSubPairs,
  onCourt,
  putBack,
  secondsToNextSub,
  nudgeClock,
  setClock,
  settle,
  skipSub,
  startClock,
  startState,
  stopClock,
  subDue,
  swapPlayers,
  takeOut,
  totalShifts,
  undoLast,
  type CourtSpot,
  type LiveState,
} from "@/lib/basketball-live";

/**
 * Basketball game display (/games/:id/display on a basketball team): a half
 * court with the five on the floor at the 1–5 spots, a running game clock,
 * sub alerts from the Bench Sheet rotation, and playing time counted from the
 * clock. Changes on the fly (swap, take out, put back, jump ahead, undo) keep
 * the rotation going from where the game actually is; see lib/basketball-live.ts.
 *
 * The live game is kept on this device (localStorage), so it survives a
 * reload or a dropped gym connection. It isn't shared with other devices.
 */

const SPOT_LABEL: Record<CourtSpot, string> = { 1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C" };
// Where each spot sits on the half-court drawing (viewBox 0 0 500 470, basket at the bottom).
const SPOT_XY: Record<CourtSpot, [number, number]> = {
  1: [250, 95],
  2: [405, 165],
  3: [95, 165],
  4: [355, 300],
  5: [170, 330],
};
const HEADS_UP_SEC = 30;
const SYNC_EVERY_MS = 30_000;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Save this game's starters and playing time for the season stats. Best
 * effort: if the gym's connection drops, the next sync carries the totals.
 */
function syncGameStats(gameId: number, s: LiveState) {
  if (s.phase === "pregame" || !s.starterIds) return;
  const playedSec = Object.fromEntries(
    Object.entries(s.playedSec).filter(([id]) => /^\d+$/.test(id)).map(([id, sec]) => [id, Math.round(sec)]),
  );
  void fetch(`${BASE}/api/basketball-games/${gameId}/stats`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ starterIds: s.starterIds.filter((id) => /^\d+$/.test(id)).map(Number), playedSec }),
  }).catch(() => undefined);
}

function storageKey(gameId: number) {
  return `lineuplab:basketball-live:${gameId}`;
}
function loadState(gameId: number): LiveState | null {
  try {
    const raw = localStorage.getItem(storageKey(gameId));
    const parsed = raw ? (JSON.parse(raw) as LiveState) : null;
    // Games saved before position groups (version 1) can't be resumed.
    return parsed?.version === 2 ? parsed : null;
  } catch {
    return null;
  }
}
function saveState(gameId: number, state: LiveState | null) {
  try {
    if (state) localStorage.setItem(storageKey(gameId), JSON.stringify(state));
    else localStorage.removeItem(storageKey(gameId));
  } catch {
    // Private mode or storage full: the game still runs, it just won't survive a reload.
  }
}

/** A short two-tone chime, no audio files needed. */
function chime(ctx: AudioContext | null, urgent: boolean) {
  if (!ctx) return;
  const notes = urgent ? [880, 660, 880] : [660];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    const t = ctx.currentTime + i * 0.22;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  });
}

const fmt = (sec: number) => formatClock(Math.max(0, sec) / 60);
const joinNames = (names: string[]) => (names.length ? names.join(", ") : "—");

/** Drag handle + drop target for one player (court token or bench row). */
function usePlayerDnd(id: string) {
  const drag = useDraggable({ id: `player:${id}` });
  const drop = useDroppable({ id: `player:${id}` });
  const ref = (node: HTMLElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  };
  return { ref, attributes: drag.attributes, listeners: drag.listeners, isDragging: drag.isDragging, isOver: drop.isOver && !drag.isDragging };
}

function CourtToken({
  spot,
  id,
  name,
  selected,
  onTap,
}: {
  spot: CourtSpot;
  id: string;
  name: string;
  selected: boolean;
  onTap: (id: string) => void;
}) {
  const { ref, attributes, listeners, isDragging, isOver } = usePlayerDnd(id);
  const [x, y] = SPOT_XY[spot];
  return (
    <button
      ref={ref}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onTap(id)}
      aria-label={`${spot} ${SPOT_LABEL[spot]}: ${name}. Drag onto a bench player to sub, or tap.`}
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 touch-none select-none flex-col items-center ${isDragging ? "opacity-30" : ""}`}
      style={{ left: `${(x / 500) * 100}%`, top: `${((y + 14) / 470) * 100}%` }}
    >
      <span
        className={`flex h-[clamp(2.75rem,9vw,4.25rem)] w-[clamp(2.75rem,9vw,4.25rem)] flex-col items-center justify-center rounded-full border-4 leading-none shadow-md transition-transform ${
          selected ? "border-amber-700 bg-amber-400 text-black" : isOver ? "scale-110 border-amber-400 bg-primary text-primary-foreground" : "border-background bg-primary text-primary-foreground"
        }`}
      >
        <span className="font-display text-[clamp(1.1rem,3.4vw,1.6rem)] font-bold">{spot}</span>
        <span className="text-[10px] font-semibold opacity-85">{SPOT_LABEL[spot]}</span>
      </span>
      <span className="mt-1 max-w-[9rem] truncate rounded-md border bg-background/95 px-2 py-0.5 text-[clamp(0.8rem,2.2vw,1.05rem)] font-bold text-foreground shadow-sm">
        {name}
      </span>
    </button>
  );
}

function HalfCourt({
  spots,
  nameOf,
  selected,
  onTap,
}: {
  spots: { spot: CourtSpot | null; id: string }[];
  nameOf: (id: string) => string;
  selected: string | null;
  onTap: (id: string) => void;
}) {
  const placed = spots.filter((s): s is { spot: CourtSpot; id: string } => s.spot !== null);
  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 500 470" className="h-full w-full" role="img" aria-label="Half court">
        <rect x="2" y="2" width="496" height="466" rx="6" className="fill-amber-100 stroke-amber-900/60 dark:fill-amber-950/40 dark:stroke-amber-200/40" strokeWidth="3" />
        {/* Paint, free-throw circle, three-point arc, hoop. Basket at the bottom. */}
        <g className="fill-none stroke-amber-900/60 dark:stroke-amber-200/40" strokeWidth="3">
          <rect x="190" y="280" width="120" height="188" />
          <circle cx="250" cy="280" r="60" />
          <path d="M 35 468 L 35 400 A 215 215 0 0 1 465 400 L 465 468" />
          <line x1="220" y1="430" x2="280" y2="430" />
          <circle cx="250" cy="415" r="11" />
          <path d="M 2 2 L 498 2" />
          <circle cx="250" cy="2" r="60" />
        </g>
      </svg>
      {placed.map(({ spot, id }) => (
        <CourtToken key={id} spot={spot} id={id} name={nameOf(id)} selected={selected === id} onTap={onTap} />
      ))}
    </div>
  );
}

function BenchRow({
  id,
  name,
  role,
  comingIn,
  selected,
  onTap,
  onTakeOut,
}: {
  id: string;
  name: string;
  role: string;
  comingIn: boolean;
  selected: boolean;
  onTap: (id: string) => void;
  onTakeOut: (id: string) => void;
}) {
  const { ref, attributes, listeners, isDragging, isOver } = usePlayerDnd(id);
  return (
    <li
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${isDragging ? "opacity-30" : ""} ${
        selected ? "border-amber-500 bg-amber-100 dark:bg-amber-900/40" : isOver ? "border-amber-400 bg-amber-50 dark:bg-amber-900/30" : comingIn ? "border-primary/50 bg-primary/5" : ""
      }`}
    >
      <button
        ref={ref}
        type="button"
        {...attributes}
        {...listeners}
        onClick={() => onTap(id)}
        aria-label={`${name} on the bench. Drag onto a player on the court to sub, or tap.`}
        className="flex min-h-10 flex-1 touch-none select-none items-center gap-2 text-left"
      >
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="w-5 text-xs font-bold text-muted-foreground">{role}</span>
        <span className="flex-1 truncate text-lg font-semibold">{name}</span>
        {comingIn && <span className="text-xs font-bold uppercase text-primary">Next in</span>}
      </button>
      <Button variant="ghost" size="icon" aria-label={`Take ${name} out of the game`} onClick={() => onTakeOut(id)}>
        <UserMinus className="h-4 w-4" />
      </Button>
    </li>
  );
}

/** Drop a player here to take them out of the game. Only shown while dragging. */
function OutZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "out" });
  if (!active) return null;
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-16 items-center justify-center gap-2 rounded-md border-2 border-dashed text-sm font-bold ${
        isOver ? "border-destructive bg-destructive/10 text-destructive" : "border-muted-foreground/40 text-muted-foreground"
      }`}
    >
      <UserMinus className="h-5 w-5" /> Drop here to take out of the game
    </div>
  );
}

export default function BasketballCourtDisplay() {
  const [, params] = useRoute("/games/:id/display");
  const gameId = parseInt(params?.id ?? "0");
  useHeartbeat();
  const confirm = useConfirm();
  const { teamShortName, teamName } = useTeamSettings();
  const { data: game } = useGetGame(gameId, { query: { enabled: !!gameId, queryKey: getGetGameQueryKey(gameId) } });
  const { data: setup, isLoading: setupLoading } = useQuery({ queryKey: BASKETBALL_SETUP_KEY, queryFn: fetchBasketballSetup });
  const { data: gameLineup, isLoading: lineupLoading } = useQuery({
    queryKey: gameLineupKey(gameId),
    enabled: !!gameId,
    queryFn: () => fetchGameLineup(gameId),
  });
  const isLoading = setupLoading || lineupLoading;


  const [state, setStateRaw] = useState<LiveState | null>(() => (gameId ? loadState(gameId) : null));
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // Same feel as the baseball lineup grid: a mouse drag starts after 5px; on
  // touch, press and hold briefly so normal scrolling still works.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );
  const [editingClock, setEditingClock] = useState(false);
  // How far the clock buttons move it: 1 second, or bigger chunks.
  const [clockStep, setClockStep] = useState<1 | 10 | 60>(1);
  const [clockInput, setClockInput] = useState("");
  const [alertsOn, setAlertsOn] = useState(true);
  const audio = useRef<AudioContext | null>(null);

  const setState = useCallback(
    (next: LiveState | null) => {
      setStateRaw(next);
      saveState(gameId, next);
      if (next) syncGameStats(gameId, next);
    },
    [gameId],
  );

  // Until the game starts, the plan follows this game's lineup (game page →
  // Set Lineup), or the Bench Sheet if it doesn't have one.
  // Subs at a time comes from the game's lineup (or the team default). When
  // the team asks each game and this game has no lineup yet, send the coach
  // to Set Lineup first.
  const needsLineup = !!setup && gameLineup === null && setup.defaultSubSize === null;
  const pregame = useMemo(() => {
    if (!setup || gameLineup === undefined) return null;
    return startState(gameRotationInput(setup, gameLineup));
  }, [setup, gameLineup]);
  const base = state ?? pregame;
  const view = base ? settle(base, now) : null;

  // Tick twice a second while the clock runs; save progress every few seconds.
  useEffect(() => {
    if (!state?.runningSince) return;
    const tick = setInterval(() => setNow(Date.now()), 500);
    const persist = setInterval(() => saveState(gameId, settle(state, Date.now())), 5000);
    const sync = setInterval(() => syncGameStats(gameId, settle(state, Date.now())), SYNC_EVERY_MS);
    return () => {
      clearInterval(tick);
      clearInterval(persist);
      clearInterval(sync);
    };
  }, [state, gameId]);
  // When the clock hits zero (halftime / final), store the settled state.
  useEffect(() => {
    if (state && view && view.phase !== state.phase) setState(view);
  }, [state, view, setState]);

  // Players who stay on keep their spot on the court drawing.
  const previousSpots = useRef<Map<string, CourtSpot> | null>(null);
  const onCourtKey = view ? onCourt(view).map((g) => g.join(",")).join("|") : "";
  const spots = useMemo(() => {
    if (!view) return [];
    const next = courtSpots(view, previousSpots.current);
    previousSpots.current = new Map(next.filter((x) => x.spot !== null).map((x) => [x.id, x.spot as CourtSpot]));
    return next;
    // Only when who's on court changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCourtKey]);

  const nameOf = useCallback((id: string) => view?.players.find((p) => p.id === id)?.name ?? id, [view]);
  const sortNames = (ids: string[]) => ids.map(nameOf).sort((a, b) => a.localeCompare(b));

  const due = view ? subDue(view) : false;
  const upcoming = view ? nextSub(view) : { in: [], out: [] };
  // 1–2 at a time: say who goes in for whom. 3–5: lead with who comes out.
  const pairs = view ? nextSubPairs(view) : [];
  const paired = upcoming.in.length > 0 && upcoming.in.length <= 2;
  const subWhat = () =>
    paired ? (
      <span className="font-semibold">
        {pairs.map((p, i) => (
          <span key={p.in}>
            {i > 0 && <span className="mx-2 font-normal">·</span>}
            {nameOf(p.in)} <span className="font-normal">in for</span> {nameOf(p.out)}
          </span>
        ))}
      </span>
    ) : (
      <>
        <span className="font-semibold">Out: {joinNames(sortNames(upcoming.out))}</span>
        <span className="ml-2 text-sm opacity-80">(in: {joinNames(sortNames(upcoming.in))})</span>
      </>
    );
  const toNext = view ? secondsToNextSub(view) : null;
  const shift = view ? currentShift(view) : 0;
  const flex = view ? view.phase === "live" && isFlexShift(view, shift) : false;
  const headsUp = !due && toNext !== null && toNext <= HEADS_UP_SEC && view?.runningSince != null && upcoming.in.length > 0;

  // Alerts: a chime + vibration (and a system notification if the screen is
  // hidden) once when a sub comes due, and a softer one 30 seconds before.
  const alerted = useRef<string>("");
  useEffect(() => {
    if (!view || !alertsOn) return;
    const key = due ? `due:${view.half}:${shift}:${view.subsMade}` : headsUp ? `soon:${view.half}:${shift}` : "";
    if (!key || alerted.current === key) return;
    alerted.current = key;
    chime(audio.current, due);
    try {
      navigator.vibrate?.(due ? [300, 150, 300] : 150);
    } catch {
      // not supported
    }
    if (due && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      try {
        new Notification("Sub now", {
          body: paired
            ? pairs.map((p) => `${nameOf(p.in)} in for ${nameOf(p.out)}`).join("\n")
            : `Out: ${sortNames(upcoming.out).join(", ")}\nIn: ${sortNames(upcoming.in).join(", ")}`,
        });
      } catch {
        // some browsers only allow notifications from a service worker
      }
    }
  });

  const enableAlerts = async () => {
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
    } catch {
      audio.current = null;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // ignore
      }
    }
    setAlertsOn(true);
  };

  const act = (fn: (s: LiveState, t: number) => LiveState) => {
    if (!view) return;
    const t = Date.now();
    setNow(t);
    setState(fn(state ?? view, t));
    setSelected(null);
  };

  // Drop a player on another to swap them (bench ↔ court, or across groups),
  // or on the out-of-game area to take them out.
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over) return;
    const from = String(active.id).replace(/^player:/, "");
    if (over.id === "out") return act((s, t) => takeOut(s, t, from));
    const to = String(over.id).replace(/^player:/, "");
    if (to !== from) act((s, t) => swapPlayers(s, t, from, to));
  };

  const tapPlayer = (id: string) => {
    if (!selected) return setSelected(id);
    if (selected === id) return setSelected(null);
    act((s, t) => swapPlayers(s, t, selected, id));
  };

  if (isLoading || !view) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 p-6 text-center">
        {isLoading ? (
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
        ) : (
          <>
            <p className="font-semibold">Set up your rotation first.</p>
            <Link href="/bench-sheet" className="text-primary underline">Open the Bench Sheet</Link>
          </>
        )}
      </div>
    );
  }

  if (view.players.length === 0) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-semibold">Nobody is marked here for this game.</p>
        <Link href="/bench-sheet" className="text-primary underline">Set who's here on the Bench Sheet</Link>
      </div>
    );
  }

  const benchIds = bench(view);
  const onIds = new Set(onCourtIds(view));
  const roleOf = (id: string) => groupOf(view, id)?.short ?? "";
  const minutes = [...view.players]
    .filter((p) => view.playedSec[p.id] !== undefined)
    .sort((a, b) => (view.playedSec[b.id] ?? 0) - (view.playedSec[a.id] ?? 0) || a.name.localeCompare(b.name));
  const outPlayers = view.players.filter((p) => view.outIds.includes(p.id));
  const fewest = minutes.length ? Math.min(...minutes.filter((p) => !view.outIds.includes(p.id)).map((p) => view.playedSec[p.id] ?? 0)) : 0;
  const halfLabel = view.phase === "halftime" ? "Halftime" : view.phase === "final" ? "Final" : view.half === 1 ? "1st half" : "2nd half";

  const saveClock = () => {
    // "17:30", "17", or digits only like "1730" / "730".
    const text = clockInput.trim();
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(text) ?? /^(\d{1,2})(\d{2})$/.exec(text) ?? /^(\d{1,2})()$/.exec(text);
    if (m) act((s, t) => setClock(s, t, Number(m[1]) * 60 + Number(m[2] || 0)));
    setEditingClock(false);
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      {/* Header: exit, matchup, half, clock and clock controls */}
      <header
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 pb-2 md:px-5"
        style={{
          // The app runs full-screen on iPad/iPhone with a see-through status bar.
          paddingTop: "max(0.5rem, env(safe-area-inset-top))",
          paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
          paddingRight: "max(0.75rem, env(safe-area-inset-right))",
        }}
      >
        <div className="flex items-center gap-2">
          <Link href={`/games/${gameId}`}>
            <Button variant="ghost" size="sm" className="gap-1"><ArrowLeft className="h-4 w-4" /> Exit</Button>
          </Link>
          <div className="leading-tight">
            <div className="font-display text-lg font-bold uppercase">{teamShortName || teamName} {game?.opponent ? `vs ${game.opponent}` : ""}</div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{halfLabel}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={`Add ${clockStep === 60 ? "1 minute" : `${clockStep} second${clockStep === 1 ? "" : "s"}`} to the clock`}
            title="Add time to the clock (takes it off the players on the floor)"
            onClick={() => act((s, t) => nudgeClock(s, t, clockStep))}
            disabled={view.phase === "final"}
          >
            <Plus className="h-4 w-4" />
          </Button>
          {editingClock ? (
            <form onSubmit={(e) => { e.preventDefault(); saveClock(); }} className="flex items-center gap-1">
              <input
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                value={clockInput}
                onChange={(e) => setClockInput(e.target.value)}
                onBlur={saveClock}
                inputMode="numeric"
                aria-label="Set the clock (minutes:seconds)"
                className="w-28 rounded-md border bg-background px-2 py-1 text-center font-display text-4xl tabular-nums"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => { setClockInput(fmt(view.clockSec)); setEditingClock(true); }}
              title="Tap to set the clock"
              className="min-w-[7.5rem] rounded-md px-2 text-center font-display text-5xl font-bold tabular-nums"
            >
              {fmt(view.clockSec)}
            </button>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label={`Take ${clockStep === 60 ? "1 minute" : `${clockStep} second${clockStep === 1 ? "" : "s"}`} off the clock`}
            title="Run the clock down (counts as time played for the players on the floor)"
            onClick={() => act((s, t) => nudgeClock(s, t, -clockStep))}
            disabled={view.phase === "final"}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <div className="flex overflow-hidden rounded-md border text-xs font-bold" role="radiogroup" aria-label="Clock button step">
            {([1, 10, 60] as const).map((step) => (
              <button
                key={step}
                type="button"
                role="radio"
                aria-checked={clockStep === step}
                onClick={() => setClockStep(step)}
                className={`h-9 px-2 ${clockStep === step ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {step === 60 ? "1m" : `${step}s`}
              </button>
            ))}
          </div>
          {view.runningSince ? (
            <Button size="lg" variant="secondary" onClick={() => act(stopClock)} className="gap-2"><Pause className="h-5 w-5" /> Pause</Button>
          ) : view.phase === "final" ? null : (
            <Button
              size="lg"
              onClick={() => { void enableAlerts(); act(startClock); }}
              disabled={view.phase === "pregame" && needsLineup}
              title={view.phase === "pregame" && needsLineup ? "Set this game's lineup first" : undefined}
              className="gap-2"
            >
              <Play className="h-5 w-5" /> {view.phase === "pregame" ? "Start game" : view.phase === "halftime" ? "Start 2nd half" : "Resume"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={alertsOn ? "Turn sub alerts off" : "Turn sub alerts on"}
            onClick={() => (alertsOn ? setAlertsOn(false) : void enableAlerts())}
          >
            {alertsOn ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
          </Button>
        </div>
      </header>

      {view.phase === "pregame" && needsLineup && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-100 px-3 py-3 text-amber-950 md:px-5 dark:bg-amber-900/40 dark:text-amber-100">
          <span className="font-semibold">Set this game's lineup first: who's here and how many sub at a time.</span>
          <Link href={`/games/${gameId}`}><Button size="sm">Set Lineup</Button></Link>
        </div>
      )}

      {/* Sub banner */}
      {view.phase !== "final" && (
        <div
          role="status"
          aria-live="assertive"
          className={`flex flex-wrap items-center justify-between gap-3 px-3 py-3 md:px-5 ${
            due ? "animate-pulse bg-amber-400 text-black" : headsUp ? "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100" : "bg-muted/60"
          }`}
        >
          <div className="min-w-0 text-lg leading-snug">
            {due ? (
              <>
                <span className="mr-2 font-display text-2xl font-bold uppercase">Sub now</span>
                {subWhat()}
              </>
            ) : flex ? (
              <>
                <span className="mr-2 font-display text-xl font-bold uppercase">Flex</span>
                Coach's pick. Fewest minutes: {joinNames(minutes.filter((p) => !view.outIds.includes(p.id) && (view.playedSec[p.id] ?? 0) <= fewest + 1).map((p) => p.name))}
              </>
            ) : upcoming.in.length > 0 && toNext !== null ? (
              <>
                <span className="font-semibold">Next sub in {fmt(toNext)}</span>
                <span className="text-muted-foreground"> (at {fmt(view.clockSec - toNext)})</span>
                <span className="mx-2">·</span>
                {subWhat()}
              </>
            ) : view.phase === "halftime" ? (
              <span className="font-semibold">Halftime. Subs carry on in the 2nd half.</span>
            ) : (
              <span className="text-muted-foreground">No more planned subs this half.</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {due ? (
              <>
                <Button size="lg" onClick={() => act(makeSub)} className="bg-black text-white hover:bg-black/80">Sub made</Button>
                <Button size="lg" variant="outline" onClick={() => act(skipSub)} className="border-black/40 bg-transparent text-black hover:bg-black/10">Skip</Button>
              </>
            ) : (
              upcoming.in.length > 0 && view.phase !== "pregame" && (
                <Button variant="outline" onClick={() => act(makeSub)} className="gap-1"><ChevronsRight className="h-4 w-4" /> Sub now</Button>
              )
            )}
            <Button variant="outline" onClick={() => act(undoLast)} disabled={view.undo.length === 0} className="gap-1"><Undo2 className="h-4 w-4" /> Undo</Button>
          </div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => {
          setDragging(String(e.active.id).replace(/^player:/, ""));
          setSelected(null);
        }}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
      >
      <main className="grid flex-1 gap-4 p-3 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] md:p-5">
        {/* Court */}
        <section className="flex flex-col gap-2">
          <div className="mx-auto aspect-[500/470] w-full max-w-[640px]">
            <HalfCourt spots={spots} nameOf={nameOf} selected={selected} onTap={tapPlayer} />
          </div>
          {spots.some((s) => s.spot === null) && (
            <p className="text-center text-sm">Also on court: {joinNames(spots.filter((s) => s.spot === null).map((s) => nameOf(s.id)))}</p>
          )}
          <p className="text-center text-sm text-muted-foreground">
            {selected
              ? `Tap a player on the bench (or court) to swap with ${nameOf(selected)}.`
              : "Drag a bench player onto someone on the court to sub (or tap two players). The rotation carries on from the new lineup."}
          </p>
        </section>

        {/* Bench + playing time */}
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="mb-2 font-display text-xl font-bold uppercase">Bench</h2>
            {benchIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody on the bench.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
                {benchIds.map((id) => (
                  <BenchRow
                    key={id}
                    id={id}
                    name={nameOf(id)}
                    role={roleOf(id)}
                    comingIn={upcoming.in.includes(id)}
                    selected={selected === id}
                    onTap={tapPlayer}
                    onTakeOut={(pid) => act((s, t) => takeOut(s, t, pid))}
                  />
                ))}
              </ul>
            )}
            <div className="mt-2"><OutZone active={dragging !== null} /></div>
            {selected && onIds.has(selected) && (
              <Button variant="outline" size="sm" className="mt-2 gap-1" onClick={() => act((s, t) => takeOut(s, t, selected))}>
                <UserMinus className="h-4 w-4" /> Take {nameOf(selected)} out of the game
              </Button>
            )}
            {outPlayers.length > 0 && (
              <div className="mt-3">
                <div className="eyebrow mb-1 text-muted-foreground">Out of the game</div>
                <div className="flex flex-wrap gap-2">
                  {outPlayers.map((p) => (
                    <Button key={p.id} variant="outline" size="sm" className="gap-1" onClick={() => act((s, t) => putBack(s, t, p))}>
                      <UserPlus className="h-4 w-4" /> {p.name} back in
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-2 font-display text-xl font-bold uppercase">Playing time</h2>
            <table className="w-full text-base">
              <tbody>
                {minutes.map((p) => (
                  <tr key={p.id} className={`border-b last:border-0 ${view.outIds.includes(p.id) ? "opacity-50" : ""}`}>
                    <td className="py-1.5 pr-2">
                      <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${onIds.has(p.id) ? "bg-green-500" : "bg-muted-foreground/30"}`} aria-hidden="true" />
                      <span className="font-semibold">{p.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{(groupOf(view, p.id) ?? view.groups.find((g) => g.key === p.role))?.one ?? ""}{p.big ? " · Big" : ""}</span>
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{fmt(view.playedSec[p.id] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Counted from the game clock. Shift {Math.min(shift + 1, totalShifts(view))} of {totalShifts(view)}.
            </p>
          </div>

          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            <Link href="/bench-sheet"><Button variant="ghost" size="sm">Bench Sheet</Button></Link>
            {state && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={async () => {
                  if (await confirm({ title: "Reset this game?", description: "The clock, subs and playing time go back to the start, using the Bench Sheet's current setup.", confirmText: "Reset game", variant: "destructive" })) {
                    setState(null);
                    setSelected(null);
                    void fetch(`${BASE}/api/basketball-games/${gameId}/stats`, { method: "DELETE" }).catch(() => undefined);
                  }
                }}
              >
                <RotateCcw className="h-4 w-4" /> Reset game
              </Button>
            )}
          </div>
        </section>
      </main>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <span className="rounded-full border-2 border-primary bg-background px-3 py-1.5 text-lg font-bold shadow-lg">{nameOf(dragging)}</span>
        )}
      </DragOverlay>
      </DndContext>
    </div>
  );
}
