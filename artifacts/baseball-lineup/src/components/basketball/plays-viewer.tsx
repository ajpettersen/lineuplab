import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CourtSpot } from "@/lib/basketball-rotation";
import { fetchPlays, frameAt, holderAt, playTimeline, PLAYS_KEY, stepCount } from "@/lib/basketball-plays";
import { PlayDiagram } from "@/components/basketball/court";

/**
 * Full-screen plays for a timeout (court display → Plays). Shows a play big,
 * with the names of whoever is at each spot right now, one step at a time.
 */
export function PlaysViewer({
  open,
  onClose,
  namesBySpot,
  clockRunning,
  onPauseClock,
  note = null,
}: {
  open: boolean;
  onClose: () => void;
  namesBySpot: Partial<Record<CourtSpot, string>>;
  clockRunning: boolean;
  onPauseClock: () => void;
  /** e.g. "Timeout 2 this half · clock stopped at 12:34". */
  note?: string | null;
}) {
  const { data: plays = [], isLoading } = useQuery({ queryKey: PLAYS_KEY, queryFn: fetchPlays, enabled: open });
  const [playId, setPlayId] = useState<number | null>(null);
  // `step` = how many steps have been played (0 = set up). While a step plays,
  // `anim` holds it and how far through it is (0–1).
  const [step, setStep] = useState(0);
  const [anim, setAnim] = useState<{ step: number; t: number } | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [slow, setSlow] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const play = plays.find((p) => p.id === playId) ?? null;
  const steps = play ? stepCount(play.data) : 1;
  const hasSteps = !!play && play.data.actions.length > 0;
  const timeline = useMemo(() => (play ? playTimeline(play.data) : []), [play]);
  const stepMs = slow ? 3600 : 1800;

  // Run the animation: advance t every frame; at the end of a step, rest there,
  // or go straight into the next step when playing the whole play.
  useEffect(() => {
    if (!anim) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setAnim((a) => {
        if (!a) return a;
        const t = a.t + dt / stepMs;
        if (t < 1) return { ...a, t };
        setStep(a.step);
        if (autoPlay && a.step < steps) return { step: a.step + 1, t: -0.25 }; // short pause between steps
        setAutoPlay(false);
        return null;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anim !== null, stepMs, autoPlay, steps]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = () => {
    setAnim(null);
    setAutoPlay(false);
  };
  const playStep = (n: number) => {
    setShowAll(false);
    setStep(n - 1);
    setAutoPlay(false);
    setAnim({ step: n, t: 0 });
  };
  const playAll = () => {
    setShowAll(false);
    setStep(0);
    setAutoPlay(true);
    setAnim({ step: 1, t: 0 });
  };

  // What to draw: moving players while a step plays; otherwise everyone where
  // the last step left them, with the next step's arrows showing what's coming.
  const view = (() => {
    if (!play || !hasSteps) return {};
    if (showAll) return { actionStyle: () => "normal" as const };
    if (anim) {
      const motion = timeline[anim.step - 1];
      const t = Math.max(0, anim.t);
      const frame = frameAt(motion, t);
      return {
        positions: frame.positions,
        ballPoint: frame.ball,
        ballHolder: holderAt(motion, t),
        actionStyle: (a: { step: number }) => (a.step === anim.step ? ("hot" as const) : ("hidden" as const)),
      };
    }
    const rest = step > 0 ? timeline[step - 1] : null;
    return {
      positions: rest?.to,
      ballHolder: rest ? rest.ballTo : play.data.ballSpot,
      actionStyle: (a: { step: number }) => (step >= steps ? ("faded" as const) : a.step === step + 1 ? ("normal" as const) : ("hidden" as const)),
    };
  })();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && !anim && step < steps) playStep(step + 1);
      if (e.key === "ArrowLeft") {
        stop();
        setStep((s) => Math.max(0, s - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, steps]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Plays"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 md:px-5">
        <div className="flex items-center gap-2">
          {play && (
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setPlayId(null)}>
              <ChevronLeft className="h-4 w-4" /> All plays
            </Button>
          )}
          <h2 className="font-display text-2xl font-bold uppercase">{play ? play.name : "Plays"}</h2>
          {note && <span className="hidden rounded-md bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-950 sm:inline dark:bg-amber-900/50 dark:text-amber-100">{note}</span>}
        </div>
        <div className="flex items-center gap-2">
          {clockRunning && (
            <Button variant="secondary" className="gap-1" onClick={onPauseClock}>
              <Pause className="h-4 w-4" /> Pause clock
            </Button>
          )}
          <Button variant="outline" className="gap-1" onClick={onClose}>
            <X className="h-4 w-4" /> Close
          </Button>
        </div>
      </div>

      {!play ? (
        <div className="flex-1 overflow-y-auto p-3 md:p-5">
          {isLoading ? (
            <p className="text-muted-foreground">Loading plays…</p>
          ) : plays.length === 0 ? (
            <p className="text-muted-foreground">No plays yet. Draw them in Settings → Plays.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {plays.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPlayId(p.id);
                      setStep(0);
                      stop();
                      setShowAll(false);
                    }}
                    className="w-full overflow-hidden rounded-md border text-left hover:border-primary"
                  >
                    <div className="aspect-[500/470] w-full">
                      <PlayDiagram data={p.data} groupLayout={p.groupLayout} />
                    </div>
                    <div className="truncate border-t px-2 py-2 text-lg font-bold">{p.name}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 p-3 md:grid-cols-[minmax(0,1fr)_18rem] md:p-5">
          <div className="flex min-h-0 items-center justify-center">
            <div className="aspect-[500/470] h-full max-h-full w-auto max-w-full">
              <PlayDiagram data={play.data} groupLayout={play.groupLayout} names={namesBySpot} tokenScale={1.15} {...view} />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {hasSteps && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-muted-foreground">
                  {anim ? `Step ${anim.step} of ${steps}…` : step === 0 ? "Set up" : step >= steps ? "Done" : `After step ${step} of ${steps}`}
                </div>
                <Button size="lg" className="w-full gap-2" onClick={anim && autoPlay ? stop : playAll}>
                  {anim && autoPlay ? <><Pause className="h-5 w-5" /> Stop</> : <><Play className="h-5 w-5" /> Play the whole play</>}
                </Button>
                <div className="flex gap-2">
                  <Button
                    size="lg"
                    variant="outline"
                    className="flex-1 gap-1"
                    disabled={step === 0 && !anim}
                    onClick={() => {
                      stop();
                      setShowAll(false);
                      setStep((s2) => Math.max(0, (anim ? anim.step - 1 : s2) - (anim ? 0 : 1)));
                    }}
                  >
                    <ChevronLeft className="h-5 w-5" /> Back
                  </Button>
                  <Button size="lg" variant="outline" className="flex-1 gap-1" disabled={!!anim || step >= steps} onClick={() => playStep(step + 1)}>
                    Next step <ChevronRight className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex overflow-hidden rounded-md border text-sm font-semibold" role="radiogroup" aria-label="Speed">
                    {[false, true].map((isSlow) => (
                      <button
                        key={String(isSlow)}
                        type="button"
                        role="radio"
                        aria-checked={slow === isSlow}
                        onClick={() => setSlow(isSlow)}
                        className={`px-3 py-1.5 ${slow === isSlow ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                      >
                        {isSlow ? "Slow" : "Normal"}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-sm text-primary underline"
                    onClick={() => {
                      stop();
                      setStep(0);
                      setShowAll(false);
                    }}
                  >
                    <RotateCcw className="h-4 w-4" /> Start over
                  </button>
                </div>
                <button
                  type="button"
                  className="text-sm text-primary underline"
                  onClick={() => {
                    stop();
                    setStep(0);
                    setShowAll((v) => !v);
                  }}
                >
                  {showAll ? "Hide the lines" : "Show every line at once"}
                </button>
              </div>
            )}
            {play.notes && <p className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-base">{play.notes}</p>}
            <p className="text-xs text-muted-foreground">Names show who is at each spot on the court right now.</p>
          </div>
        </div>
      )}
    </div>
  );
}
