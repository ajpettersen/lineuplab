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

/** How many steps the play has. */
export function stepCount(data: PlayData): number {
  return Math.max(1, ...data.actions.map((a) => a.step));
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
