import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface SprayEvent {
  id: number;
  gameId: number;
  result: string; // single | double | triple | home_run
  battedBallType: string; // ground_ball | line_drive | fly_ball
  direction: string; // P | C | 1B | 2B | 3B | SS | LF | CF | RF
}

export function useSprayChart(playerId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["spray-chart", playerId],
    queryFn: async (): Promise<SprayEvent[]> => {
      const r = await fetch(`${BASE}/api/batting/${playerId}/spray-chart`);
      if (!r.ok) throw new Error(`GET spray-chart failed (${r.status})`);
      const data = await r.json();
      return Array.isArray(data) ? (data as SprayEvent[]) : [];
    },
    enabled: enabled && playerId != null,
    staleTime: 30_000,
  });
}

// Fan angle (0-180, 0 = right field foul line, 90 = straight to center,
// 180 = left field foul line) and base depth (0 = home plate, 1 = fence)
// for each recorded direction. GameChanger only gives us "which fielder
// touched it," not real coordinates, so these are approximate zones —
// good enough to show a coach where a kid tends to hit the ball.
const DIRECTION_SPEC: Record<string, { angle: number; depth: number }> = {
  P: { angle: 90, depth: 0.16 },
  C: { angle: 90, depth: 0.04 },
  "1B": { angle: 22, depth: 0.26 },
  "2B": { angle: 58, depth: 0.32 },
  SS: { angle: 122, depth: 0.32 },
  "3B": { angle: 158, depth: 0.26 },
  LF: { angle: 150, depth: 0.88 },
  CF: { angle: 90, depth: 0.92 },
  RF: { angle: 30, depth: 0.88 },
};

const OUTFIELD_DIRS = new Set(["LF", "CF", "RF"]);

// Ground balls that reach an outfielder traveled through the infield on
// the ground and are typically shorter than a fly ball hit the same way;
// line drives split the difference.
const TYPE_DEPTH_FACTOR: Record<string, number> = {
  ground_ball: 0.72,
  line_drive: 0.88,
  fly_ball: 1.0,
};

const RESULT_COLOR: Record<string, string> = {
  single: "#3b82f6", // blue
  double: "#16a34a", // green
  triple: "#a855f7", // purple
  home_run: "#dc2626", // red
};

const RESULT_LABEL: Record<string, string> = {
  single: "1B",
  double: "2B",
  triple: "3B",
  home_run: "HR",
};

// Coarse left/center/right thirds, split along the same fan-angle scale
// as DIRECTION_SPEC (0-60 right, 60-120 center, 120-180 left). Grouping
// stays symmetric — three fielding directions per zone.
const ZONE_OF: Record<string, "left" | "center" | "right"> = {
  RF: "right", "1B": "right", "2B": "right",
  P: "center", C: "center", CF: "center",
  SS: "left", "3B": "left", LF: "left",
};

const ZONE_BOUNDS: Record<"right" | "center" | "left", [number, number]> = {
  right: [0, 60],
  center: [60, 120],
  left: [120, 180],
};

function zoneBreakdown(events: SprayEvent[], battedBallType: string) {
  const filtered = events.filter((e) => e.battedBallType === battedBallType && ZONE_OF[e.direction]);
  const counts = { left: 0, center: 0, right: 0 };
  for (const e of filtered) counts[ZONE_OF[e.direction]]++;
  const total = filtered.length;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return { total, left: pct(counts.left), center: pct(counts.center), right: pct(counts.right) };
}

/** Lighter green for a small share of hits, darker green as the share grows toward 100%. */
function zoneColor(pct: number): string {
  const lightness = 92 - Math.min(100, Math.max(0, pct)) * 0.55; // 92% (pale) -> 37% (deep green)
  return `hsl(142, 45%, ${lightness}%)`;
}

