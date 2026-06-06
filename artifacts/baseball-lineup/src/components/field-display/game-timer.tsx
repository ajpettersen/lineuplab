import { useEffect, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/lib/confirm";
import { useToast } from "@/hooks/use-toast";

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
  /**
   * Tournament-resolved time-limit rules (server pre-computed from the
   * parent tournament's pool vs bracket fields). Null = no enforcement;
   * the timer renders in its plain "elapsed only" mode.
   */
  effectiveTimeLimits?:
    | { noNewInningMinutes: number | null; hardStopMinutes: number | null }
    | null;
  /**
   * Pool vs bracket — used only for the small stage badge. Null hides it.
   */
  bracketStage?: "pool" | "bracket" | null;
  /**
   * Stable game id — used as the namespace for the per-game "already
   * warned" localStorage flags so the no-new-inning and hard-stop toasts
   * fire at most once per game (per device).
   */
  gameId?: number;
}

/**
 * Tournament time-limit warnings (May 2026).
 *
 * When the parent tournament has time-limit rules, the running timer
 * surfaces them in three escalating ways:
 *   1. Color: emerald → amber once past `noNewInningMinutes` → rose +
 *      pulsing in the final 60s before `hardStopMinutes` → solid rose
 *      after hard stop.
 *   2. Countdown pill: a second chip next to the elapsed counter shows
 *      "N min left" until hard stop. Hidden when no hard stop is set.
 *   3. Toasts: one-shot at the no-new-inning threshold ("No new inning
 *      after this one"), at T-1min ("1 minute remaining"), and at the
 *      hard stop ("Time expired").
 *
 * "One-shot" is enforced via localStorage keys
 *   `fd-time-warn-v1:<gameId>:<which>`
 * so toasts don't re-fire on every render or page reload. Reset of the
 * game timer (Start Game cleared) also clears these flags so the rules
 * apply afresh if the coach restarts the clock.
 *
 * The Field Display NEVER auto-finalizes the game — coach taps "End
 * Game" themselves. The timer is purely advisory.
 */
function fdTimeWarnKey(gameId: number | undefined, which: string): string | null {
  return gameId != null ? `fd-time-warn-v1:${gameId}:${which}` : null;
}

