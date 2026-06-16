import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Users,
  CalendarDays,
  Sparkles,
  MonitorPlay,
  BarChart3,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * In-app "Quick Tour" slideshow shown on the Help page.
 *
 * This intentionally replaces the old cross-artifact iframe (`/help-tour/`):
 * the `help-tour` video-js artifact is non-deployable, so the iframe was blank
 * in published builds. This component lives inside the deployable app, uses the
 * SAME real screenshots as the marketing landing page
 * (`public/feature-shots/<slug>.webp`), and themes to the active team colors —
 * so the tour always looks exactly like the app, in dev and in production.
 */

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

interface TourStep {
  image: string;
  title: string;
  body: string;
  icon: ComponentType<{ className?: string }>;
}

const STEPS: TourStep[] = [
  {
    image: "feature-shots/roster.webp",
    title: "Build your roster",
    body: "Add players by hand or bulk-import from a list or a screenshot. Set each player's preferred positions so lineups know where they fit.",
    icon: Users,
  },
  {
    image: "feature-shots/schedule.webp",
    title: "Schedule your season",
    body: "Add games with opponent, date, and location — or paste an iCal link to pull in a whole season at once.",
    icon: CalendarDays,
  },
  {
    image: "feature-shots/ai-lineups.webp",
    title: "Generate fair lineups",
    body: "Auto-build a fair rotation across positions and innings, or just describe what you want in plain English. Everything stays editable.",
    icon: Sparkles,
  },
  {
    image: "feature-shots/field-display.webp",
    title: "Run the game from the dugout",
    body: "Launch the iPad-optimized Field Display for the live lineup, fielding by inning, and scoreboard. It keeps working offline.",
    icon: MonitorPlay,
  },
  {
    image: "feature-shots/stats.webp",
    title: "Track stats & fairness",
    body: "See batting and pitching totals, the Rotation Report, and how even playing time has been across the whole season.",
    icon: BarChart3,
  },
];

const ADVANCE_MS = 6000;

export function QuickTour() {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = useCallback((next: number) => {
    setIndex((next + STEPS.length) % STEPS.length);
  }, []);

  useEffect(() => {
    if (paused) return;
    timerRef.current = setTimeout(() => {
      setIndex((i) => (i + 1) % STEPS.length);
    }, ADVANCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [index, paused]);

  const step = STEPS[index];
  const Icon = step.icon;

  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-testid="quick-tour"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-primary/15 via-primary/5 to-accent/15">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={reduceMotion ? false : { opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="absolute inset-0"
          >
            {!failed[index] ? (
              <img
                src={`${basePath}/${step.image}`}
                alt={step.title}
                className="h-full w-full object-cover object-top"
                onError={() =>
                  setFailed((f) => ({ ...f, [index]: true }))
                }
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Icon className="h-16 w-16 text-primary/30" />
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-16 sm:p-6 sm:pt-20">
              <div className="flex items-center gap-2 text-accent">
                <Icon className="h-4 w-4" />
                <span className="text-[11px] font-broadcast uppercase tracking-[0.18em]">
                  Step {index + 1} of {STEPS.length}
                </span>
              </div>
              <h3 className="mt-1 font-broadcast text-lg uppercase tracking-wide text-white sm:text-xl">
                {step.title}
              </h3>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-white/80 sm:text-sm">
                {step.body}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>

        <button
          type="button"
          onClick={() => go(index - 1)}
          aria-label="Previous step"
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white/90 backdrop-blur transition hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-accent"
          data-testid="quick-tour-prev"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => go(index + 1)}
          aria-label="Next step"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white/90 backdrop-blur transition hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-accent"
          data-testid="quick-tour-next"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center justify-center gap-2 py-3">
        {STEPS.map((s, i) => (
          <button
            key={s.image}
            type="button"
            onClick={() => go(i)}
            aria-label={`Go to step ${i + 1}: ${s.title}`}
            aria-current={i === index}
            className={`h-1.5 rounded-full transition-all ${
              i === index
                ? "w-6 bg-primary"
                : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
            data-testid={`quick-tour-dot-${i}`}
          />
        ))}
      </div>
    </div>
  );
}
