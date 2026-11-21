// Drawn basketball plays: data shapes and the geometry for drawing them.
// Coordinates are court units in a 500 × 470 half court with the basket at
// the bottom (the same drawing as the court display). Pure functions only,
// so they can be tested with plain Node (test/basketball-plays.test.ts).

import type { CourtSpot, GroupLayoutId } from "./basketball-rotation.ts";

export type PlayActionType = "cut" | "pass" | "dribble" | "screen";
export interface Point { x: number; y: number }
export interface PlayAction { type: PlayActionType; step: number; points: Point[] }
export interface PlayData {
  players: { spot: CourtSpot; x: number; y: number }[];
  ballSpot: CourtSpot | null;
  actions: PlayAction[];
}
export interface BasketballPlay {
  id: number;
  name: string;
  notes: string | null;
  groupLayout: GroupLayoutId;
  data: PlayData;
  sortOrder: number;
}

export const COURT_W = 500;
export const COURT_H = 470;

/** Where the 1–5 stand by default: the same spots as the court display. */
export const DEFAULT_SPOTS: Record<CourtSpot, Point> = {
  1: { x: 250, y: 95 },
  2: { x: 405, y: 165 },
  3: { x: 95, y: 165 },
  4: { x: 355, y: 300 },
  5: { x: 170, y: 330 },
};

export function blankPlay(): PlayData {
  return {
    players: ([1, 2, 3, 4, 5] as CourtSpot[]).map((spot) => ({ spot, ...DEFAULT_SPOTS[spot] })),
    ballSpot: 1,
    actions: [],
  };
}

export const ACTION_LABELS: Record<PlayActionType, string> = {
  cut: "Cut",
  pass: "Pass",
  dribble: "Dribble",
  screen: "Screen",
};

export const clampToCourt = (p: Point): Point => ({
  x: Math.max(0, Math.min(COURT_W, p.x)),
  y: Math.max(0, Math.min(COURT_H, p.y)),
});

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

/**
 * Thin a freehand stroke: drop points closer than `minGap` to the last kept
 * one, always keeping the first and last. A pass is always a straight line.
 */