export function GameTimer({
  startedAt,
  onStart,
  onReset,
  effectiveTimeLimits = null,
  bracketStage = null,
  gameId,
}: GameTimerProps) {
  const [now, setNow] = useState(() => Date.now());
  // Hook MUST be called before the early-return below so React sees
  // the same hook order on every render (otherwise toggling startedAt
  // from null → set crashes with a hooks-order error).
  const confirm = useConfirm();
  const { toast } = useToast();

  const noNew = effectiveTimeLimits?.noNewInningMinutes ?? null;
  const hardStop = effectiveTimeLimits?.hardStopMinutes ?? null;
  const startMs = startedAt ? new Date(startedAt).getTime() : null;
  const elapsedSec =
    startMs != null ? Math.max(0, Math.floor((now - startMs) / 1000)) : 0;
  const elapsedMin = Math.floor(elapsedSec / 60);
  const hardStopSec = hardStop != null ? hardStop * 60 : null;
  const secLeftToHardStop =
    hardStopSec != null ? hardStopSec - elapsedSec : null;
  // Tighten the tick to 1s when we're in the final-minute pulse window
  // OR when no-new-inning / hard-stop boundaries are within striking
  // distance — otherwise stay on 15s to spare iPad battery.
  const inFinalMinute =
    secLeftToHardStop != null && secLeftToHardStop > 0 && secLeftToHardStop <= 60;
  const tickFast =
    startedAt != null &&
    effectiveTimeLimits != null &&
    (inFinalMinute || (secLeftToHardStop != null && secLeftToHardStop <= 65));

  useEffect(() => {
    if (!startedAt) return;
    // Re-render once immediately so the display shows the right elapsed
    // value even if `now` was stale from before startedAt was set.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), tickFast ? 1000 : 15000);
    return () => clearInterval(id);
  }, [startedAt, tickFast]);

  // One-shot toast warnings — fire on threshold cross, persist a flag in
  // localStorage so reloads / re-renders don't duplicate. Reduced-motion
  // is honored by the color pulse below, not here (toasts are silent).
  useEffect(() => {
    if (!startedAt || gameId == null) return;
    const tryFire = (
      which: string,
      condition: boolean,
      title: string,
      description?: string,
    ) => {
      if (!condition) return;
      const key = fdTimeWarnKey(gameId, which);
      if (!key) return;
      try {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, String(Date.now()));
      } catch {
        // Private mode or quota — fall through and at least fire once
        // this render cycle. We don't want a storage failure to silence
        // a time warning.
      }
      toast({ title, description });
    };
    if (noNew != null) {
      tryFire(
        "no-new",
        elapsedMin >= noNew,
        "No new inning after this one",
        `Tournament time-limit reached (${noNew} min).`,
      );
    }
    if (hardStopSec != null) {
      tryFire(
        "one-min",
        secLeftToHardStop != null && secLeftToHardStop <= 60 && secLeftToHardStop > 0,
        "1 minute remaining",
        "Hard stop coming up.",
      );
      tryFire(
        "hard-stop",
        secLeftToHardStop != null && secLeftToHardStop <= 0,
        "Time expired",
        "Hard stop reached. End the game when you're ready.",
      );
    }
  }, [startedAt, gameId, noNew, hardStopSec, elapsedMin, secLeftToHardStop, toast]);

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

  const hours = Math.floor(elapsedMin / 60);
  const minutes = elapsedMin % 60;
  const display = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  // Color state machine — drives both the elapsed numerals and the
  // countdown pill. Order matters (most severe wins).
  let state: "neutral" | "warn" | "final" | "expired" = "neutral";
  if (hardStopSec != null && secLeftToHardStop != null && secLeftToHardStop <= 0) {
    state = "expired";
  } else if (inFinalMinute) {
    state = "final";
  } else if (noNew != null && elapsedMin >= noNew) {
    state = "warn";
  }
  const elapsedColor =
    state === "expired"
      ? "text-rose-300"
      : state === "final"
        ? "text-rose-300 motion-safe:animate-pulse"
        : state === "warn"
          ? "text-amber-300"
          : "text-white";

  const handleReset = async () => {
    const ok = await confirm({
      title: "Reset the game timer?",
      description: "The elapsed clock will start over from zero.",
      confirmText: "Reset",
      variant: "destructive",
    });
    if (!ok) return;
    // Clear the one-shot warning flags too — coach is starting fresh.
    if (gameId != null) {
      for (const w of ["no-new", "one-min", "hard-stop"]) {
        try {
          const k = fdTimeWarnKey(gameId, w);
          if (k) localStorage.removeItem(k);
        } catch {
          /* ignore */
        }
      }
    }
    onReset();
  };

  // Countdown chip: only renders when hardStopSec is known. Format
  // mirrors the elapsed display — minutes once we're past 60s, "0:SS"
  // in the final minute so coaches see seconds tick during the pulse.
  let countdownLabel: string | null = null;
  if (hardStopSec != null && secLeftToHardStop != null) {
    if (secLeftToHardStop <= 0) {
      countdownLabel = "Time";
    } else if (secLeftToHardStop <= 60) {
      countdownLabel = `0:${String(secLeftToHardStop).padStart(2, "0")}`;
    } else {
      countdownLabel = `${Math.ceil(secLeftToHardStop / 60)}m left`;
    }
  }

  const stageLabel =
    bracketStage === "bracket" ? "BRACKET" : bracketStage === "pool" ? "POOL" : null;

  return (
    <div className="flex flex-col items-end gap-0 leading-none" data-testid="game-timer">
      <span className="text-[9px] sm:text-[10px] uppercase font-display font-semibold tracking-[0.25em] text-slate-400 leading-tight hidden sm:inline">
        {stageLabel ? `${stageLabel} · Elapsed` : "Elapsed"}
      </span>
      <div className="flex items-center gap-1">
        {countdownLabel != null && (
          <span
            className={`text-[10px] sm:text-xs font-display font-semibold tracking-wider px-1.5 py-0.5 rounded border ${
              state === "expired" || state === "final"
                ? "text-rose-200 border-rose-400/60 bg-rose-950/40 motion-safe:animate-pulse"
                : state === "warn"
                  ? "text-amber-200 border-amber-400/50 bg-amber-950/30"
                  : "text-slate-300 border-slate-600 bg-slate-900/60"
            }`}
            aria-label={`Hard stop ${countdownLabel}`}
            data-testid="text-time-limit-countdown"
          >
            {countdownLabel}
          </span>
        )}
        <span
          className={`text-lg sm:text-xl font-bold tabular-nums font-['Roboto_Mono'] tracking-wider transition-colors ${elapsedColor}`}
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
