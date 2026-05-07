import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRoute, Link } from "wouter";
import {
  useGetGame,
  useGetGameLineup,
  useSaveLineup,
  useUpdateGame,
  getGetGameQueryKey,
  getGetGameLineupQueryKey,
  getGetSeasonStatsQueryKey,
  getGetPlayerStatsQueryKey,
  type LineupEntry,
  type Game,
  type UpdateGameBody,
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
import { shortenTeamName, formatOpponentForMatchup } from "@/lib/team-name";
import { useToast } from "@/hooks/use-toast";
import { bumpOfflineQueueCount, isPendingWriteKey } from "@/lib/offline-queue";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Maximize2, Moon, Play, RotateCcw, Sun, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

// Every position the field display knows how to lay out. The team's actual
// `activeFieldPositions` (from team_settings) is intersected with this list
// at render time, so a standard-9 team sees the classic LF/CF/RF outfield
// while a 10-player team sees LF/LCF/RCF/RF.
const ALL_FIELD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "CF", "RCF", "RF"] as const;
type FieldPos = (typeof ALL_FIELD_POSITIONS)[number];

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

// Team-name shortening lives in `@/lib/team-name` so the Dashboard hero
// card and recent-games lists share the exact same logic — coaches see
// "Edina vs Minnetonka" everywhere instead of one screen showing the
// full "Edina Green 10AA" and another showing the trimmed name.

/**
 * Diamond-shaped position layout for the dugout-fence iPad. Coordinates are
 * percentages of the field's bounding box so the SVG/CSS layout scales to
 * any screen size. Picked to match how a coach in the dugout naturally reads
 * the field: pitcher in the middle, catcher behind home, infielders form an
 * arc, outfielders along the back.
 */
