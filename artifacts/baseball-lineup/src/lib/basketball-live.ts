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

import {
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
  half: 1 | 2;
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
  const { groups, queues, present } = startingQueues(input);
  const absent = new Set(input.absentIds ?? []);
  const players = input.players.filter((p) => !absent.has(p.id));
  return {
    version: 2,
    settings: { ...input.settings },
    groups,
    players: players.map((p) => present.find((x) => x.id === p.id) ?? p),
    queues: queues.map((q) => q.map((p) => p.id)),
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
      phase: s.half === 1 ? "halftime" : "final",
    };
  }
  return { ...s, playedSec, clockSec, runningSince: now };
}

export function startClock(s: LiveState, now: number): LiveState {
  if (s.phase === "final") return s;
  if (s.phase === "halftime") {
    return { ...s, phase: "live", half: 2, clockSec: s.settings.halfMinutes * 60, runningSince: now };
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
  if (s.phase === "halftime") return lengths.length; // the 2nd half's first shift is next
  let elapsed = s.settings.halfMinutes * 60 - s.clockSec;
  let index = 0;
  while (index < lengths.length - 1 && elapsed >= lengths[index] - EPS) {
    elapsed -= lengths[index];
    index++;
  }
  return (s.half - 1) * lengths.length + index;
}

export function totalShifts(s: LiveState): number {
  return shiftLengths(s.settings).length * 2;
}

/** True from the first flex shift on: the coach picks, no planned subs. */
export function isFlexShift(s: LiveState, shift: number): boolean {
  return shift >= totalShifts(s) - Math.min(Math.floor(s.settings.flexShifts), totalShifts(s));
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
  const after = new Set(onCourtIds({ ...s, starts: advanced(s) }));
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
  return { queues: s.queues, starts: s.starts, subsMade: s.subsMade };
}

function withUndo(s: LiveState, now: number, change: (s: LiveState) => LiveState): LiveState {
  const settled = settle(s, now);
  return { ...change(settled), undo: [...settled.undo, lineup(settled)].slice(-30) };
}

/** Make the next planned sub (when it's due, or early to jump ahead). */
export function makeSub(s: LiveState, now: number): LiveState {
  return withUndo(s, now, (x) => ({ ...x, starts: advanced(x), subsMade: x.subsMade + 1 }));
}

/** Skip a due sub without changing anyone (e.g. it's flex time or the coach wants to wait). */
export function skipSub(s: LiveState, now: number): LiveState {
  return withUndo(s, now, (x) => ({ ...x, subsMade: Math.max(x.subsMade + 1, currentShift(x)) }));
}

/** Trade two players' places (on court ↔ bench, or across groups). */
export function swapPlayers(s: LiveState, now: number, a: string, b: string): LiveState {
  if (a === b) return s;
  return withUndo(s, now, (x) => {
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
  return withUndo(s, now, (x) => {
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
  return withUndo(s, now, (x) => {
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
  const on = onCourt(s);
  return stickySpots(s.groups.map((g, i) => ({ ids: on[i], spots: g.spots })), s.players, previous);
}
