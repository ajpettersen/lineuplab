import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pause, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CourtSpot } from "@/lib/basketball-rotation";
import { fetchPlays, PLAYS_KEY, stepCount } from "@/lib/basketball-plays";
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
}: {
  open: boolean;
  onClose: () => void;
  namesBySpot: Partial<Record<CourtSpot, string>>;
  clockRunning: boolean;
  onPauseClock: () => void;
}) {
  const { data: plays = [], isLoading } = useQuery({ queryKey: PLAYS_KEY, queryFn: fetchPlays, enabled: open });
  const [playId, setPlayId] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const play = plays.find((p) => p.id === playId) ?? null;
  const steps = play ? stepCount(play.data) : 1;
  const hasSteps = !!play && play.data.actions.length > 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setStep((s) => Math.min(steps, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
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
              <PlayDiagram data={play.data} groupLayout={play.groupLayout} names={namesBySpot} uptoStep={hasSteps ? step : undefined} tokenScale={1.15} />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {hasSteps && (
              <div>
                <div className="mb-2 text-sm font-semibold text-muted-foreground">
                  {step === 0 ? "Set up" : `Step ${step} of ${steps}`}
                </div>
                <div className="flex gap-2">
                  <Button size="lg" variant="outline" className="flex-1 gap-1" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                    <ChevronLeft className="h-5 w-5" /> Back
                  </Button>
                  <Button size="lg" className="flex-1 gap-1" disabled={step >= steps} onClick={() => setStep((s) => Math.min(steps, s + 1))}>
                    Next <ChevronRight className="h-5 w-5" />
                  </Button>
                </div>
                <button type="button" className="mt-2 text-sm text-primary underline" onClick={() => setStep(steps)}>
                  Show the whole play
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