function ZoneField({ title, breakdown }: { title: string; breakdown: { total: number; left: number; center: number; right: number } }) {
  const size = 180;
  const cx = size / 2;
  const cy = size - 12;
  const maxR = size - 24;

  const wedgePath = (from: number, to: number) => {
    const p1 = polar(cx, cy, maxR, from, 1);
    const p2 = polar(cx, cy, maxR, to, 1);
    return `M ${cx} ${cy} L ${p1.x} ${p1.y} A ${maxR} ${maxR} 0 0 0 ${p2.x} ${p2.y} Z`;
  };

  const labelPos = (from: number, to: number) => polar(cx, cy, maxR, (from + to) / 2, 0.6);

  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {breakdown.total === 0 ? (
        <div className="flex items-center justify-center text-xs text-muted-foreground italic" style={{ width: size, height: size / 1.5 }}>
          No data yet
        </div>
      ) : (
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[180px]">
          {(["right", "center", "left"] as const).map((zone) => {
            const [from, to] = ZONE_BOUNDS[zone];
            const pct = breakdown[zone];
            const label = labelPos(from, to);
            return (
              <g key={zone}>
                <path
                  d={wedgePath(from, to)}
                  fill={zoneColor(pct)}
                  className="stroke-background"
                  strokeWidth={1.5}
                />
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor="middle"
                  className="fill-foreground font-semibold"
                  style={{ fontSize: 15 }}
                >
                  {pct}%
                </text>
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={2.5} className="fill-foreground" />
        </svg>
      )}
    </div>
  );
}

/** Small deterministic jitter so repeated same-direction hits don't stack exactly on top of each other. */
function jitter(seed: number): { dAngle: number; dDepth: number } {
  const a = Math.sin(seed * 12.9898) * 43758.5453;
  const b = Math.sin(seed * 78.233) * 12345.6789;
  const frac = (n: number) => n - Math.floor(n);
  return {
    dAngle: (frac(a) - 0.5) * 14, // +/- 7 degrees
    dDepth: (frac(b) - 0.5) * 0.08, // +/- 4% depth
  };
}

function polar(cx: number, cy: number, maxR: number, fanAngle: number, depth: number) {
  const plotAngle = ((45 + (fanAngle / 180) * 90) * Math.PI) / 180;
  const r = depth * maxR;
  return { x: cx + r * Math.cos(plotAngle), y: cy - r * Math.sin(plotAngle) };
}

export function SprayChart({ events }: { events: SprayEvent[] }) {
  const size = 300;
  const cx = size / 2;
  const cy = size - 20;
  const maxR = size - 40;

  const hits = events.filter((e) => DIRECTION_SPEC[e.direction]);

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-sm mx-auto">
        {/* Outfield grass */}
        <path
          d={`M ${cx} ${cy} L ${polar(cx, cy, maxR, 0, 1).x} ${polar(cx, cy, maxR, 0, 1).y} A ${maxR} ${maxR} 0 0 0 ${polar(cx, cy, maxR, 180, 1).x} ${polar(cx, cy, maxR, 180, 1).y} Z`}
          className="fill-green-100 dark:fill-green-950/40 stroke-green-300 dark:stroke-green-800"
          strokeWidth={1}
        />
        {/* Infield dirt diamond */}
        <path
          d={`M ${cx} ${cy} L ${polar(cx, cy, maxR, 0, 0.32).x} ${polar(cx, cy, maxR, 0, 0.32).y} L ${polar(cx, cy, maxR, 90, 0.42).x} ${polar(cx, cy, maxR, 90, 0.42).y} L ${polar(cx, cy, maxR, 180, 0.32).x} ${polar(cx, cy, maxR, 180, 0.32).y} Z`}
          className="fill-amber-100 dark:fill-amber-950/40 stroke-amber-300 dark:stroke-amber-800"
          strokeWidth={1}
        />
        {/* Foul lines */}
        <line x1={cx} y1={cy} x2={polar(cx, cy, maxR, 0, 1).x} y2={polar(cx, cy, maxR, 0, 1).y} className="stroke-muted-foreground/40" strokeWidth={1} />
        <line x1={cx} y1={cy} x2={polar(cx, cy, maxR, 180, 1).x} y2={polar(cx, cy, maxR, 180, 1).y} className="stroke-muted-foreground/40" strokeWidth={1} />
        {/* Home plate */}
        <circle cx={cx} cy={cy} r={3} className="fill-foreground" />

        {hits.map((e, i) => {
          const spec = DIRECTION_SPEC[e.direction];
          const j = jitter(e.id || i + 1);
          const typeFactor = OUTFIELD_DIRS.has(e.direction) ? (TYPE_DEPTH_FACTOR[e.battedBallType] ?? 1) : 1;
          const depth = Math.min(0.97, Math.max(0.03, spec.depth * typeFactor + j.dDepth));
          const angle = spec.angle + j.dAngle;
          const { x, y } = polar(cx, cy, maxR, angle, depth);
          const color = RESULT_COLOR[e.result] ?? "#64748b";
          return (
            <circle
              key={e.id ?? i}
              cx={x}
              cy={y}
              r={e.result === "home_run" ? 5 : 4}
              fill={color}
              fillOpacity={0.8}
              stroke="white"
              strokeWidth={0.75}
            >
              <title>{`${RESULT_LABEL[e.result] ?? e.result} — ${e.battedBallType.replace("_", " ")} to ${e.direction}`}</title>
            </circle>
          );
        })}
      </svg>
      {hits.length === 0 ? (
        <p className="text-sm text-muted-foreground italic text-center">No batted-ball data recorded yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
            {(["single", "double", "triple", "home_run"] as const).map((r) => (
              <span key={r} className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RESULT_COLOR[r] }} />
                {RESULT_LABEL[r]}
              </span>
            ))}
          </div>

          <div>
            <p className="text-xs text-muted-foreground text-center mb-1">
              Left / Center / Right split — darker = more of that batted-ball type
            </p>
            <div className="grid grid-cols-2 gap-2">
              <ZoneField title="Ground Balls" breakdown={zoneBreakdown(hits, "ground_ball")} />
              <ZoneField title="Fly Balls" breakdown={zoneBreakdown(hits, "fly_ball")} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
