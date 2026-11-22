// Live basketball game state for the court display (pages/basketball-court-display.tsx).
//
// Same rotation as the Bench Sheet (lib/basketball-rotation.ts): one circular
// queue per position group, and the on-court players are a window over each
// that moves forward on each sub. Following every sub reproduces the printed
// sheet exactly. Changes made on the fly stay inside that model, so the
// rotation keeps going from wherever the game actually is:
//   - swap two players  → they trade places in the queues
//   - take a player out → they leave the queue; the next in line fills in
//   - put them back     → they rejoin as the next player to go in
//   - jump ahead        → make the next sub now (it counts for the coming sub time)
//   - undo              → put the lineup back as it was before the last change
// Playing time is counted from the game clock while a player is on court,
// including when the clock is set by hand.
//
// Pure functions over plain JSON, so the state can live in localStorage and be
// tested with plain Node (test/basketball-live.test.ts).

import { rebalance, type RebalanceResult, type RebalanceRules } from "./basketball-rebalance.ts";
import {
  CUSTOM_GROUP,
  groupsFor,
  periodsOf,
  startingQueues,
  stickySpots,
  subSplit,
  type CourtSpot,
  type BasketballPlayer,
  type BasketballRole,
  type BasketballSettings,
  type PositionGroup,
  type RotationInput,
} from "./basketball-rotation.ts";

export type { CourtSpot } from "./basketball-rotation.ts";

export type LivePhase = "pregame" | "live" | "halftime" | "final";

interface Lineup {
  /** One queue per group (same order as `groups`), player ids. */
  queues: string[][];
  /** Where each queue's on-court window starts. */
  starts: number[];
  /** Subs made so far (planned or jumped ahead). */
  subsMade: number;
  /** Kept so Undo can step back over a Rebalance (which switches to a plan). */
  groups?: PositionGroup[];
  script?: string[][] | null;
}

export interface LiveState extends Lineup {
  version: 2;
  settings: BasketballSettings;
  groups: PositionGroup[];
  /** Roster snapshot taken at the start of the game (everyone who was here). */
  players: BasketballPlayer[];
  /** Players taken out of the game (injured, fouled out, left). */
  outIds: string[];
  phase: LivePhase;
  /** Current period (1–2 halves, or 1–4 quarters). "halftime" phase = a break between periods. */
  half: number;
  /** Game clock remaining in this half, in seconds, as of `runningSince`. */
  clockSec: number;
  /** Wall-clock ms when the clock was last started, or null while stopped. */
  runningSince: number | null;
  /** Seconds each player has been on court. */
  playedSec: Record<string, number>;
  /** Earlier lineups, newest last, for Undo. */
  undo: Lineup[];
  /** Who was on court when the game started (for the Starts stat). */
  starterIds?: string[];
  /**
   * The coach's own plan (per planned shift, ids at spots 1–5), when the game
   * has one. Then there is one group, its queue's first five are on court in
   * spot order, and each sub brings on the plan's next five.
   */
  script?: string[][] | null;
  /** Personal fouls this game, by player id. */
  fouls?: Record<string, number>;
  /** Our team fouls by half ("1", "2"); they reset each half. */
  teamFouls?: Record<string, number>;
  /** The other team's fouls by half (puts us in the bonus). */
  oppFouls?: Record<string, number>;
  score?: { us: number; them: number };
  /**
   * Every scoring change with who was on court for us, for plus/minus by
   * lineup. `at` is game seconds elapsed; a correction is a negative `pts`.
   */
  scoreLog?: ScoreEvent[];
  /** Our timeouts by half ("1", "2"). */
  timeouts?: Record<string, number>;
  /**
   * When each player's current stretch on court (or on the bench) began, in
   * game seconds, for the rebalance limits. Kept up to date by trackStints.
   */
  stints?: Record<string, { on: boolean; since: number }>;
  /** True after a change the plan didn't call for (offers Rebalance). */
  offPlan?: boolean;
}

export interface ScoreEvent {
  team: "us" | "them";
  pts: number;
  half: number;
  at: number;
  on: string[];
}

/** Fouls that put a player out of the game. */
export const FOUL_OUT = 5;

/**
 * Team fouls that put the other team in the bonus. Halves: one-and-one at 7,
 * two shots at 10. Quarters: two shots from the 5th foul each quarter.
 * Team fouls reset every period.
 */