const POSITION_LAYOUT: Record<FieldPos, { top: string; left: string }> = {
  CF: { top: "11%", left: "50%" },
  // 10-player split: LCF and RCF sit between LF/CF and CF/RF respectively,
  // a touch deeper than CF so the back of the outfield reads as a smooth arc.
  LCF: { top: "13%", left: "36%" },
  RCF: { top: "13%", left: "64%" },
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
const POSITION_ACCENT: Record<FieldPos, string> = {
  P: "bg-amber-400 text-slate-950",
  C: "bg-slate-100 text-slate-900",
  "1B": "bg-amber-300 text-slate-900",
  "2B": "bg-amber-300 text-slate-900",
  "3B": "bg-amber-300 text-slate-900",
  SS: "bg-amber-300 text-slate-900",
  LF: "bg-sky-300 text-slate-900",
  LCF: "bg-sky-300 text-slate-900",
  CF: "bg-sky-300 text-slate-900",
  RCF: "bg-sky-300 text-slate-900",
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
/** localStorage key for an offline-pending game patch (score, etc) waiting
 *  to PATCH. Same offline semantics as `pendingSaveKey` but for the game
 *  record rather than the lineup. */
const pendingGamePatchKey = (gameId: number) =>
  `fd-pending-game-patch-v1:${gameId}`;

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
    // If this write touched a pending-write key, let the global
    // SyncStatusChip update its counter immediately. Cheap; only a
    // handful of localStorage keys to scan.
    if (isPendingWriteKey(key)) bumpOfflineQueueCount();
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
    if (isPendingWriteKey(key)) bumpOfflineQueueCount();
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

/**
 * Manual scoreboard input until GameChanger integration lands.
 *
 * The dugout coach needs to enter runs WITHOUT looking away from the
 * field. So this control offers three input methods that all map to the
 * same +1 / -1 action — coach can use whichever matches their muscle
 * memory:
 *
 *   • Tap chevron-up / chevron-down — explicit, accessible, works for
 *     desktop mouse + keyboard users (parents checking from a phone too).
 *
 *   • Tap the number itself — defaults to +1 (the overwhelmingly common
 *     case when our team scores). One-finger one-second action.
 *
 *   • Swipe vertically on the number — drag up = +1, drag down = -1.
 *     The "push up or down on runs" gesture the user requested. The
 *     SWIPE_THRESHOLD (24px) is small enough that even a half-finger
 *     flick registers, but large enough that an accidental drift on a
 *     pure tap doesn't get misread as a swipe.
 *
 * Score is floored at 0 — youth baseball doesn't have negative scores
 * and a coach who fat-fingers down too many times shouldn't have to fight
 * the UI to get back to zero.
 *
 * `touch-action: none` on the number area is critical: without it iOS
 * Safari interprets a vertical swipe as a page scroll and steals the
 * gesture before our pointerup fires. With it, the swipe stays bound to
 * the score control. We also set `setPointerCapture` on pointerdown so
 * a swipe that drifts off the number's bounding box still resolves on
 * the original element rather than landing on a sibling button.
 *
 * For accessibility: role="spinbutton" + aria-valuenow/min so screen
 * readers announce the current score, and ArrowUp / ArrowDown / +/- key
 * bindings so keyboard users can step the value.
 */
interface ScoreStepperProps {
  value: number;
  onChange: (next: number) => void;
  ariaLabel: string;
  testId: string;
  // Tiny caps label rendered above the up-chevron — currently used to
  // mark the two steppers as "US" and "THEM" so kids glancing at the
  // dugout iPad don't mistake which column is theirs.
  label?: string;
}

function ScoreStepper({ value, onChange, ariaLabel, testId, label }: ScoreStepperProps) {
  // Y coord at gesture start; null when no gesture is in progress.
  const startYRef = useRef<number | null>(null);
  const SWIPE_THRESHOLD = 24;

  const inc = () => onChange(value + 1);
  const dec = () => onChange(Math.max(0, value - 1));

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    startYRef.current = e.clientY;
    // Bind subsequent pointer events to this element even if the finger
    // drifts off — keeps the swipe gesture coherent.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some older browsers throw if pointerId isn't recognized; harmless.
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const startY = startYRef.current;
    startYRef.current = null;
    if (startY == null) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) >= SWIPE_THRESHOLD) {
      // Swipe up = +1, swipe down = -1.
      if (dy < 0) inc();
      else dec();
    } else {
      // Pure tap (no significant vertical motion) defaults to +1, the
      // most common operation when the home team scores a run.
      inc();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp" || e.key === "+" || e.key === "=") {
      e.preventDefault();
      inc();
    } else if (e.key === "ArrowDown" || e.key === "-" || e.key === "_") {
      e.preventDefault();
      dec();
    }
  };

  return (
    <div
      // Uniform vertical rhythm: a single `gap-1` between the four
      // stacked elements (label → up-chevron → number → down-chevron)
      // so the column reads as evenly-spaced rows instead of a dense
      // top with a heavy number block dangling underneath. `justify-
      // center` centers the column within whatever flex height the
      // header lands on, keeping the labels visually in line with the
      // INNING caption + the team-vs-opponent title on the left rather
      // than stuck against the very top edge.
      className="flex flex-col items-stretch justify-center gap-1 select-none min-w-[3.25rem] sm:min-w-[4.25rem] lg:min-w-[5rem]"
      data-testid={testId}
    >
      {label && (
        <span
          // Sized to match the INNING caption in the center chip so
          // the three captions across the header (left title baseline,
          // INNING, score labels) read as siblings.
          className="text-[10px] sm:text-[11px] uppercase font-display font-semibold tracking-[0.2em] text-slate-400 text-center leading-none"
          aria-hidden="true"
        >
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={inc}
        className="flex h-5 sm:h-6 items-center justify-center text-slate-500 hover:bg-slate-800/60 hover:text-broadcast-gold active:text-broadcast-gold transition-colors"
        aria-label={`Increase ${ariaLabel}`}
        data-testid={`${testId}-up`}
      >
        <ChevronUp className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
      </button>
      <div
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={0}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          startYRef.current = null;
        }}
        className="text-3xl sm:text-4xl lg:text-5xl font-bold tabular-nums text-broadcast-gold font-['Roboto_Mono'] px-2 cursor-ns-resize touch-none text-center hover:bg-slate-800/60 focus:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-broadcast-gold/60 leading-none"
      >
        {value}
      </div>
      <button
        type="button"
        onClick={dec}
        className="flex h-5 sm:h-6 items-center justify-center text-slate-500 hover:bg-slate-800/60 hover:text-rose-300 active:text-rose-300 transition-colors"
        aria-label={`Decrease ${ariaLabel}`}
        data-testid={`${testId}-down`}
      >
        <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Tournament-aware running game clock for the field display header.
 *
 * Two states:
 *   • Not started (startedAt == null) — renders a "Start Game" button. The
 *     coach taps it on first pitch; we record `Date.now()` as an ISO string
 *     and PATCH the game via the same offline-aware single-flight save chain
 *     as score and lineup edits, so a tap during a WiFi drop is preserved
 *     and synced on reconnect (the optimistic cache update means the timer
 *     starts ticking on the iPad immediately, even offline).
 *   • Started — renders MM:SS (or H:MM:SS past the one-hour mark) using
 *     `tabular-nums` so the digits don't dance as they tick. A small ↻
 *     reset button next to the time clears `startedAt` (with a native
 *     confirm dialog — destructive enough to need an "are you sure" but
 *     simple enough to not need a full modal). Reset also rides the same
 *     PATCH chain.
 *
 * Sync semantics: because `startedAt` lives on the Game record, parents on
 * their phones see the SAME elapsed time as the dugout iPad (ticking via
 * their local clock once they receive the timestamp). Wall-clock skew
 * between devices is the only source of drift — acceptable for tournament
 * time-limit awareness.
 *
 * Implementation note: setInterval just triggers re-renders; the actual
 * elapsed always recomputes from `Date.now() - startMs`, so missed ticks
 * (tab backgrounded, system sleep) self-heal on the next render.
 */
interface GameTimerProps {
  startedAt: string | null | undefined;
  onStart: () => void;
  onReset: () => void;
}

function GameTimer({ startedAt, onStart, onReset }: GameTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    // Re-render once immediately so the display shows the right elapsed
    // value even if `now` was stale from before startedAt was set.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onStart}
        className="text-emerald-300 hover:text-emerald-200 hover:bg-slate-800 px-2 sm:px-3 gap-1 sm:gap-1.5 font-semibold"
        aria-label="Start game timer (capture first-pitch time)"
        data-testid="button-start-game"
      >
        <Play className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Start Game</span>
        <span className="sm:hidden">Start</span>
      </Button>
    );
  }

  const startMs = new Date(startedAt).getTime();
  // Clamp to 0 in case of clock skew (rare: device clock briefly behind
  // the server's `startedAt` write). Math.max prevents a "-:-1" flash.
  const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));
  const hours = Math.floor(elapsedSec / 3600);
  const minutes = Math.floor((elapsedSec % 3600) / 60);
  const seconds = elapsedSec % 60;
  const display =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${minutes}:${String(seconds).padStart(2, "0")}`;

  const handleReset = () => {
    if (typeof window !== "undefined" && window.confirm("Reset the game timer?")) {
      onReset();
    }
  };

  return (
    <div className="flex flex-col items-end gap-0 leading-none" data-testid="game-timer">
      <span className="text-[9px] sm:text-[10px] uppercase font-display font-semibold tracking-[0.25em] text-slate-400 leading-tight hidden sm:inline">
        Elapsed
      </span>
      <div className="flex items-center gap-1">
        <span
          className="text-lg sm:text-xl font-bold tabular-nums text-white font-['Roboto_Mono'] tracking-wider"
          aria-label={`Game time ${display}`}
          aria-live="off"
          data-testid="text-game-timer"
        >
          {display}
        </span>
        <button
          type="button"
          onClick={handleReset}
          className="p-1 text-slate-500 hover:text-rose-300 hover:bg-slate-800 rounded transition-colors"
          aria-label="Reset game timer"
          title="Reset timer"
          data-testid="button-reset-timer"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
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
  const { teamName, teamShortName, activeFieldPositions } = useTeamSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const saveLineup = useSaveLineup();
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
    flushSave();
    flushGameSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

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
            setHasUnsyncedLineup(false);
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
            setHasUnsyncedLineup(true);
            return;
          }
          // Real server error: drop pending, refetch authoritative state,
          // toast the coach. Same logic as before — don't snapshot-rollback
          // because that could clobber newer successful state.
          if (pendingLineupRef.current == null) {
            clearKey(pendingSaveKey(id));
            setHasUnsyncedLineup(false);
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
    setHasUnsyncedLineup(true);
    // flushSave is offline-aware: it'll skip the POST and just leave
    // pending in place if we're offline, then drain on reconnect.
    flushSave();
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
        if (typeof navigator !== "undefined" && !navigator.onLine) return;

        pendingGamePatchRef.current = null;
        try {
          await qc.cancelQueries({ queryKey });
          await updateGame.mutateAsync({ id, data: patch });
          if (pendingGamePatchRef.current == null) {
            clearKey(pendingGamePatchKey(id));
            setHasUnsyncedScore(false);
          }
          qc.invalidateQueries({ queryKey });
        } catch {
          if (typeof navigator !== "undefined" && !navigator.onLine) {
            // Offline-drop: restore pending only if no newer tap has
            // already replaced it (which would already be persisted).
            if (pendingGamePatchRef.current == null) {
              pendingGamePatchRef.current = patch;
              saveJSON(pendingGamePatchKey(id), patch);
            }
            setHasUnsyncedScore(true);
            return;
          }
          // Real server error — roll back to server truth, surface to coach.
          if (pendingGamePatchRef.current == null) {
            clearKey(pendingGamePatchKey(id));
            setHasUnsyncedScore(false);
          }
          qc.invalidateQueries({ queryKey });
          toast({
            title: "Couldn't save score",
            description: "Pulled the latest from the server. Try again.",
            variant: "destructive",
          });
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
    <div className="min-h-[100dvh] max-lg:landscape:h-[100dvh] lg:h-[100dvh] bg-black text-slate-100 flex flex-col select-none max-lg:landscape:overflow-hidden lg:overflow-hidden">
      {/* ── Header — broadcast lower-third (combined: team + inning + score + actions) ── */}
      <header className="flex items-center justify-between gap-3 px-3 sm:px-6 py-2 border-b-4 border-broadcast-gold bg-[#0f172a] shadow-[0_4px_20px_rgba(0,0,0,0.5)] shrink-0 relative z-10">
        {/* Left cluster: exit + team vs opponent */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <Link href={`/games/${id}`}>
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-white hover:bg-slate-800/60 px-2 sm:px-3"
              data-testid="button-exit-display"
            >
              <ArrowLeft className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Exit</span>
            </Button>
          </Link>
          {/* Team-vs-opponent title.
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
          <div className="min-w-0 flex-1">
            <div className="font-display uppercase tracking-wide text-base sm:text-xl lg:text-2xl font-bold leading-none flex items-baseline gap-2 sm:gap-3 min-w-0">
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
              <span className="text-broadcast-gold truncate" title={game?.opponent ?? undefined}>
                {formatOpponentForMatchup(game?.opponent, teamName) || game?.opponent || ""}
              </span>
            </div>
          </div>
        </div>

        {/* Center cluster: broadcast inning badge + compact controls */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0 bg-[#050d1a] border-l border-r border-[#1a2a42] px-2 sm:px-4 py-1">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setCurrentInning((i) => Math.max(1, i - 1))}
            disabled={currentInning <= 1}
            className="h-10 w-10 sm:h-11 sm:w-11 p-0 border-[#1a2a42] bg-[#0f172a] text-slate-100 hover:bg-slate-800 hover:text-broadcast-gold disabled:opacity-30 rounded-none"
            data-testid="button-prev-inning"
            aria-label="Previous inning"
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <div className="text-center min-w-[68px] sm:min-w-[96px] px-1">
            <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.25em] text-slate-400 leading-none font-display font-semibold">
              Inning
            </div>
            <div
              className="text-2xl sm:text-3xl font-bold tabular-nums leading-none mt-1 font-['Roboto_Mono'] text-broadcast-gold flex items-center justify-center gap-1"
              data-testid="text-current-inning"
            >
              <span aria-hidden="true" className="text-broadcast-gold text-base sm:text-lg leading-none">▲</span>
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
            className="h-10 w-10 sm:h-11 sm:w-11 p-0 border-[#1a2a42] bg-[#0f172a] text-slate-100 hover:bg-slate-800 hover:text-broadcast-gold disabled:opacity-30 rounded-none"
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
                <span>{justUpdated ? "Just updated" : "Live"}</span>
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
          <GameTimer
            startedAt={game?.startedAt ?? null}
            onStart={() =>
              saveGamePatchOptimistically({
                startedAt: new Date().toISOString(),
              })
            }
            onReset={() => saveGamePatchOptimistically({ startedAt: null })}
          />
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
          <div className="flex items-center gap-1 sm:gap-2">
            <ScoreStepper
              value={ourScore}
              onChange={(next) =>
                saveGamePatchOptimistically({ ourScore: next })
              }
              ariaLabel="Our score"
              testId="score-stepper-ours"
              label={teamShortName || teamName || "Us"}
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
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDimMode((d) => !d)}
            className={`px-2 ${
              dimMode
                ? "text-broadcast-gold hover:text-amber-200 hover:bg-slate-800/60"
                : "text-slate-500 hover:text-white hover:bg-slate-800/60"
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
            className="text-slate-500 hover:text-white hover:bg-slate-800/60 px-2"
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
      {/* Three responsive layouts:
       *  - Phone portrait (default): single column, page may scroll if the
       *    batting order has too many batters to fit under the field.
       *  - Phone landscape (`max-lg:landscape:`): split like iPad but with
       *    a narrower 180–240px sidebar so the field stays usable on the
       *    short side of a phone.
       *  - iPad/desktop (`lg:`): full split with a 320–400px sidebar.
       *
       *  IMPORTANT: phone-landscape rules are scoped with `max-lg:` so
       *  they cannot apply at iPad-landscape (1024x768). In this Tailwind
       *  4 build the `landscape:` media query happens to be emitted
       *  AFTER `lg:` in the compiled CSS, so an unscoped `landscape:`
       *  rule would win against `lg:` on iPad-landscape and shrink the
       *  iPad sidebar to phone-landscape width. */}
      <main className="flex-1 min-h-0 grid grid-cols-1 max-lg:landscape:grid-cols-[1fr_minmax(180px,240px)] max-lg:landscape:overflow-hidden lg:grid-cols-[1fr_minmax(320px,400px)] lg:overflow-hidden bg-black">
        {/* Field section: diagram fills the available height; bench strip pinned below */}
        <section
          className="flex flex-col p-3 sm:p-4 min-w-0 min-h-0 max-lg:landscape:overflow-hidden lg:overflow-hidden bg-[#03060a]"
          data-testid="section-field"
        >
          {/* Field min-height is generous in portrait (so the diagram is
           *  large enough to drag chips on) but drops to 0 in landscape and
           *  on lg, where the parent already constrains height to the
           *  viewport and the field is allowed to fill whatever's left. */}
          <div
            className="relative w-full flex-1 min-h-[320px] sm:min-h-[420px] max-lg:landscape:min-h-0 lg:min-h-0 border-2 border-[#1a2a42] overflow-hidden shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]"
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

        {/* Batting panel layout per viewport:
         *  - Phone portrait (default): a 2-column grid with a real per-row
         *    min-height so 12+ batters render legibly under the field.
         *    The page itself is allowed to scroll on portrait phones (root
         *    is min-h, not h), so a deep roster falls below the fold
         *    instead of crushing into unreadable strips.
         *  - Phone landscape AND iPad/desktop (`lg:`): the original
         *    equal-distribution flex column — 9 batters get tall rows, 18
         *    batters get short ones, and the list always fills the
         *    sidebar exactly without scrolling. `flex-1 basis-0` is left
         *    on the items unconditionally because it's a no-op on grid
         *    children. The "currently at bat" tracker was removed because
         *    there's no way to know what's actually happening on the
         *    field without GameChanger integration, and a stale at-bat
         *    indicator was worse than no indicator. */}
        <aside className="border-t max-lg:landscape:border-t-0 max-lg:landscape:border-l lg:border-t-0 lg:border-l border-[#1a2a42] bg-gradient-to-b from-[#0f172a] to-[#050d1a] flex flex-col min-w-0 min-h-0 max-lg:landscape:overflow-hidden lg:overflow-hidden shadow-[-10px_0_30px_rgba(0,0,0,0.5)] relative z-20">
          {/* Broadcast-graphic LINEUP header — Oswald uppercase with a gold
           *  underline to feel like a TV chyron */}
          <div className="shrink-0 bg-[#0f172a] border-b-2 border-broadcast-gold px-4 py-2 sm:py-3 text-center">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[0.3em] uppercase text-broadcast-gold leading-none">
              Lineup
            </h2>
          </div>
          {/* In landscape and lg/desktop the batting list MUST fit the
           *  panel without an internal scroll — the dugout iPad is
           *  strapped to a fence and a coach glancing at it shouldn't
           *  have to swipe to see the bottom of the order. We give the
           *  wrapper `flex flex-col overflow-hidden` and make the <ol>
           *  itself flex-1 + min-h-0 so it owns all leftover vertical
           *  space, then let each <li> grow via flex-1 basis-0 so 9
           *  batters get tall comfy rows and 18 batters get shorter
           *  rows that still read clearly (min-h-[2rem] floor keeps
           *  them tappable). On phone-portrait the panel uses a 2-col
           *  grid with fixed row heights, which can grow past the
           *  viewport — that's intentional, the page itself scrolls
           *  in that mode (root is min-h, not h). */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-2 sm:p-3">
          {battingOrder.length === 0 ? (
            <div className="text-slate-500 text-sm">No batting order yet.</div>
          ) : (
            <ol
              className="grid grid-cols-2 gap-1 max-lg:landscape:flex max-lg:landscape:flex-col max-lg:landscape:flex-1 max-lg:landscape:min-h-0 max-lg:landscape:gap-1 lg:flex lg:flex-col lg:flex-1 lg:min-h-0 lg:gap-1"
              data-testid="batting-order-list"
            >
              {battingOrder.map((r, idx) => {
                const slotLabel = r.order != null ? r.order : "—";
                // No "currently at bat" highlight — there's no way to
                // know real game state without a GameChanger-style
                // integration, and a fake/stale indicator (we used to
                // always highlight row 0) was worse than no indicator.
                // When real at-bat tracking lands, reintroduce an
                // `isAtBat` flag and gate gold styling + an AB pill on it.
                return (
                  <li
                    key={r.playerId}
                    className={`relative flex items-stretch h-12 sm:h-14 max-lg:landscape:h-auto max-lg:landscape:flex-1 max-lg:landscape:basis-0 max-lg:landscape:min-h-[2rem] lg:h-auto lg:flex-1 lg:basis-0 lg:min-h-[2rem] overflow-hidden border border-transparent transition-all ${
                      idx % 2 === 0
                        ? "bg-slate-900/60"
                        : "bg-slate-900/30"
                    }`}
                    data-testid={`batter-row-${r.playerId}`}
                  >
                    <span className="shrink-0 w-10 sm:w-12 flex items-center justify-center font-display font-bold text-lg sm:text-xl tabular-nums bg-white/5 text-slate-400">
                      {slotLabel}
                    </span>
                    <span className="flex-1 min-w-0 flex items-center px-2 sm:px-3 text-sm sm:text-base font-bold leading-tight truncate text-white">
                      {r.playerName}
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
              <div className="bg-broadcast-gold text-black font-bold font-['Roboto_Mono'] px-2 py-1 flex items-center justify-center text-xs uppercase tracking-wider min-w-[40px]">
                {activeDragInfo.position === "Bench" ? "BN" : activeDragInfo.position}
              </div>
              <div className="px-3 py-1 font-bold text-sm text-white whitespace-nowrap tracking-wide flex items-center">
                {activeDragInfo.name}
              </div>
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
      </DndContext>

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
  accent: _accent,
  name,
  entryId,
  isOver,
  isBeingDragged,
}: DraggableFieldChipProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `player-${entryId}`,
  });
  const hidden = isDragging || isBeingDragged;
  // Broadcast-graphic chip: hard-edged rectangle, gold position block
  // abutting a navy name block, hard shadow (no blur) for that TV
  // chyron feel. The `_accent` prop is kept in the signature to avoid
  // changing the parent contract — color is now sourced from the
  // broadcast palette globally.
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`relative flex items-stretch bg-[#0f172a] border border-[#1a2a42] shadow-[0_4px_0_rgba(0,0,0,0.7)] touch-none cursor-grab active:cursor-grabbing select-none transition-all overflow-hidden ${
        isOver ? "ring-2 ring-broadcast-gold" : ""
      } ${hidden ? "opacity-30" : ""}`}
      data-testid={`field-chip-${pos}`}
      title={`${name} — drag to swap with another player`}
    >
      <div className="bg-broadcast-gold text-black font-bold font-['Roboto_Mono'] px-1.5 sm:px-2 py-1 flex items-center justify-center text-[10px] sm:text-xs uppercase tracking-wider min-w-[34px] sm:min-w-[40px]">
        {pos}
      </div>
      <div className="px-2 sm:px-3 py-1 flex items-center min-w-[72px] sm:min-w-[96px] max-w-[140px] sm:max-w-[170px]">
        <div className="text-xs sm:text-sm font-bold leading-tight truncate text-white tracking-wide whitespace-nowrap">
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
      className={`relative flex items-stretch border border-dashed shadow-[0_4px_0_rgba(0,0,0,0.5)] transition-colors overflow-hidden ${
        isOver
          ? "bg-broadcast-gold/20 border-broadcast-gold"
          : "bg-[#0f172a]/70 border-white/15"
      }`}
      data-testid={`field-chip-${pos}-empty`}
    >
      <div
        className={`font-bold font-['Roboto_Mono'] px-1.5 sm:px-2 py-1 flex items-center justify-center text-[10px] sm:text-xs uppercase tracking-wider min-w-[34px] sm:min-w-[40px] ${
          isOver ? "bg-broadcast-gold text-black" : "bg-slate-800 text-slate-400"
        }`}
      >
        {pos}
      </div>
      <div className="px-2 sm:px-3 py-1 flex items-center min-w-[72px] sm:min-w-[96px] max-w-[140px] sm:max-w-[170px]">
        <div
          className={`text-xs sm:text-sm font-bold leading-tight truncate italic whitespace-nowrap ${
            isOver ? "text-broadcast-gold" : "text-slate-500"
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
      className={`mt-2 sm:mt-3 border bg-[#050d1a] px-3 sm:px-6 py-2 shrink-0 shadow-[0_4px_12px_rgba(0,0,0,0.45)] transition-colors ${
        isOver
          ? "border-broadcast-gold ring-2 ring-broadcast-gold/60 bg-amber-950/20"
          : "border-[#1a2a42]"
      }`}
      data-testid="bench-strip"
    >
      <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
        <span className="text-[10px] sm:text-xs uppercase tracking-[0.3em] text-slate-400 font-display font-bold">
          Bench
        </span>
        {entries.length === 0 ? (
          <span className="text-sm text-slate-500">
            {isOver ? "Drop here to bench" : "—"}
          </span>
        ) : (
          <div className="flex gap-2 sm:gap-3 flex-wrap">
            {entries.map((entry) => (
              <DraggableBenchChip
                key={entry.entryId}
                name={entry.name}
                entryId={entry.entryId}
                isBeingDragged={entry.entryId === activeDragEntryId}
              />
            ))}
          </div>
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
      className={`text-xs sm:text-sm font-bold text-slate-200 touch-none cursor-grab active:cursor-grabbing select-none px-2 sm:px-3 py-1 sm:py-1.5 bg-[#0f172a] border border-broadcast-gold/40 hover:border-broadcast-gold transition-all whitespace-nowrap tracking-wide ${
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
