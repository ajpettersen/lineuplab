import { useId, type ReactNode, type SVGProps } from "react";
import { groupsFor, type CourtSpot, type GroupLayoutId } from "@/lib/basketball-rotation";
import { screenBar, smoothPath, zigzagPath, type PlayAction, type PlayData } from "@/lib/basketball-plays";

/** Half-court lines (viewBox 0 0 500 470, basket at the bottom). */
export function CourtLines() {
  return (
    <>
      <rect x="2" y="2" width="496" height="466" rx="6" className="fill-amber-100 stroke-amber-900/60 dark:fill-amber-950/40 dark:stroke-amber-200/40" strokeWidth="3" />
      <g className="fill-none stroke-amber-900/60 dark:stroke-amber-200/40" strokeWidth="3">
        <rect x="190" y="280" width="120" height="188" />
        <circle cx="250" cy="280" r="60" />
        <path d="M 35 468 L 35 400 A 215 215 0 0 1 465 400 L 465 468" />
        <line x1="220" y1="430" x2="280" y2="430" />
        <circle cx="250" cy="415" r="11" />
        <circle cx="250" cy="2" r="60" />
      </g>
    </>
  );
}

const STROKE = "#0f172a";

/** One drawn action (cut / pass / dribble / screen). */
export function ActionPath({ action, markerId, faded, highlight }: { action: PlayAction; markerId: string; faded?: boolean; highlight?: boolean }) {
  const common: SVGProps<SVGPathElement> = {
    fill: "none",
    stroke: highlight ? "#b45309" : STROKE,
    strokeWidth: highlight ? 4 : 3,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    opacity: faded ? 0.3 : 1,
  };
  if (action.type === "screen") {
    const bar = screenBar(action.points);
    return (
      <g opacity={faded ? 0.3 : 1}>
        <path d={smoothPath(action.points)} {...common} opacity={1} />
        {bar && <line x1={bar.a.x} y1={bar.a.y} x2={bar.b.x} y2={bar.b.y} stroke={common.stroke} strokeWidth={5} strokeLinecap="round" />}
      </g>
    );
  }
  const d = action.type === "dribble" ? zigzagPath(action.points) : smoothPath(action.points);
  return <path d={d} {...common} strokeDasharray={action.type === "pass" ? "9 7" : undefined} markerEnd={`url(#${markerId})`} />;
}

/**
 * A play's layers: the actions (up to `uptoStep`, with that step highlighted
 * when stepping through) and the 1–5 tokens with their group initial and,
 * optionally, a player name under each.
 */
export function PlayLayers({
  data,
  groupLayout,
  names,
  uptoStep,
  showStepNumbers,
  tokenProps,
  tokenScale = 1,
  positions,
  ballHolder,
  ballPoint,
  actionStyle,
}: {
  data: PlayData;
  /** Override where players are drawn (playback). */
  positions?: Partial<Record<CourtSpot, { x: number; y: number }>>;
  /** Override who has the ball (playback); null = nobody. */
  ballHolder?: CourtSpot | null;
  /** The ball in the air (playback). */
  ballPoint?: { x: number; y: number } | null;
  /** Playback: how to draw each line; overrides `uptoStep`. */
  actionStyle?: (a: PlayAction) => "hidden" | "faded" | "normal" | "hot";
  groupLayout: GroupLayoutId;
  names?: Partial<Record<CourtSpot, string>>;
  uptoStep?: number;
  showStepNumbers?: boolean;
  tokenProps?: (spot: CourtSpot) => SVGProps<SVGGElement>;
  tokenScale?: number;
}) {
  const markerId = useId().replace(/:/g, "");
  const markerHot = `${markerId}-hot`;
  const groups = groupsFor({ groupLayout, guardSpots: 2, frontSpots: 3 });
  const short = (spot: CourtSpot) => groups.find((g) => g.spots.includes(spot))?.short ?? "";
  const styleOf = (a: PlayAction) =>
    actionStyle
      ? actionStyle(a)
      : uptoStep === undefined
        ? "normal"
        : a.step > uptoStep
          ? "hidden"
          : a.step === uptoStep && uptoStep > 0
            ? "hot"
            : a.step < uptoStep
              ? "faded"
              : "normal";
  const actions = data.actions.filter((a) => styleOf(a) !== "hidden");
  const holder = ballHolder === undefined ? data.ballSpot : ballHolder;
  return (
    <>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={STROKE} />
        </marker>
        <marker id={markerHot} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#b45309" />
        </marker>
      </defs>
      {actions.map((a, i) => {
        const style = styleOf(a);
        const hot = style === "hot";
        return <ActionPath key={i} action={a} markerId={hot ? markerHot : markerId} faded={style === "faded"} highlight={hot} />;
      })}
      {showStepNumbers &&
        actions.map((a, i) => (
          <g key={`n${i}`} transform={`translate(${midOf(a.points).x} ${midOf(a.points).y - 12})`}>
            <circle r="9" fill="#fff" stroke={STROKE} strokeWidth="1.5" />
            <text textAnchor="middle" dy="0.35em" fontSize="11" fontWeight="700" fill={STROKE}>{a.step}</text>
          </g>
        ))}
      {data.players.map((base) => {
        const p = { ...base, ...(positions?.[base.spot] ?? {}) };
        const name = names?.[p.spot];
        const r = 22 * tokenScale;
        return (
          <g key={p.spot} transform={`translate(${p.x} ${p.y})`} {...tokenProps?.(p.spot)}>
            <circle r={r} className="fill-primary stroke-background" strokeWidth={3} />
            <text textAnchor="middle" dy="0.1em" className="fill-primary-foreground" style={{ font: `700 ${18 * tokenScale}px var(--font-display, sans-serif)` }}>
              {p.spot}
            </text>
            <text textAnchor="middle" dy={`${1.3}em`} className="fill-primary-foreground" style={{ font: `600 ${9 * tokenScale}px sans-serif`, opacity: 0.85 }}>
              {short(p.spot)}
            </text>
            {holder === p.spot && <circle cx={r * 0.8} cy={-r * 0.8} r={7 * tokenScale} fill="#f97316" stroke="#7c2d12" strokeWidth={1.5} />}
            {name && (
              <>
                <rect x={-55} y={r + 3} width={110} height={22} rx={6} className="fill-background/95 stroke-border" strokeWidth={1.5} />
                <text textAnchor="middle" y={r + 19} className="fill-foreground" style={{ font: "700 14px sans-serif" }}>
                  {name.length > 12 ? `${name.slice(0, 11)}…` : name}
                </text>
              </>
            )}
          </g>
        );
      })}
      {ballPoint && <circle cx={ballPoint.x} cy={ballPoint.y} r={8 * tokenScale} fill="#f97316" stroke="#7c2d12" strokeWidth={1.5} />}
    </>
  );
}

/** The middle of a line (for its step number). */
function midOf(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length === 2) return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  return points[Math.floor(points.length / 2)];
}

/** A complete, read-only play diagram. */
export function PlayDiagram(props: Parameters<typeof PlayLayers>[0] & { className?: string; children?: ReactNode }) {
  const { className, children, ...rest } = props;
  return (
    <svg viewBox="0 0 500 470" className={className ?? "h-full w-full"} role="img" aria-label="Play diagram">
      <CourtLines />
      <PlayLayers {...rest} />
      {children}
    </svg>
  );
}