export const BONUS_AT = 7;
export const DOUBLE_BONUS_AT = 10;
export const QUARTER_BONUS_AT = 5;

/**
 * Add (or with -1, take back) a personal foul; it counts as a team foul this
 * half. The fifth fouls the player out: they leave the game (the next one in
 * line covers) and the rest of the plan goes on without them. Taking the
 * fifth back brings them back.
 */
export function addFoul(s: LiveState, id: string, delta: 1 | -1 = 1, now = Date.now()): LiveState {
  const current = s.fouls?.[id] ?? 0;
  const next = Math.max(0, Math.min(FOUL_OUT, current + delta));
  if (next === current) return s;
  const half = String(s.half);
  let out: LiveState = {
    ...s,
    fouls: { ...(s.fouls ?? {}), [id]: next },
    teamFouls: { ...(s.teamFouls ?? {}), [half]: Math.max(0, (s.teamFouls?.[half] ?? 0) + (next - current)) },
  };
  if (next >= FOUL_OUT && !out.outIds.includes(id)) out = takeOut(out, now, id);
  if (current >= FOUL_OUT && next < FOUL_OUT && out.outIds.includes(id)) {
    const player = out.players.find((p) => p.id === id);
    if (player) out = putBack(out, now, player);
  }
  return out;
}

export function teamFoulsOf(s: LiveState, who: "us" | "them" = "us"): number {
  return (who === "us" ? s.teamFouls : s.oppFouls)?.[String(s.half)] ?? 0;
}

/** The other team's fouls (a tap per foul; −1 to correct). */
export function addOppFoul(s: LiveState, delta: 1 | -1 = 1): LiveState {
  const half = String(s.half);
  return { ...s, oppFouls: { ...(s.oppFouls ?? {}), [half]: Math.max(0, (s.oppFouls?.[half] ?? 0) + delta) } };
}

/** "Bonus" / "Double bonus" for whoever is shooting free throws off these fouls, or null. */
export function bonusLabel(teamFouls: number, periods = 2): string | null {
  if (periods === 4) return teamFouls >= QUARTER_BONUS_AT ? "Bonus" : null;
  return teamFouls >= DOUBLE_BONUS_AT ? "Double bonus" : teamFouls >= BONUS_AT ? "Bonus" : null;
}

/** 2 = halves, 4 = quarters. */
export function periodsIn(s: Pick<LiveState, "settings">): number {
  return periodsOf(s.settings);
}

/**
 * Note who just went on or off court (call after every change). Players
 * whose status didn't change keep their stretch.
 */
export function trackStints(next: LiveState): LiveState {
  const at = elapsedGameSec(next);
  const on = new Set(onCourtIds(next));
  const stints = { ...(next.stints ?? {}) };
  let changed = false;
  for (const p of next.players) {
    const isOn = on.has(p.id) && !next.outIds.includes(p.id);
    const cur = stints[p.id];
    if (!cur || cur.on !== isOn) {
      stints[p.id] = { on: isOn, since: at };
      changed = true;
    }
  }
  return changed ? { ...next, stints } : next;
}

/** Seconds into the current stretch on court / on the bench. */
export function stintSec(s: LiveState, id: string): number {
  const st = s.stints?.[id];
  return st ? Math.max(0, elapsedGameSec(s) - st.since) : 0;
}

/** Timeout: stop the clock and count it for this half. The clock stays stopped until Start/Resume. */
export function callTimeout(s: LiveState, now: number): LiveState {
  const stopped = stopClock(s, now);
  const half = String(stopped.half);
  return { ...stopped, timeouts: { ...(stopped.timeouts ?? {}), [half]: (stopped.timeouts?.[half] ?? 0) + 1 } };
}

export function timeoutsOf(s: LiveState): number {
  return s.timeouts?.[String(s.half)] ?? 0;
}

/** Game seconds elapsed (both halves). */
export function elapsedGameSec(s: LiveState): number {
  const period = s.settings.halfMinutes * 60;
  if (s.phase === "pregame") return 0;
  if (s.phase === "final") return period * periodsIn(s);
  if (s.phase === "halftime") return period * s.half;
  return (s.half - 1) * period + (period - s.clockSec);
}

