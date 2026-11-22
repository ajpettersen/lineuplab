// "Fix order for rules" (Set Lineup, Bench Sheet): the rotation follows each
// group's starting order, so the way to meet pairing rules is to find an
// order whose shifts never break them. A short local search: swap two
// players within a group, keep the change if it breaks fewer rules (or the
// same number with fewer moves from the coach's order). If no order meets
// every rule, the best one found comes back with how many breaks are left,
// so the planner can warn instead of breaking a rule silently.
// Tested in test/basketball-pairing.test.ts.

import { buildRotation, groupedQueues, type RotationInput } from "./basketball-rotation.ts";
import { hasPairingRules, violationCount } from "./basketball-pairing.ts";

function seeded(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** Rule breaks across the planned (non-flex) shifts for this order. */
export function orderViolations(input: RotationInput): number {
  if (!hasPairingRules(input.pairing)) return 0;
  const r = buildRotation(input);
  const absent = new Set(input.absentIds ?? []);
  const here = new Set(input.players.filter((p) => !absent.has(p.id)).map((p) => p.id));
  const fives = r.halves.flatMap((h) => h.rows).filter((row) => !row.flex).map((row) => row.groups.flatMap((g) => g.ids));
  return violationCount(fives, input.pairing!, here);
}

export function fixOrderForRules(input: RotationInput, tries = 800): { order: string[]; before: number; after: number } {
  const order = input.order ?? input.players.map((p) => p.id);
  const before = orderViolations({ ...input, order });
  if (before === 0 || !hasPairingRules(input.pairing)) return { order, before, after: before };
  const groups = groupedQueues(input.players, input.settings, order, input.absentIds ?? []).map((q) => q.players.map((p) => p.id));
  const flatten = (gs: string[][]) => {
    const flat = gs.flat();
    return [...flat, ...order.filter((id) => !flat.includes(id))];
  };
  const moves = (gs: string[][]) => gs.reduce((n, g, gi) => n + g.filter((id, i) => groups[gi][i] !== id).length, 0);
  const random = seeded(order.length * 7919 + before);
  let best = { gs: groups.map((g) => [...g]), v: before, m: 0 };
  let cur = best;
  for (let t = 0; t < tries && best.v > 0; t++) {
    const gi = Math.floor(random() * cur.gs.length);
    const g = cur.gs[gi];
    if (g.length < 2) continue;
    const a = Math.floor(random() * g.length);
    let b = Math.floor(random() * g.length);
    if (a === b) b = (b + 1) % g.length;
    const gs = cur.gs.map((x) => [...x]);
    [gs[gi][a], gs[gi][b]] = [gs[gi][b], gs[gi][a]];
    const v = orderViolations({ ...input, order: flatten(gs) });
    const m = moves(gs);
    // Accept better; sometimes accept equal to keep exploring.
    if (v < cur.v || (v === cur.v && random() < 0.3)) cur = { gs, v, m };
    if (v < best.v || (v === best.v && m < best.m)) best = { gs, v, m };
  }
  return { order: flatten(best.gs), before, after: best.v };
}
