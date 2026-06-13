import React, { useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

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
  // When true, the number gets the championship-mode glow treatment
  // (animated text-shadow + brighter color). Pure visual; gestures
  // and accessibility are unchanged.
  championship?: boolean;
}

export function ScoreStepper({ value, onChange, ariaLabel, testId, label, championship }: ScoreStepperProps) {
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
        className="flex h-5 sm:h-6 items-center justify-center text-slate-500 hover:bg-slate-800/60 hover:text-accent active:text-accent transition-colors"
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
        className={`text-3xl sm:text-4xl lg:text-5xl font-bold tabular-nums text-accent font-['Roboto_Mono'] px-2 cursor-ns-resize touch-none text-center hover:bg-slate-800/60 focus:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-accent/60 leading-none ${
          championship ? "fd-champ-score" : ""
        }`}
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