/** Points for us or them (negative to correct), logged with who was on court. */
export function addPoints(s: LiveState, team: "us" | "them", pts: number, now = Date.now()): LiveState {
  const x = settle(s, now);
  const score = { us: x.score?.us ?? 0, them: x.score?.them ?? 0 };
  const nextScore = Math.max(0, score[team] + pts);
  const applied = nextScore - score[team];
  if (applied === 0) return s;
  return {
    ...x,
    score: { ...score, [team]: nextScore },
    scoreLog: [...(x.scoreLog ?? []), { team, pts: applied, half: x.half, at: Math.round(elapsedGameSec(x)), on: onCourtIds(x) }],
  };
}

export function foulsOf(s: LiveState, id: string): number {
  return s.fouls?.[id] ?? 0;
}

const EPS = 1e-6;

export function shiftLengths(settings: BasketballSettings): number[] {
  const full = Math.floor(settings.halfMinutes / settings.shiftMinutes + 1e-9);
  const rest = settings.halfMinutes - full * settings.shiftMinutes;
  const lengths = Array.from({ length: full }, () => settings.shiftMinutes * 60);
  if (rest > 1e-6) lengths.push(rest * 60);
  return lengths;
}

/** Start a game from the Bench Sheet / game lineup (same inputs as buildRotation). */
export function startState(input: RotationInput): LiveState {
  const start = startingQueues(input);
  const { present } = start;
  const absent = new Set(input.absentIds ?? []);
  const players = input.players.filter((p) => !absent.has(p.id));
  const script = input.customShifts?.length ? input.customShifts.map((shift) => [...shift]) : null;
  let groups = start.groups;
  let queues = start.queues.map((q) => q.map((p) => p.id));
  if (script) {
    const here = present.map((p) => p.id);
    const starters = (script[0] ?? []).filter((id) => here.includes(id)).slice(0, 5);
    groups = [CUSTOM_GROUP];
    queues = [[...starters, ...here.filter((id) => !starters.includes(id))]];
  }
  return {
    version: 2,
    settings: { ...input.settings },
    groups,
    script,
    players: players.map((p) => present.find((x) => x.id === p.id) ?? p),
    queues,
    starts: queues.map(() => 0),
    subsMade: 0,
    outIds: [],
    phase: "pregame",
    half: 1,
    clockSec: input.settings.halfMinutes * 60,
    runningSince: null,
    playedSec: Object.fromEntries(players.map((p) => [p.id, 0])),
    undo: [],
  };
}

/** How many of each group are on court (fewer if the group is short). */
export function spotsOf(s: Pick<LiveState, "groups" | "queues">): number[] {
  return s.groups.map((g, i) => Math.min(g.spots.length, s.queues[i]?.length ?? 0));
}

function windowOf(queue: string[], start: number, spots: number): string[] {
  if (queue.length <= spots) return [...queue];
  return Array.from({ length: spots }, (_, j) => queue[(((start + j) % queue.length) + queue.length) % queue.length]);
}

/** On court, by group (same order as `s.groups`). */
export function onCourt(s: LiveState): string[][] {
  const spots = spotsOf(s);
  return s.queues.map((q, i) => windowOf(q, s.starts[i], spots[i]));
}

/** Everyone on court. */
export function onCourtIds(s: LiveState): string[] {
  return onCourt(s).flat();
}

export function bench(s: LiveState): string[] {
  const on = new Set(onCourtIds(s));
  return s.queues.flat().filter((id) => !on.has(id));
}

/** The group a player is in for this game (after any fill-ins), or null if they're out. */
export function groupOf(s: LiveState, id: string): PositionGroup | null {
  const i = s.queues.findIndex((q) => q.includes(id));
  return i >= 0 ? s.groups[i] : null;
}

/** Count clock time up to `now`: run the clock down and credit on-court players. */
export function settle(s: LiveState, now: number): LiveState {
  if (s.runningSince === null || s.phase !== "live") return s;
  const elapsed = Math.max(0, Math.min((now - s.runningSince) / 1000, s.clockSec));
  const playedSec = { ...s.playedSec };
  for (const id of onCourtIds(s)) playedSec[id] = (playedSec[id] ?? 0) + elapsed;
  const clockSec = s.clockSec - elapsed;
  if (clockSec <= EPS) {
    return {
      ...s,
      playedSec,
      clockSec: 0,
      runningSince: null,
      phase: s.half < periodsIn(s) ? "halftime" : "final",
    };
  }
  return { ...s, playedSec, clockSec, runningSince: now };
}

