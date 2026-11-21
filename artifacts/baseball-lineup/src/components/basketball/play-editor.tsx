import { useRef, useState, type PointerEvent } from "react";
import { Loader2, Move, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GROUP_LAYOUT_IDS, GROUP_LAYOUTS, type CourtSpot, type GroupLayoutId } from "@/lib/basketball-rotation";
import {
  ACTION_LABELS,
  blankPlay,
  clampToCourt,
  pathLength,
  simplifyStroke,
  smoothPath,
  stepCount,
  zigzagPath,
  DEFAULT_SPOTS,
  type BasketballPlay,
  type PlayActionType,
  type PlayData,
  type Point,
} from "@/lib/basketball-plays";
import { CourtLines, PlayLayers } from "@/components/basketball/court";

type Tool = "move" | PlayActionType;

const TOOLS: { tool: Tool; label: string; hint: string }[] = [
  { tool: "move", label: "Move", hint: "Drag players to where they start" },
  { tool: "cut", label: "Cut", hint: "Solid arrow: a player cuts" },
  { tool: "dribble", label: "Dribble", hint: "Zigzag arrow: dribble" },
  { tool: "pass", label: "Pass", hint: "Dashed arrow: pass (drawn straight)" },
  { tool: "screen", label: "Screen", hint: "Line with a bar: set a screen" },
];

/** Small icon showing what each line looks like. */
function ToolIcon({ tool }: { tool: Tool }) {
  if (tool === "move") return <Move className="h-4 w-4" />;
  const pts: Point[] = [{ x: 2, y: 12 }, { x: 26, y: 12 }];
  return (
    <svg viewBox="0 0 30 24" className="h-4 w-7" aria-hidden="true">
      {tool === "screen" ? (
        <>
          <line x1="2" y1="12" x2="24" y2="12" stroke="currentColor" strokeWidth="2.5" />
          <line x1="24" y1="5" x2="24" y2="19" stroke="currentColor" strokeWidth="3" />
        </>
      ) : (
        <path
          d={tool === "dribble" ? zigzagPath(pts, 3, 6) : smoothPath(pts)}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray={tool === "pass" ? "4 3" : undefined}
        />
      )}
      {tool !== "screen" && <path d="M 22 7 L 28 12 L 22 17 z" fill="currentColor" />}
    </svg>
  );
}

export interface PlayDraft {
  id?: number;
  name: string;
  notes: string | null;
  groupLayout: GroupLayoutId;
  data: PlayData;
}

/**
 * Draw a play on a half court. Move the 1–5, then draw cuts, dribbles,
 * passes and screens with a finger or the mouse. Actions belong to the
 * current step, so the play can be shown one step at a time at a timeout.
 */