export function simplifyStroke(points: Point[], type: PlayActionType, minGap = 10): Point[] {
  if (points.length < 2) return points;
  if (type === "pass") return [points[0], points[points.length - 1]];
  const kept = [points[0]];
  for (const p of points.slice(1, -1)) if (dist(p, kept[kept.length - 1]) >= minGap) kept.push(p);
  const last = points[points.length - 1];
  if (dist(last, kept[kept.length - 1]) < minGap / 2 && kept.length > 1) kept.pop();
  kept.push(last);
  return kept.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

/** Smooth SVG path through the points (quadratic curves through midpoints). */
export function smoothPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length < 3) return `M ${points[0].x} ${points[0].y} ` + points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    d += ` Q ${points[i].x} ${points[i].y} ${mid.x} ${mid.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** Points every `step` units along the polyline. */
function resample(points: Point[], step: number): Point[] {
  const out: Point[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = dist(a, b);
    let t = step - carry;
    while (t <= len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
      t += step;
    }
    carry = len - (t - step);
  }
  const last = points[points.length - 1];
  if (dist(out[out.length - 1], last) > 0.5) out.push(last);
  return out;
}

/**
 * A dribble: a zigzag along the stroke, ending in a short straight piece so
 * the arrowhead sits cleanly at the end.
 */
export function zigzagPath(points: Point[], amplitude = 6, wavelength = 14): string {
  if (points.length < 2 || pathLength(points) < wavelength) return smoothPath(points);
  const samples = resample(points, wavelength / 2);
  const tailStart = Math.max(1, samples.length - 2);
  let d = `M ${samples[0].x} ${samples[0].y}`;
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i];
    if (i >= tailStart) {
      d += ` L ${p.x} ${p.y}`;
      continue;
    }
    const prev = samples[i - 1];
    const len = dist(prev, p) || 1;
    const nx = -(p.y - prev.y) / len;
    const ny = (p.x - prev.x) / len;
    const side = i % 2 === 0 ? 1 : -1;
    d += ` L ${p.x + nx * amplitude * side} ${p.y + ny * amplitude * side}`;
  }
  return d;
}

/** The short bar across the end of a screen (perpendicular to the last segment). */
export function screenBar(points: Point[], half = 11): { a: Point; b: Point } | null {
  if (points.length < 2) return null;
  const end = points[points.length - 1];
  // Use a point a little way back for a steady direction.
  let back = points[points.length - 2];
  for (let i = points.length - 2; i >= 0; i--) {
    back = points[i];
    if (dist(back, end) >= 8) break;
  }
  const len = dist(back, end) || 1;
  const nx = -(end.y - back.y) / len;
  const ny = (end.x - back.x) / len;
  return { a: { x: end.x + nx * half, y: end.y + ny * half }, b: { x: end.x - nx * half, y: end.y - ny * half } };
}

/** Shortest distance from a point to a drawn line (its polyline). */
export function distanceToLine(p: Point, points: Point[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return dist(p, points[0]);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, dist(p, { x: a.x + t * dx, y: a.y + t * dy }));
  }
  return best;
}

/** Move a whole line by (dx, dy), kept on the court. */
export function moveLine(points: Point[], dx: number, dy: number): Point[] {
  const minX = Math.min(...points.map((q) => q.x));
  const maxX = Math.max(...points.map((q) => q.x));
  const minY = Math.min(...points.map((q) => q.y));
  const maxY = Math.max(...points.map((q) => q.y));
  const sx = Math.max(-minX, Math.min(COURT_W - maxX, dx));
  const sy = Math.max(-minY, Math.min(COURT_H - maxY, dy));
  return points.map((q) => ({ x: Math.round(q.x + sx), y: Math.round(q.y + sy) }));
}

/**
 * Move one end of a line to `to`. The rest of a curved line bends smoothly
 * toward the new end (points nearer that end move more), so the shape keeps
 * its feel instead of kinking.
 */
export function moveLineEnd(points: Point[], end: "start" | "end", to: Point): Point[] {
  if (points.length < 2) return points;
  const ordered = end === "end" ? points : [...points].reverse();
  const last = ordered[ordered.length - 1];
  const dx = to.x - last.x;
  const dy = to.y - last.y;
  const n = ordered.length - 1;
  const moved = ordered.map((q, i) => ({ x: Math.round(q.x + (dx * i) / n), y: Math.round(q.y + (dy * i) / n) }));
  return end === "end" ? moved : moved.reverse();
}

/** How many steps the play has. */
export function stepCount(data: PlayData): number {
  return Math.max(1, ...data.actions.map((a) => a.step));
}

// ── Playback: players move along their lines, the ball along passes ─────────

export type SpotPositions = Record<CourtSpot, Point>;

export interface StepMotion {
  step: number;
  /** Where everyone is when this step starts and ends. */
  from: SpotPositions;
  to: SpotPositions;
  /** Who moves, along which line (cuts, dribbles and screens). */
  moves: { spot: CourtSpot; points: Point[] }[];
  /** Passes in this step, as lines (the ball flies along them). */
  passes: Point[][];
  /** Who has the ball before and after the step (null = nobody / loose). */
  ballFrom: CourtSpot | null;
  ballTo: CourtSpot | null;
}

const MATCH_RADIUS = 36;

function nearestPlayer(p: Point, positions: SpotPositions, exclude: Set<CourtSpot>, radius: number): CourtSpot | null {
  let best: CourtSpot | null = null;
  let bestD = radius;
  for (const spot of [1, 2, 3, 4, 5] as CourtSpot[]) {
    const q = positions[spot];
    if (!q || exclude.has(spot)) continue;
    const d = dist(p, q);
    if (d < bestD) {
      bestD = d;
      best = spot;
    }
  }
  return best;
}

/**
 * Work out how the play moves, step by step. A cut, dribble or screen moves
 * the player it starts on (the line runs from them) to its end. A pass sends
 * the ball from the player it starts on to whoever is at its end once the
 * step's movement is done (or as close as possible).
 */
export function playTimeline(data: PlayData): StepMotion[] {
  let positions = Object.fromEntries(data.players.map((p) => [p.spot, { x: p.x, y: p.y }])) as SpotPositions;
  let holder: CourtSpot | null = data.ballSpot;
  const steps: StepMotion[] = [];
  for (let step = 1; step <= stepCount(data); step++) {
    const actions = data.actions.filter((a) => a.step === step);
    const moving = new Set<CourtSpot>();
    const moves: StepMotion["moves"] = [];
    for (const a of actions) {
      if (a.type === "pass") continue;
      const spot = nearestPlayer(a.points[0], positions, moving, MATCH_RADIUS);
      if (spot === null) continue;
      moving.add(spot);
      moves.push({ spot, points: [positions[spot], ...a.points.slice(1)] });
    }
    const to = { ...positions };
    for (const m of moves) to[m.spot] = m.points[m.points.length - 1];
    const passes = actions.filter((a) => a.type === "pass").map((a) => a.points);
    let ballTo = holder;
    for (const pass of passes) {
      const receiver = nearestPlayer(pass[pass.length - 1], to, new Set(), Infinity);
      ballTo = receiver;
    }
    steps.push({ step, from: positions, to, moves, passes, ballFrom: holder, ballTo });
    positions = to;
    holder = ballTo;
  }
  return steps;
}

/** The point a fraction `f` (0–1) of the way along a line, by distance. */
export function pointAlong(points: Point[], f: number): Point {
  if (points.length === 1 || f <= 0) return points[0];
  const total = pathLength(points);
  if (total === 0 || f >= 1) return points[points.length - 1];
  let left = total * f;
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i]);
    if (left <= seg) {
      const t = seg === 0 ? 0 : left / seg;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
    }
    left -= seg;
  }
  return points[points.length - 1];
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Everyone's position and the ball at fraction `t` (0–1) of a step. Players
 * move through the whole step; a pass flies in the second half, after the
 * cutters have started (so a cutter can catch it).
 */
export function frameAt(motion: StepMotion, t: number): { positions: SpotPositions; ball: Point | null } {
  const e = ease(Math.max(0, Math.min(1, t)));
  const positions = { ...motion.from };
  for (const m of motion.moves) positions[m.spot] = pointAlong(m.points, e);
  let ball: Point | null = null;
  if (motion.passes.length > 0 && t > 0.5) {
    const pass = motion.passes[motion.passes.length - 1];
    const f = Math.min(1, (t - 0.5) * 2);
    const receiver = motion.ballTo !== null ? positions[motion.ballTo] : pass[pass.length - 1];
    ball = f >= 1 ? receiver : { x: pass[0].x + (receiver.x - pass[0].x) * f, y: pass[0].y + (receiver.y - pass[0].y) * f };
    if (f >= 1 && motion.ballTo !== null) ball = null; // back in a player's hands
  }
  return { positions, ball };
}

/** Who holds the ball at fraction `t` of a step (null while it's in the air). */
export function holderAt(motion: StepMotion, t: number): CourtSpot | null {
  if (motion.passes.length === 0) return motion.ballFrom;
  if (t <= 0.5) return motion.ballFrom;
  return t >= 1 ? motion.ballTo : null;
}

// ── API ────────────────────────────────────────────────────────────────────

const BASE = (() => {
  try {
    return import.meta.env.BASE_URL.replace(/\/$/, "");
  } catch {
    return "";
  }
})();

export const PLAYS_KEY = ["basketball-plays"] as const;

export async function fetchPlays(): Promise<BasketballPlay[]> {
  const r = await fetch(`${BASE}/api/basketball-plays`);
  if (!r.ok) throw new Error(`GET /api/basketball-plays failed (${r.status})`);
  return (await r.json()) as BasketballPlay[];
}

export async function savePlay(play: Omit<BasketballPlay, "id" | "sortOrder"> & { id?: number }): Promise<BasketballPlay> {
  const r = await fetch(play.id ? `${BASE}/api/basketball-plays/${play.id}` : `${BASE}/api/basketball-plays`, {
    method: play.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: play.name, notes: play.notes, groupLayout: play.groupLayout, data: play.data }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Couldn't save the play (${r.status})`);
  }
  return (await r.json()) as BasketballPlay;
}

export async function deletePlay(id: number): Promise<void> {
  const r = await fetch(`${BASE}/api/basketball-plays/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`Couldn't delete the play (${r.status})`);
}