export function startClock(s: LiveState, now: number): LiveState {
  if (s.phase === "final") return s;
  if (s.phase === "halftime") {
    return { ...s, phase: "live", half: s.half + 1, clockSec: s.settings.halfMinutes * 60, runningSince: now };
  }
  const starterIds = s.phase === "pregame" ? onCourtIds(s) : s.starterIds;
  return { ...s, phase: "live", runningSince: s.runningSince ?? now, starterIds };
}

export function stopClock(s: LiveState, now: number): LiveState {
  const settled = settle(s, now);
  return { ...settled, runningSince: null };
}

/**
 * Set the clock (seconds left in this half); keeps it running if it was.
 * Moving it is treated as game time passing (or being taken back) for the
 * players on the floor right now: winding it down credits them, adding time
 * back takes it off (never below zero).
 */
export function setClock(s: LiveState, now: number, clockSec: number): LiveState {
  const settled = settle(s, now);
  const max = s.settings.halfMinutes * 60;
  const value = Math.max(0, Math.min(max, clockSec));
  const passed = settled.clockSec - value;
  const playedSec = { ...settled.playedSec };
  for (const id of onCourtIds(settled)) playedSec[id] = Math.max(0, (playedSec[id] ?? 0) + passed);
  return { ...settled, clockSec: value, playedSec, runningSince: settled.runningSince === null ? null : now };
}

/** Move the clock by `deltaSec` (positive adds time back, negative runs it down). */
export function nudgeClock(s: LiveState, now: number, deltaSec: number): LiveState {
  return setClock(s, now, settle(s, now).clockSec + deltaSec);
}

/** Which shift of the game the clock is in (0-based, across both halves). */
export function currentShift(s: LiveState): number {
  const lengths = shiftLengths(s.settings);
  if (s.phase === "pregame") return 0;
  if (s.phase === "halftime") return lengths.length * s.half; // the next period's first shift is next
  let elapsed = s.settings.halfMinutes * 60 - s.clockSec;
  let index = 0;
  while (index < lengths.length - 1 && elapsed >= lengths[index] - EPS) {
    elapsed -= lengths[index];
    index++;
  }
  return (s.half - 1) * lengths.length + index;
}

export function totalShifts(s: LiveState): number {
  return shiftLengths(s.settings).length * periodsIn(s);
}

/** True from the first flex shift on: the coach picks, no planned subs. */
export function isFlexShift(s: LiveState, shift: number): boolean {
  return shift >= totalShifts(s) - Math.min(Math.floor(s.settings.flexShifts), totalShifts(s));
}

/**
 * With a coach's plan: the queue after the next sub. The plan's next five go
 * on at their spots; a planned player who isn't available is covered by the
 * bench player with the least time.
 */
function scriptedNext(s: LiveState): string[] {
  const script = s.script!;
  const queue = s.queues[0] ?? [];
  const now = queue.slice(0, 5);
  const target = script[Math.min(s.subsMade + 1, script.length - 1)] ?? now;
  const result: (string | null)[] = [null, null, null, null, null];
  target.slice(0, 5).forEach((id, k) => {
    if (queue.includes(id) && !result.includes(id)) result[k] = id;
  });
  const fill = queue
    .filter((id) => !result.includes(id))
    .sort((a, b) => {
      // Keep whoever is already on first (fewest changes), then least time.
      const onA = now.includes(a) ? 0 : 1;
      const onB = now.includes(b) ? 0 : 1;
      return onA - onB || (s.playedSec[a] ?? 0) - (s.playedSec[b] ?? 0);
    });
  for (let k = 0; k < 5 && k < queue.length; k++) if (result[k] === null) result[k] = fill.shift() ?? null;
  const five = result.filter((id): id is string => id !== null);
  return [...five, ...queue.filter((id) => !five.includes(id))];
}

