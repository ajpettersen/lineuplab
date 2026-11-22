// "Rebalance rest of game" (court display): after subs the plan didn't call
// for (foul trouble, injury, a matchup), redo the remaining shifts so
// playing time evens out by the end, within the team's limits:
//   - nobody stays on longer than maxOnSec in a row
//   - nobody sits longer than maxBenchSec in a row
//   - everyone available gets at least their equal share minus minShareGapSec
//   - the position-group balance on court is kept (2 guards + 3 front, …)
//   - pairing rules: never-together groups and at-least-one-on-court groups
// Rules that can't all be met don't fail silently: they come back as warnings.
//
// Greedy, shift by shift: each shift takes the five who most need time
// (target minus projected minutes), after the players a limit forces on or
// off. The result is a plan the live engine follows (LiveState.script).
// Pure functions, tested in test/basketball-rebalance.test.ts.

import type { BasketballRole, CourtSpot, PositionGroup } from "./basketball-rotation.ts";

export interface RebalanceRules {
  maxOnSec: number;
  maxBenchSec: number;
  minShareGapSec: number;
  keepGroupBalance: boolean;
  neverTogether: string[][];
  atLeastOne: { label: string; ids: string[] }[];
}

export const DEFAULT_REBALANCE_RULES: RebalanceRules = {
  maxOnSec: 8 * 60,
  maxBenchSec: 6 * 60,
  minShareGapSec: 4 * 60,
  keepGroupBalance: true,
  neverTogether: [],
  atLeastOne: [],
};

export interface RebalancePlayer {
  id: string;
  /** Group key for this game (guard, front, …), or null if none. */
  group: BasketballRole | null;
  playedSec: number;
  targetSec: number;
  /** On court right now. */
  on: boolean;
  /** Seconds into their current stretch on court / on the bench. */
  stintSec: number;
}

export interface RebalanceInput {
  players: RebalancePlayer[];
  /** Current on-court five in spot order (index 0 = spot 1). */
  spotOrder: string[];
  /** Seconds left in the current shift (the current five play it out). */
  currentLeftSec: number;
  /** Lengths of the shifts still to plan, in order. */
  shifts: number[];
  groups: PositionGroup[];
  rules: RebalanceRules;
}

export interface RebalanceResult {
  /** Per planned shift, the five in spot order. */
  shifts: string[][];
  /** Projected minutes at the end, by player. */
  projectedSec: Map<string, number>;
  warnings: string[];
}

const ON_COURT = 5;

/** Does this five break a pairing rule? Returns the rule's description, or null. */
export function pairingProblem(five: string[], rules: Pick<RebalanceRules, "neverTogether" | "atLeastOne">, available: Set<string>, nameOf: (id: string) => string = (id) => id): string | null {
  for (const group of rules.neverTogether) {
    const together = group.filter((id) => five.includes(id));
    if (together.length >= 2) return `${together.map(nameOf).join(" and ")} are on court together (never-together rule)`;
  }
  for (const rule of rules.atLeastOne) {
    if (!rule.ids.some((id) => five.includes(id))) {
      const anyAvailable = rule.ids.some((id) => available.has(id));
      return anyAvailable ? `No ${rule.label} on court` : `No ${rule.label} available`;
    }
  }
  return null;
}

/**
 * Choose five from `pool` (best first), honoring forced players, group
 * balance and pairing rules where possible.
 */
export function chooseFive(
  ranked: string[],
  forced: string[],
  groupOf: (id: string) => BasketballRole | null,
  groupSlots: Map<BasketballRole, number> | null,
  rules: Pick<RebalanceRules, "neverTogether" | "atLeastOne">,
): string[] {
  const five: string[] = [];
  const conflicts = (id: string) => rules.neverTogether.some((g) => g.includes(id) && g.some((other) => other !== id && five.includes(other)));
  const used = new Map<BasketballRole, number>();
  const fits = (id: string) => {
    if (!groupSlots) return true;
    const g = groupOf(id);
    if (!g || !groupSlots.has(g)) return true;
    return (used.get(g) ?? 0) < groupSlots.get(g)!;
  };
  const add = (id: string) => {
    five.push(id);
    const g = groupOf(id);
    if (g) used.set(g, (used.get(g) ?? 0) + 1);
  };
  for (const id of forced) if (five.length < ON_COURT && !five.includes(id)) add(id);
  // At-least-one rules: make sure each has someone, taking the neediest.
  for (const rule of rules.atLeastOne) {
    if (five.some((id) => rule.ids.includes(id))) continue;
    const pick = ranked.find((id) => rule.ids.includes(id) && !five.includes(id) && !conflicts(id) && fits(id))
      ?? ranked.find((id) => rule.ids.includes(id) && !five.includes(id) && !conflicts(id));
    if (pick && five.length < ON_COURT) add(pick);
  }
  // Fill by need: group balance and never-together first, then relax.
  for (const strict of [true, false]) {
    for (const id of ranked) {
      if (five.length >= ON_COURT) break;
      if (five.includes(id) || conflicts(id)) continue;
      if (strict && !fits(id)) continue;
      add(id);
    }
  }
  // Last resort (not enough players without a conflict): fill anyway.
  for (const id of ranked) {
    if (five.length >= ON_COURT) break;
    if (!five.includes(id)) add(id);
  }
  return five;
}

