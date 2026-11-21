// Live basketball game state for the court display (pages/basketball-court-display.tsx).
//
// Same rotation as the Bench Sheet (lib/basketball-rotation.ts): two circular
// queues, and the on-court players are a window over each that moves forward
// one place per sub. Following every sub reproduces the printed sheet exactly.
// Changes made on the fly stay inside that model, so the rotation keeps going
// from wherever the game actually is:
//   - swap two players  → they trade places in the queues
//   - take a player out → they leave the queue; the next in line fills in
//   - put them back     → they rejoin as the next player to go in
//   - jump ahead        → make the next sub now (it counts for the coming sub time)
//   - undo              → put the lineup back as it was before the last change
// Playing time is counted from the game clock while a player is on court.
//
// Pure functions over plain JSON, so the state can live in localStorage and be
// tested with plain Node (test/basketball-live.test.ts).

import {
  buildRotation,
  type BasketballPlayer,
  type BasketballRole,
  type BasketballSettings,
} from "./basketball-rotation.ts";

export type LivePhase = "pregame" | "live" | "halftime" | "final";

interface Lineup {
  guardQueue: string[];
  frontQueue: string[];
  guardStart: number;
  frontStart: number;
  /** Subs made so far (planned or jumped ahead). */
  subsMade: number;
}