/** Window starts after the next planned sub (`subSize` players, split as on the Bench Sheet). */
function advanced(s: LiveState): number[] {
  const spots = spotsOf(s);
  const split = subSplit(
    s.subsMade + 1,
    s.settings.subSize ?? 2,
    s.queues.map((q, i) => ({ queue: q.length, spots: spots[i] })),
  );
  return s.starts.map((start, i) => start + split[i]);
}

/**
 * The next planned sub as pairs: who goes in for whom. Pairs stay inside a
 * group (a guard for a guard, a center for a center); within a group, the one
 * who has been on longest is replaced by the one who has sat longest.
 */
export function nextSubPairs(s: LiveState): { in: string; out: string }[] {
  if (s.script) {
    // Who comes in takes the spot of whoever was there, when they're coming off.
    const before = (s.queues[0] ?? []).slice(0, 5);
    const after = scriptedNext(s).slice(0, 5);
    const ins = after.map((id, k) => ({ id, k })).filter((x) => !before.includes(x.id));
    const outs = before.filter((id) => !after.includes(id));
    const pairs: { in: string; out: string }[] = [];
    const left = [...ins];
    for (const x of ins) {
      if (outs.includes(before[x.k]) && !pairs.some((p) => p.out === before[x.k])) {
        pairs.push({ in: x.id, out: before[x.k] });
        left.splice(left.indexOf(x), 1);
      }
    }
    const freeOuts = outs.filter((id) => !pairs.some((p) => p.out === id));
    left.forEach((x, j) => freeOuts[j] && pairs.push({ in: x.id, out: freeOuts[j] }));
    return pairs;
  }
  const to = advanced(s);
  const spots = spotsOf(s);
  const pairs: { in: string; out: string }[] = [];
  s.queues.forEach((queue, i) => {
    if (queue.length <= spots[i]) return;
    const before = windowOf(queue, s.starts[i], spots[i]);
    const after = windowOf(queue, to[i], spots[i]);
    const out = before.filter((id) => !after.includes(id));
    const inn = after.filter((id) => !before.includes(id));
    out.forEach((id, j) => inn[j] && pairs.push({ in: inn[j], out: id }));
  });
  return pairs;
}

/** Change how many players sub at a time for the rest of the game. */
export function setSubSize(s: LiveState, subSize: number): LiveState {
  return { ...s, settings: { ...s.settings, subSize: Math.max(1, Math.min(5, Math.floor(subSize))) } };
}

/** Who the next planned sub brings in and takes out. */
export function nextSub(s: LiveState): { in: string[]; out: string[] } {
  const before = new Set(onCourtIds(s));
  const after = new Set(s.script ? scriptedNext(s).slice(0, 5) : onCourtIds({ ...s, starts: advanced(s) }));
  return { in: [...after].filter((id) => !before.has(id)), out: [...before].filter((id) => !after.has(id)) };
}

/**
 * Is a planned sub waiting? It is once the clock reaches a new shift that
 * hasn't had its sub yet (jumping ahead counts for the next one), and never
 * during flex shifts.
 */
export function subDue(s: LiveState): boolean {
  if (s.phase === "pregame" || s.phase === "final") return false;
  const shift = currentShift(s);
  if (isFlexShift(s, shift)) return false;
  return s.subsMade < shift && nextSub(s).in.length > 0;
}

/** Seconds of game clock until the next sub time in this half, or null if none is left. */
export function secondsToNextSub(s: LiveState): number | null {
  if (s.phase !== "live" && s.phase !== "pregame") return null;
  const lengths = shiftLengths(s.settings);
  const elapsed = s.settings.halfMinutes * 60 - s.clockSec;
  let boundary = 0;
  for (let i = 0; i < lengths.length - 1; i++) {
    boundary += lengths[i];
    const shift = (s.half - 1) * lengths.length + i + 1;
    if (boundary > elapsed + EPS) return isFlexShift(s, shift) ? null : boundary - elapsed;
  }
  return null;
}

function lineup(s: LiveState): Lineup {
  return { queues: s.queues, starts: s.starts, subsMade: s.subsMade, groups: s.groups, script: s.script ?? null };
}

function withUndo(s: LiveState, now: number, change: (s: LiveState) => LiveState): LiveState {
  const settled = settle(s, now);
  return { ...change(settled), undo: [...settled.undo, lineup(settled)].slice(-30) };
}