/** Keep players who stay on in their spot; newcomers take the open spots (their group's first). */
export function placeInSpots(previous: string[], five: string[], groups: PositionGroup[], groupOf: (id: string) => BasketballRole | null): string[] {
  const out: (string | null)[] = [null, null, null, null, null];
  previous.forEach((id, i) => {
    if (i < ON_COURT && five.includes(id)) out[i] = id;
  });
  for (const id of five) {
    if (out.includes(id)) continue;
    const g = groups.find((x) => x.key === groupOf(id));
    const preferred = (g?.spots ?? []).map((spot: CourtSpot) => spot - 1).find((i) => out[i] === null);
    const index = preferred ?? out.findIndex((x) => x === null);
    if (index >= 0) out[index] = id;
  }
  return out.filter((x): x is string => x !== null);
}

export function rebalance(input: RebalanceInput, nameOf: (id: string) => string = (id) => id): RebalanceResult {
  const { rules } = input;
  const warnings: string[] = [];
  const byId = new Map(input.players.map((p) => [p.id, p]));
  const ids = input.players.map((p) => p.id);
  const available = new Set(ids);
  const groupOf = (id: string) => byId.get(id)?.group ?? null;
  const projected = new Map(input.players.map((p) => [p.id, p.playedSec + (p.on ? input.currentLeftSec : 0)]));
  // Stretch lengths at the start of the first planned shift.
  const stint = new Map(input.players.map((p) => [p.id, { on: p.on, sec: p.stintSec + input.currentLeftSec }]));
  const groupSlots = rules.keepGroupBalance && input.groups.length > 1
    ? new Map(input.groups.map((g) => [g.key, g.spots.length] as [BasketballRole, number]))
    : null;
  const totalLeft = input.shifts.reduce((a, b) => a + b, 0);
  const share = ids.length ? ((input.players.reduce((s, p) => s + p.playedSec, 0) + input.currentLeftSec * Math.min(ON_COURT, ids.length) + totalLeft * Math.min(ON_COURT, ids.length)) / ids.length) : 0;
  const minSec = Math.max(0, share - rules.minShareGapSec);

  let previous = input.spotOrder.filter((id) => available.has(id));
  const shifts: string[][] = [];
  input.shifts.forEach((length, k) => {
    const left = input.shifts.slice(k).reduce((a, b) => a + b, 0);
    // Need: behind target most first; players below the minimum come first of all.
    const need = (id: string) => {
      const p = byId.get(id)!;
      const proj = projected.get(id)!;
      const belowMin = proj < minSec ? (minSec - proj) * 3 : 0;
      return p.targetSec - proj + belowMin + (previous.includes(id) ? 1 : 0); // tiny nudge to keep continuity
    };
    const ranked = [...ids].sort((a, b) => need(b) - need(a));
    const mustSit = new Set(ids.filter((id) => stint.get(id)!.on && stint.get(id)!.sec + length > rules.maxOnSec));
    const mustPlay = ids.filter((id) => !stint.get(id)!.on && stint.get(id)!.sec + length > rules.maxBenchSec && !mustSit.has(id));
    const pool = ranked.filter((id) => !mustSit.has(id));
    // If resting everyone who hit the limit leaves fewer than five, the least-tired play on.
    const extra = [...mustSit].sort((a, b) => stint.get(a)!.sec - stint.get(b)!.sec);
    const forced = mustPlay.sort((a, b) => need(b) - need(a)).slice(0, ON_COURT);
    let five = chooseFive(pool.length >= Math.min(ON_COURT, ids.length) ? pool : [...pool, ...extra], forced, groupOf, groupSlots, rules);
    if (five.length < Math.min(ON_COURT, ids.length)) five = chooseFive([...pool, ...extra], forced, groupOf, groupSlots, rules);
    if (mustPlay.length > ON_COURT) warnings.push(`Shift ${k + 1}: more players have sat the limit than there are spots.`);
    if (five.some((id) => mustSit.has(id))) warnings.push(`Shift ${k + 1}: not enough rested players, so someone stays on past ${Math.round(rules.maxOnSec / 60)} min.`);
    const problem = pairingProblem(five, rules, available, nameOf);
    if (problem) warnings.push(`Shift ${k + 1}: ${problem}.`);
    if (groupSlots) {
      for (const [g, slots] of groupSlots) {
        const count = five.filter((id) => groupOf(id) === g).length;
        if (count < slots && ids.filter((id) => groupOf(id) === g).length >= slots) {
          const label = input.groups.find((x) => x.key === g)?.label ?? g;
          warnings.push(
            `Shift ${k + 1}: ${count === 0 ? "no" : `only ${count} of ${slots}`} ${label.toLowerCase()} on court; there aren't enough rested ${label.toLowerCase()} within your limits.`,
          );
        }
      }
    }
    const placed = placeInSpots(previous, five, input.groups, groupOf);
    shifts.push(placed);
    for (const id of ids) {
      const on = placed.includes(id);
      if (on) projected.set(id, projected.get(id)! + length);
      const st = stint.get(id)!;
      stint.set(id, st.on === on ? { on, sec: st.sec + length } : { on, sec: length });
    }
    previous = placed;
    void left;
  });

  const short = ids.filter((id) => projected.get(id)! + 1 < minSec);
  if (short.length) {
    warnings.push(`${short.map(nameOf).join(", ")} can't reach the minimum (${Math.round(minSec / 60)} min) in the time left.`);
  }
  return { shifts, projectedSec: projected, warnings: [...new Set(warnings)] };
}