export interface LiveState extends Lineup {
  version: 1;
  settings: BasketballSettings;
  /** Roster snapshot taken at the start of the game (everyone who was here). */
  players: BasketballPlayer[];
  guardSpots: number;
  frontSpots: number;
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

/** Start a game from the Bench Sheet setup (same inputs as buildRotation). */
export function startState(input: {
  players: BasketballPlayer[];
  settings: BasketballSettings;
  guardOrder?: string[];
  frontOrder?: string[];
  absentIds?: string[];
}): LiveState {
  const plan = buildRotation(input);
  const absent = new Set(input.absentIds ?? []);
  const players = input.players.filter((p) => !absent.has(p.id));
  return {
    version: 1,
    settings: { ...input.settings },
    players,
    guardQueue: plan.guardQueue,
    frontQueue: plan.frontQueue,
    guardStart: 0,
    frontStart: 0,
    subsMade: 0,
    guardSpots: Math.min(Math.floor(input.settings.guardSpots), plan.guardQueue.length),
    frontSpots: Math.min(Math.floor(input.settings.frontSpots), plan.frontQueue.length),
    outIds: [],
    phase: "pregame",
    half: 1,
    clockSec: input.settings.halfMinutes * 60,
    runningSince: null,
    playedSec: Object.fromEntries(players.map((p) => [p.id, 0])),
    undo: [],
  };
}

function windowOf(queue: string[], start: number, spots: number): string[] {
  if (queue.length <= spots) return [...queue];
  return Array.from({ length: spots }, (_, j) => queue[(start + j) % queue.length]);
}

export function onCourt(s: LiveState): { guards: string[]; front: string[] } {
  return {
    guards: windowOf(s.guardQueue, s.guardStart, s.guardSpots),
    front: windowOf(s.frontQueue, s.frontStart, s.frontSpots),
  };
}

export function bench(s: LiveState): string[] {
  const on = new Set([...onCourt(s).guards, ...onCourt(s).front]);
  return [...s.guardQueue, ...s.frontQueue].filter((id) => !on.has(id));
}

/** Count clock time up to `now`: run the clock down and credit on-court players. */
export function settle(s: LiveState, now: number): LiveState {
  if (s.runningSince === null || s.phase !== "live") return s;
  const elapsed = Math.max(0, Math.min((now - s.runningSince) / 1000, s.clockSec));
  const { guards, front } = onCourt(s);
  const playedSec = { ...s.playedSec };
  for (const id of [...guards, ...front]) playedSec[id] = (playedSec[id] ?? 0) + elapsed;
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
  const starterIds = s.phase === "pregame" ? [...onCourt(s).guards, ...onCourt(s).front] : s.starterIds;
  return { ...s, phase: "live", runningSince: s.runningSince ?? now, starterIds };
}

export function stopClock(s: LiveState, now: number): LiveState {
  const settled = settle(s, now);
  return { ...settled, runningSince: null };
}

/** Set the clock (seconds left in this half); keeps it running if it was. */
export function setClock(s: LiveState, now: number, clockSec: number): LiveState {
  const settled = settle(s, now);
  const max = s.settings.halfMinutes * 60;
  const value = Math.max(0, Math.min(max, clockSec));
  return { ...settled, clockSec: value, runningSince: settled.runningSince === null ? null : now };
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

/** Who the next planned sub brings in and takes out. */
export function nextSub(s: LiveState): { in: string[]; out: string[] } {
  const now = onCourt(s);
  const next = onCourt({
    ...s,
    guardStart: s.guardQueue.length > s.guardSpots ? s.guardStart + 1 : s.guardStart,
    frontStart: s.frontQueue.length > s.frontSpots ? s.frontStart + 1 : s.frontStart,
  });
  const before = new Set([...now.guards, ...now.front]);
  const after = new Set([...next.guards, ...next.front]);
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
  return {
    guardQueue: s.guardQueue,
    frontQueue: s.frontQueue,
    guardStart: s.guardStart,
    frontStart: s.frontStart,
    subsMade: s.subsMade,
  };
}

function withUndo(s: LiveState, now: number, change: (s: LiveState) => LiveState): LiveState {
  const settled = settle(s, now);
  return { ...change(settled), undo: [...settled.undo, lineup(settled)].slice(-30) };
}

/** Make the next planned sub (when it's due, or early to jump ahead). */
export function makeSub(s: LiveState, now: number): LiveState {
  return withUndo(s, now, (x) => ({
    ...x,
    guardStart: x.guardQueue.length > x.guardSpots ? x.guardStart + 1 : x.guardStart,
    frontStart: x.frontQueue.length > x.frontSpots ? x.frontStart + 1 : x.frontStart,
    subsMade: x.subsMade + 1,
  }));
}

/** Skip a due sub without changing anyone (e.g. it's flex time or the coach wants to wait). */
export function skipSub(s: LiveState, now: number): LiveState {
  return withUndo(s, now, (x) => ({ ...x, subsMade: Math.max(x.subsMade + 1, currentShift(x)) }));
}

/** Trade two players' places (on court ↔ bench, or across the two queues). */
export function swapPlayers(s: LiveState, now: number, a: string, b: string): LiveState {
  if (a === b) return s;
  return withUndo(s, now, (x) => {
    const guardQueue = [...x.guardQueue];
    const frontQueue = [...x.frontQueue];
    const find = (id: string): [string[], number] | null => {
      const g = guardQueue.indexOf(id);
      if (g >= 0) return [guardQueue, g];
      const f = frontQueue.indexOf(id);
      return f >= 0 ? [frontQueue, f] : null;
    };
    const pa = find(a);
    const pb = find(b);
    if (!pa || !pb) return x;
    pa[0][pa[1]] = b;
    pb[0][pb[1]] = a;
    return { ...x, guardQueue, frontQueue };
  });
}

function removeFrom(queue: string[], start: number, id: string): { queue: string[]; start: number } {
  const index = queue.indexOf(id);
  if (index < 0) return { queue, start };
  const next = queue.filter((x) => x !== id);
  // Players before the window move down one place; keep the window on the same people.
  let newStart = start % queue.length;
  if (index < newStart) newStart -= 1;
  return { queue: next, start: next.length ? newStart % next.length : 0 };
}

/** Take a player out of the game; the next player in line fills their spot. */
export function takeOut(s: LiveState, now: number, id: string): LiveState {
  return withUndo(s, now, (x) => {
    const g = removeFrom(x.guardQueue, x.guardStart, id);
    const f = removeFrom(x.frontQueue, x.frontStart, id);
    const guardSpots = Math.min(Math.floor(x.settings.guardSpots), g.queue.length);
    const frontSpots = Math.min(Math.floor(x.settings.frontSpots), f.queue.length);
    return {
      ...x,
      guardQueue: g.queue,
      guardStart: g.start,
      frontQueue: f.queue,
      frontStart: f.start,
      guardSpots,
      frontSpots,
      outIds: [...new Set([...x.outIds, id])],
    };
  });
}

/** Bring a player back (or add a late arrival); they're next to go in. */
export function putBack(s: LiveState, now: number, player: BasketballPlayer, role?: BasketballRole): LiveState {
  return withUndo(s, now, (x) => {
    const asRole = role ?? player.role;
    const players = x.players.some((p) => p.id === player.id) ? x.players : [...x.players, player];
    const insert = (queue: string[], start: number, spots: number) => {
      if (queue.includes(player.id)) return { queue, start };
      if (queue.length < spots || queue.length === 0) return { queue: [...queue, player.id], start };
      // Right after the on-court window = the next one in.
      const at = (start % queue.length) + Math.min(spots, queue.length);
      const next = [...queue];
      next.splice(at, 0, player.id);
      return { queue: next, start: start % queue.length };
    };
    const g = asRole === "guard" ? insert(x.guardQueue, x.guardStart, x.guardSpots) : { queue: x.guardQueue, start: x.guardStart };
    const f = asRole === "front" ? insert(x.frontQueue, x.frontStart, x.frontSpots) : { queue: x.frontQueue, start: x.frontStart };
    return {
      ...x,
      players,
      guardQueue: g.queue,
      guardStart: g.start,
      frontQueue: f.queue,
      frontStart: f.start,
      guardSpots: Math.min(Math.floor(x.settings.guardSpots), g.queue.length),
      frontSpots: Math.min(Math.floor(x.settings.frontSpots), f.queue.length),
      outIds: x.outIds.filter((o) => o !== player.id),
      playedSec: { ...x.playedSec, [player.id]: x.playedSec[player.id] ?? 0 },
    };
  });
}

export function undoLast(s: LiveState, now: number): LiveState {
  if (s.undo.length === 0) return s;
  const settled = settle(s, now);
  const previous = settled.undo[settled.undo.length - 1];
  const inQueues = new Set([...previous.guardQueue, ...previous.frontQueue]);
  return {
    ...settled,
    ...previous,
    guardSpots: Math.min(Math.floor(s.settings.guardSpots), previous.guardQueue.length),
    frontSpots: Math.min(Math.floor(s.settings.frontSpots), previous.frontQueue.length),
    outIds: settled.outIds.filter((id) => !inQueues.has(id)),
    undo: settled.undo.slice(0, -1),
  };
}

export type CourtSpot = 1 | 2 | 3 | 4 | 5;

/**
 * Put the on-court players on the 1–5 spots. Guards take the 1 and 2 (by
 * their 1/2 tag when set); front players take the 3, 4 and 5, with Bigs at
 * the 5 and 4 and a non-Big at the 3. With other spot counts, extra players
 * are listed without a number.
 */
export function courtSpots(
  s: LiveState,
): { spot: CourtSpot | null; id: string }[] {
  const byId = new Map(s.players.map((p) => [p.id, p]));
  const { guards, front } = onCourt(s);
  const name = (id: string) => byId.get(id)?.name ?? id;
  const g = [...guards].sort((a, b) => {
    const pa = byId.get(a)?.position ?? "9";
    const pb = byId.get(b)?.position ?? "9";
    return pa.localeCompare(pb) || name(a).localeCompare(name(b));
  });
  // Guard tagged "2" alone should take the 2, not the 1.
  if (g.length === 2 && byId.get(g[0])?.position === "2" && !byId.get(g[1])?.position) g.reverse();
  const bigs = front.filter((id) => byId.get(id)?.big).sort((a, b) => name(a).localeCompare(name(b)));
  const others = front.filter((id) => !byId.get(id)?.big).sort((a, b) => name(a).localeCompare(name(b)));
  // 3 = a non-Big if there is one; 5 then 4 = Bigs first.
  const three = others.length ? others.shift()! : bigs.pop();
  const five = bigs.length ? bigs.shift()! : others.shift();
  const four = bigs.length ? bigs.shift()! : others.shift();
  const spots: { spot: CourtSpot | null; id: string }[] = [];
  if (g[0]) spots.push({ spot: 1, id: g[0] });
  if (g[1]) spots.push({ spot: 2, id: g[1] });
  for (const id of g.slice(2)) spots.push({ spot: null, id });
  if (three) spots.push({ spot: 3, id: three });
  if (four) spots.push({ spot: 4, id: four });
  if (five) spots.push({ spot: 5, id: five });
  for (const id of [...bigs, ...others]) spots.push({ spot: null, id });
  return spots;
}