/** Make the next planned sub (when it's due, or early to jump ahead). */
export function makeSub(s: LiveState, now: number): LiveState {
  return withUndo(s, now, (x) =>
    x.script ? { ...x, queues: [scriptedNext(x)], starts: [0], subsMade: x.subsMade + 1 } : { ...x, starts: advanced(x), subsMade: x.subsMade + 1 },
  );
}

/** Skip a due sub without changing anyone (e.g. it's flex time or the coach wants to wait). */
export function skipSub(s: LiveState, now: number): LiveState {
  return withUndo(s, now, (x) => ({ ...x, subsMade: Math.max(x.subsMade + 1, currentShift(x)) }));
}

/** Trade two players' places (on court ↔ bench, or across groups). */
export function swapPlayers(s: LiveState, now: number, a: string, b: string): LiveState {
  if (a === b) return s;
  return withUndo({ ...s, offPlan: true }, now, (x) => {
    const queues = x.queues.map((q) => [...q]);
    const find = (id: string): [number, number] | null => {
      for (let i = 0; i < queues.length; i++) {
        const j = queues[i].indexOf(id);
        if (j >= 0) return [i, j];
      }
      return null;
    };
    const pa = find(a);
    const pb = find(b);
    if (!pa || !pb) return x;
    queues[pa[0]][pa[1]] = b;
    queues[pb[0]][pb[1]] = a;
    return { ...x, queues };
  });
}

function removeFrom(queue: string[], start: number, id: string): { queue: string[]; start: number } {
  const index = queue.indexOf(id);
  if (index < 0) return { queue, start };
  const next = queue.filter((x) => x !== id);
  // Players before the window move down one place; keep the window on the same people.
  let newStart = ((start % queue.length) + queue.length) % queue.length;
  if (index < newStart) newStart -= 1;
  return { queue: next, start: next.length ? newStart % next.length : 0 };
}

/** Take a player out of the game; the next player in line fills their spot. */
export function takeOut(s: LiveState, now: number, id: string): LiveState {
  return withUndo({ ...s, offPlan: true }, now, (x) => {
    if (x.script) {
      // Whoever has played least on the bench takes their spot.
      const queue = [...(x.queues[0] ?? [])];
      const at = queue.indexOf(id);
      if (at < 0) return x;
      const benchIds = queue.slice(5).filter((b) => b !== id);
      if (at < 5 && benchIds.length) {
        const sub = [...benchIds].sort((p, q) => (x.playedSec[p] ?? 0) - (x.playedSec[q] ?? 0))[0];
        queue[at] = sub;
        queue.splice(queue.indexOf(sub, 5), 1);
      } else {
        queue.splice(at, 1);
      }
      return { ...x, queues: [queue], starts: [0], outIds: [...new Set([...x.outIds, id])] };
    }
    const moved = x.queues.map((q, i) => removeFrom(q, x.starts[i], id));
    return {
      ...x,
      queues: moved.map((m) => m.queue),
      starts: moved.map((m) => m.start),
      outIds: [...new Set([...x.outIds, id])],
    };
  });
}

/** Bring a player back (or add a late arrival) into their group; they're next to go in. */
export function putBack(s: LiveState, now: number, player: BasketballPlayer, role?: BasketballRole): LiveState {
  return withUndo({ ...s, offPlan: true }, now, (x) => {
    const asRole = role ?? player.role;
    const players = x.players.some((p) => p.id === player.id) ? x.players : [...x.players, player];
    let gi = x.groups.findIndex((g) => g.key === asRole);
    if (gi < 0) gi = 0;
    const spots = spotsOf(x);
    const queues = x.queues.map((q) => [...q]);
    const starts = [...x.starts];
    const queue = queues[gi];
    if (!queue.includes(player.id)) {
      if (queue.length < x.groups[gi].spots.length || queue.length === 0) {
        queue.push(player.id);
      } else {
        // Right after the on-court window = the next one in.
        const start = ((starts[gi] % queue.length) + queue.length) % queue.length;
        queue.splice(start + Math.min(spots[gi], queue.length), 0, player.id);
        starts[gi] = start;
      }
    }
    return {
      ...x,
      players,
      queues,
      starts,
      outIds: x.outIds.filter((o) => o !== player.id),
      playedSec: { ...x.playedSec, [player.id]: x.playedSec[player.id] ?? 0 },
    };
  });
}