export function PlayEditor({
  initial,
  defaultLayout,
  saving,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: BasketballPlay | null;
  defaultLayout: GroupLayoutId;
  saving: boolean;
  onSave: (play: PlayDraft) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [groupLayout, setGroupLayout] = useState<GroupLayoutId>(initial?.groupLayout ?? defaultLayout);
  const [data, setData] = useState<PlayData>(() => initial?.data ?? blankPlay());
  const [tool, setTool] = useState<Tool>("cut");
  const [step, setStep] = useState<number>(() => stepCount(initial?.data ?? blankPlay()));
  const [stroke, setStroke] = useState<Point[] | null>(null);
  const [dragSpot, setDragSpot] = useState<CourtSpot | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const toCourt = (e: PointerEvent): Point => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return clampToCourt({ x: p.x, y: p.y });
  };

  const nearestSpot = (p: Point): CourtSpot | null => {
    let best: CourtSpot | null = null;
    let bestD = 34;
    for (const pl of data.players) {
      const d = Math.hypot(pl.x - p.x, pl.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = pl.spot;
      }
    }
    return best;
  };

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toCourt(e);
    if (tool === "move") {
      setDragSpot(nearestSpot(p));
      return;
    }
    // Start from the nearest player when the stroke begins on one.
    const spot = nearestSpot(p);
    const startAt = spot ? data.players.find((x) => x.spot === spot)! : p;
    setStroke([{ x: startAt.x, y: startAt.y }, p]);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (dragSpot === null && !stroke) return;
    const p = toCourt(e);
    if (dragSpot !== null) {
      setData((d) => ({ ...d, players: d.players.map((x) => (x.spot === dragSpot ? { ...x, x: Math.round(p.x), y: Math.round(p.y) } : x)) }));
    } else if (stroke) {
      const last = stroke[stroke.length - 1];
      if (Math.hypot(last.x - p.x, last.y - p.y) >= 3) setStroke([...stroke, p]);
    }
  };
  const onUp = () => {
    if (stroke && tool !== "move") {
      let points = simplifyStroke(stroke, tool);
      // Ending on a player: stop just short so the arrowhead / screen bar shows.
      const end = points[points.length - 1];
      const target = data.players.find((p) => Math.hypot(p.x - end.x, p.y - end.y) < 30);
      if (target && points.length >= 2) {
        const prev = points[points.length - 2];
        const len = Math.hypot(target.x - prev.x, target.y - prev.y) || 1;
        const back = Math.min(28, len - 4);
        points = [...points.slice(0, -1), { x: Math.round(target.x - ((target.x - prev.x) / len) * back), y: Math.round(target.y - ((target.y - prev.y) / len) * back) }];
      }
      if (pathLength(points) >= 18) {
        setData((d) => ({ ...d, actions: [...d.actions, { type: tool, step, points }] }));
      }
    }
    setStroke(null);
    setDragSpot(null);
  };

  const steps = stepCount(data);
  const thisStep = data.actions.filter((a) => a.step === step).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Drawing tool">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              role="radio"
              aria-checked={tool === t.tool}
              title={t.hint}
              onClick={() => setTool(t.tool)}
              className={`flex min-h-10 items-center gap-1.5 rounded-md border-2 px-3 text-sm font-semibold ${tool === t.tool ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
            >
              <ToolIcon tool={t.tool} /> {t.label}
            </button>
          ))}
        </div>
        <div className="mx-auto aspect-[500/470] w-full max-w-[620px] overflow-hidden rounded-md border">
          <svg
            ref={svgRef}
            viewBox="0 0 500 470"
            className="h-full w-full touch-none select-none"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            style={{ cursor: tool === "move" ? "grab" : "crosshair" }}
            role="img"
            aria-label="Draw the play"
          >
            <CourtLines />
            <PlayLayers data={data} groupLayout={groupLayout} uptoStep={step} showStepNumbers />
            {stroke && tool !== "move" && (
              <path
                d={tool === "dribble" ? zigzagPath(stroke) : tool === "pass" ? smoothPath([stroke[0], stroke[stroke.length - 1]]) : smoothPath(stroke)}
                fill="none"
                stroke="#b45309"
                strokeWidth="3"
                strokeDasharray={tool === "pass" ? "9 7" : undefined}
                opacity="0.8"
              />
            )}
          </svg>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {TOOLS.find((t) => t.tool === tool)?.hint}. Start a line on a player to draw from them.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="play-name">Play name</Label>
          <Input id="play-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Box Up, Horns, 5-Out Motion" />
        </div>

        <div className="space-y-1.5">
          <Label>Step</Label>
          <div className="flex flex-wrap items-center gap-2">
            {Array.from({ length: Math.max(steps, step) }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setStep(n)}
                className={`h-9 min-w-9 rounded-md border-2 px-2 text-sm font-bold ${step === n ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
              >
                {n}
              </button>
            ))}
            <Button type="button" variant="outline" size="sm" disabled={step > steps || step >= 10} onClick={() => setStep(Math.max(steps, step) + 1)}>
              + Next step
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Lines you draw go in step {step} ({thisStep} so far). Earlier steps show faded; later steps are hidden while you draw.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={data.actions.length === 0}
            onClick={() => setData((d) => ({ ...d, actions: d.actions.slice(0, -1) }))}
          >
            <Undo2 className="h-4 w-4" /> Undo line
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={thisStep === 0}
            onClick={() => setData((d) => ({ ...d, actions: d.actions.filter((a) => a.step !== step) }))}
          >
            <Trash2 className="h-4 w-4" /> Clear step {step}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setData((d) => ({ ...d, players: d.players.map((p) => ({ ...p, ...DEFAULT_SPOTS[p.spot] })) }))}
          >
            <RotateCcw className="h-4 w-4" /> Reset spots
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-semibold">
            Ball starts with
            <select
              value={data.ballSpot ?? ""}
              onChange={(e) => setData((d) => ({ ...d, ballSpot: e.target.value ? (Number(e.target.value) as CourtSpot) : null }))}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
            >
              <option value="">Nobody</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>The {n}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Position groups
            <select
              value={groupLayout}
              onChange={(e) => setGroupLayout(e.target.value as GroupLayoutId)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
            >
              {GROUP_LAYOUT_IDS.map((id) => <option key={id} value={id}>{GROUP_LAYOUTS[id].label}</option>)}
            </select>
          </label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="play-notes">Notes (optional)</Label>
          <Textarea
            id="play-notes"
            rows={3}
            maxLength={1000}
            value={notes ?? ""}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Coaching points for the timeout, e.g. 'Wait for the screen, then go.'"
          />
        </div>

        <div className="flex flex-wrap justify-between gap-2 pt-2">
          {onDelete ? (
            <Button type="button" variant="ghost" className="gap-1 text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" /> Delete play
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button
              type="button"
              disabled={saving || !name.trim()}
              onClick={() => onSave({ id: initial?.id, name: name.trim(), notes: notes?.trim() || null, groupLayout, data })}
              className="gap-2"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save play
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Lines: {Object.entries(ACTION_LABELS).map(([k, v]) => `${v} ${data.actions.filter((a) => a.type === k).length}`).join(" · ")}
        </p>
      </div>
    </div>
  );
}