export function undoLast(s: LiveState, now: number): LiveState {
  if (s.undo.length === 0) return s;
  const settled = settle(s, now);
  const previous = settled.undo[settled.undo.length - 1];
  const inQueues = new Set(previous.queues.flat());
  return {
    ...settled,
    ...previous,
    outIds: settled.outIds.filter((id) => !inQueues.has(id)),
    undo: settled.undo.slice(0, -1),
  };
}

/** The on-court players at the 1–5 spots, keeping spots from `previous` where they can. */
export function courtSpots(s: LiveState, previous: Map<string, CourtSpot> | null = null): { spot: CourtSpot | null; id: string }[] {
  // The coach's plan says who plays where.
  if (s.script) return (s.queues[0] ?? []).slice(0, 5).map((id, k) => ({ spot: (k + 1) as CourtSpot, id }));
  const on = onCourt(s);
  return stickySpots(s.groups.map((g, i) => ({ ids: on[i], spots: g.spots })), s.players, previous);
}

// ── Rebalance rest of game ───────────────────────────────────────────────

/** Shift index where a rebalanced plan starts, and seconds left in the current one. */
function planStart(s: LiveState): { first: number; currentLeftSec: number } {
  const lengths = shiftLengths(s.settings);
  const all = Array.from({ length: periodsIn(s) }, () => lengths).flat();
  const cur = currentShift(s);
  if (s.phase === "halftime") return { first: cur, currentLeftSec: 0 };
  const end = all.slice(0, cur + 1).reduce((a, b) => a + b, 0);
  return { first: cur + 1, currentLeftSec: Math.max(0, end - elapsedGameSec(s)) };
}

/** The current five in spot order (spot 1 first). */
function fiveBySpot(s: LiveState): string[] {
  return courtSpots(s)
    .slice()
    .sort((a, b) => (a.spot ?? 9) - (b.spot ?? 9))
    .map((x) => x.id);
}

/**
 * Plan the rest of the game from where it is now. `targets` are this game's
 * minute targets (lib/basketball-targets.ts). Returns the plan for preview;
 * applyRebalance switches the game to it.
 */
export function planRebalance(
  s: LiveState,
  targets: Map<string, { targetSec: number }>,
  rules: RebalanceRules,
  nameOf: (id: string) => string = (id) => id,
): RebalanceResult & { firstShift: number } {
  const { first, currentLeftSec } = planStart(s);
  const lengths = shiftLengths(s.settings);
  const all = Array.from({ length: periodsIn(s) }, () => lengths).flat();
  const planned = all.map((len, i) => ({ len, i })).filter((x) => x.i >= first && !isFlexShift(s, x.i)).map((x) => x.len);
  const on = new Set(onCourtIds(s));
  const groups = s.script ? groupsFor(s.settings) : s.groups;
  const available = s.players.filter((p) => !s.outIds.includes(p.id));
  const result = rebalance(
    {
      players: available.map((p) => ({
        id: p.id,
        group: s.script ? p.role : groupOf(s, p.id)?.key ?? p.role,
        playedSec: s.playedSec[p.id] ?? 0,
        targetSec: targets.get(p.id)?.targetSec ?? 0,
        on: on.has(p.id) && s.phase !== "halftime" ? true : on.has(p.id),
        stintSec: stintSec(s, p.id),
      })),
      spotOrder: fiveBySpot(s),
      currentLeftSec,
      shifts: planned,
      groups,
      rules,
    },
    nameOf,
  );
  return { ...result, firstShift: first };
}

/** Switch the game to a rebalanced plan (Undo steps back to before it). */
export function applyRebalance(s: LiveState, now: number, plan: { shifts: string[][]; firstShift: number }): LiveState {
  return withUndo(s, now, (x) => {
    const five = fiveBySpot(x);
    const available = x.players.filter((p) => !x.outIds.includes(p.id)).map((p) => p.id);
    const script = [...Array.from({ length: plan.firstShift }, () => five), ...plan.shifts];
    return {
      ...x,
      groups: [CUSTOM_GROUP],
      script,
      queues: [[...five, ...available.filter((id) => !five.includes(id))]],
      starts: [0],
      subsMade: plan.firstShift - 1,
      offPlan: false,
    };
  });
}
