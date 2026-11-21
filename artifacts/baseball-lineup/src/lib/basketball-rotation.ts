// Youth basketball rotations for the Bench Sheet page.
//
// Two separate circular queues, Guards and Front. The players on court are a
// window over each queue that moves forward by one every shift: the player who
// has been on longest comes out and the player who has sat longest goes in, so
// every sub is one guard and one front-court player. The queues run straight
// through halftime. The last few shifts of the game are left to the coach.
//
// Pure functions only (no React, no fetch), so it can be tested with plain Node:
// `pnpm --filter @workspace/baseball-lineup run test:basketball-rotation`.

export type BasketballRole = "guard" | "front";
export type GuardPosition = "1" | "2";

export interface BasketballPlayer {
  id: string;
  name: string;
  role: BasketballRole;
  /** Front-court players only: a 4/5 who can anchor the paint. */
  big?: boolean;
  /** Guards only, optional: which guard spot they play. */
  position?: GuardPosition | null;
}

export interface BasketballSettings {
  halfMinutes: number;
  shiftMinutes: number;
  guardSpots: number;
  frontSpots: number;
  /** Shifts at the end of the game left to the coach. */
  flexShifts: number;
  /** Players subbed in (and out) each shift, 1–5. Default 2: one guard and one front. */
  subSize?: number;
}

export const DEFAULT_BASKETBALL_SETTINGS: BasketballSettings = {
  halfMinutes: 20,
  shiftMinutes: 2.5,
  guardSpots: 2,
  frontSpots: 3,
  flexShifts: 1,
  subSize: 2,
};

export const MIN_SUB_SIZE = 1;
export const MAX_SUB_SIZE = 5;

/**
 * How many guards and front-court players change on the `subNumber`-th sub
 * (1-based) when subbing `subSize` players at a time. The sub is split evenly
 * between guards and front (2 at a time = one of each, 4 = two of each); an
 * odd extra player alternates, starting with the front court (1 at a time =
 * front, guard, front, …). A group can't change more players than it has on
 * the court or on the bench, so any it can't take go to the other group.
 */
export function subSplit(
  subNumber: number,
  subSize: number,
  guards: { queue: number; spots: number },
  front: { queue: number; spots: number },
): { guards: number; front: number } {
  const gCap = Math.min(guards.spots, Math.max(0, guards.queue - guards.spots));
  const fCap = Math.min(front.spots, Math.max(0, front.queue - front.spots));
  const k = Math.max(0, Math.min(Math.floor(subSize), gCap + fCap));
  const half = Math.floor(k / 2);
  const extraToFront = subNumber % 2 === 1;
  let g = half + (k % 2 === 1 && !extraToFront ? 1 : 0);
  let f = k - g;
  // Move what a group can't take over to the other one.
  if (g > gCap) { f += g - gCap; g = gCap; }
  if (f > fCap) { g = Math.min(gCap, g + f - fCap); f = fCap; }
  return { guards: g, front: f };
}

export interface RotationInput {
  players: BasketballPlayer[];
  settings: BasketballSettings;
  /** Player ids, starting order. Missing present guards are added in roster order. */
  guardOrder?: string[];
  frontOrder?: string[];
  absentIds?: string[];
}

export interface RotationRow {
  /** 0-based across the whole game. */
  shift: number;
  half: 1 | 2;
  /** Game clock at the start of the shift, counting down: "20:00". */
  clock: string;
  minutes: number;
  flex: boolean;
  guards: string[];
  front: string[];
  bench: string[];
  in: string[];
  out: string[];
  /** Player ids on court (empty on flex rows), for placing them at the 1–5. */
  guardIds: string[];
  frontIds: string[];
}

export interface MinutesLine {
  id: string;
  name: string;
  role: BasketballRole;
  big: boolean;
  /** Set when this player is filling a spot outside their role today. */
  playingAs: BasketballRole | null;
  minutes: number;
  longestSit: number;
  /** Clock and half where the longest sit starts, e.g. "1st half 17:30". */
  longestSitFrom: string | null;
}

export interface RotationResult {
  halves: { half: 1 | 2; rows: RotationRow[] }[];
  minutes: MinutesLine[];
  flexSuggestion: string[];
  warnings: string[];
  /** The queues actually used, ids in starting order (after any borrowing). */
  guardQueue: string[];
  frontQueue: string[];
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
const sortNames = (names: string[]) => [...names].sort(byName);

/** 17.5 -> "17:30" */
export function formatClock(minutes: number): string {
  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 17.5 -> "17.5", 20 -> "20" */
export function formatMinutes(minutes: number): string {
  return String(Math.round(minutes * 100) / 100);
}

/** Every `size` players in a row around the circle (the windows that will share the court). */
function circularWindows<T>(queue: T[], size: number): T[][] {
  if (queue.length <= size) return [queue];
  return queue.map((_, start) => Array.from({ length: size }, (_, j) => queue[(start + j) % queue.length]));
}

/** No two guards tagged the same position may be on together (a 1 always plays next to a 2). */
export function guardWindowOk(window: BasketballPlayer[]): boolean {
  const tagged = window.filter(p => p.position === "1" || p.position === "2");
  if (tagged.length < 2) return true;
  return tagged.some(p => p.position === "1") && tagged.some(p => p.position === "2");
}

/** Every front-court group needs at least one Big. */
export function frontWindowOk(window: BasketballPlayer[]): boolean {
  return window.some(p => p.big);
}

export function queueIsValid(queue: BasketballPlayer[], size: number, ok: (w: BasketballPlayer[]) => boolean): boolean {
  return circularWindows(queue, size).every(ok);
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Finds a random circular order where every window passes `ok`, by
 * backtracking (rosters are small). Returns null if there is none.
 */
export function arrangeQueue(
  players: BasketballPlayer[],
  size: number,
  ok: (w: BasketballPlayer[]) => boolean,
  random: () => number = Math.random,
): BasketballPlayer[] | null {
  const pool = shuffled(players, random);
  if (pool.length <= size) return ok(pool) ? pool : null;
  const order: BasketballPlayer[] = [];
  const used = new Array(pool.length).fill(false);
  let steps = 0;

  const place = (): boolean => {
    if (++steps > 200_000) return false;
    if (order.length === pool.length) {
      // Check the windows that wrap around the end of the circle.
      for (let start = pool.length - size + 1; start < pool.length; start++) {
        if (!ok(Array.from({ length: size }, (_, j) => order[(start + j) % order.length]))) return false;
      }
      return true;
    }
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      order.push(pool[i]);
      used[i] = true;
      const fullWindow = order.length >= size ? order.slice(order.length - size) : null;
      if ((!fullWindow || ok(fullWindow)) && place()) return true;
      order.pop();
      used[i] = false;
    }
    return false;
  };

  return place() ? order : null;
}

/** A fresh random starting order that follows the position and Big rules where possible. */
export function reshuffleStartingOrder(
  players: BasketballPlayer[],
  settings: BasketballSettings,
  absentIds: string[] = [],
  random: () => number = Math.random,
): { guardOrder: string[]; frontOrder: string[] } {
  const absent = new Set(absentIds);
  const present = players.filter(p => !absent.has(p.id));
  const guards = present.filter(p => p.role === "guard");
  const front = present.filter(p => p.role === "front");
  const guardOrder = arrangeQueue(guards, settings.guardSpots, guardWindowOk, random) ?? shuffled(guards, random);
  const frontOrder = arrangeQueue(front, settings.frontSpots, frontWindowOk, random) ?? shuffled(front, random);
  // Absent players keep a place at the end so they slot back in when they return.
  const rest = players.filter(p => absent.has(p.id));
  return {
    guardOrder: [...guardOrder, ...rest.filter(p => p.role === "guard")].map(p => p.id),
    frontOrder: [...frontOrder, ...rest.filter(p => p.role === "front")].map(p => p.id),
  };
}

function ordered(players: BasketballPlayer[], order: string[] | undefined): BasketballPlayer[] {
  const rank = new Map((order ?? []).map((id, i) => [id, i]));
  return players
    .map((p, rosterIndex) => ({ p, key: rank.get(p.id) ?? order?.length ?? 0, rosterIndex }))
    .sort((a, b) => a.key - b.key || a.rosterIndex - b.rosterIndex)
    .map(x => x.p);
}

function validSettings(s: BasketballSettings): string | null {
  const nums = [s.halfMinutes, s.shiftMinutes, s.guardSpots, s.frontSpots, s.flexShifts];
  if (nums.some(n => !Number.isFinite(n))) return "Game settings must all be numbers.";
  if (s.halfMinutes <= 0 || s.shiftMinutes <= 0) return "Half length and shift length must be more than 0.";
  if (s.shiftMinutes > s.halfMinutes) return "Shift length can't be longer than a half.";
  if (s.halfMinutes / s.shiftMinutes > 60) return "That's more than 60 shifts a half. Use a longer shift.";
  if (s.guardSpots < 0 || s.frontSpots < 0 || s.guardSpots + s.frontSpots < 1) return "There must be at least one spot on court.";
  if (s.flexShifts < 0) return "Flex shifts can't be negative.";
  return null;
}

export function buildRotation(input: RotationInput): RotationResult {
  const warnings: string[] = [];
  const settings = {
    ...input.settings,
    guardSpots: Math.floor(input.settings.guardSpots),
    frontSpots: Math.floor(input.settings.frontSpots),
    flexShifts: Math.floor(input.settings.flexShifts),
  };
  const empty: RotationResult = { halves: [], minutes: [], flexSuggestion: [], warnings, guardQueue: [], frontQueue: [] };

  const settingsError = validSettings(settings);
  if (settingsError) {
    warnings.push(settingsError);
    return empty;
  }

  const absent = new Set(input.absentIds ?? []);
  const present = input.players.filter(p => !absent.has(p.id) && p.name.trim());
  if (present.length === 0) {
    warnings.push("No players are marked present.");
    return empty;
  }

  let guardQueue = ordered(present.filter(p => p.role === "guard"), input.guardOrder);
  let frontQueue = ordered(present.filter(p => p.role === "front"), input.frontOrder);
  const playingAs = new Map<string, BasketballRole>();
  const guardsHere = guardQueue.length;
  const frontHere = frontQueue.length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const nameList = (ps: BasketballPlayer[]) =>
    ps.length <= 2 ? ps.map(p => p.name).join(" and ") : `${ps.slice(0, -1).map(p => p.name).join(", ")} and ${ps[ps.length - 1].name}`;

  // Not enough guards: a front-court player (not a Big, if possible) plays guard.
  const toGuard: BasketballPlayer[] = [];
  while (guardQueue.length < settings.guardSpots && frontQueue.length > settings.frontSpots) {
    const pick = [...frontQueue].reverse().find(p => !p.big) ?? frontQueue[frontQueue.length - 1];
    frontQueue = frontQueue.filter(p => p !== pick);
    guardQueue = [...guardQueue, pick];
    playingAs.set(pick.id, "guard");
    toGuard.push(pick);
  }
  if (toGuard.length > 0) {
    const verb = toGuard.length === 1 ? "fills" : "fill";
    warnings.push(guardsHere === 0
      ? `Nobody here is set as a Guard, so ${nameList(toGuard)} (Front) ${verb} in at guard. Set each player's role to Guard or Front to fix this.`
      : `Only ${plural(guardsHere, "guard")} here, so ${nameList(toGuard)} (Front) ${verb} in at guard.`);
  }
  // Not enough front-court players but extra guards: last resort, a guard plays up front.
  const toFront: BasketballPlayer[] = [];
  while (frontQueue.length < settings.frontSpots && guardQueue.length > settings.guardSpots) {
    const pick = guardQueue[guardQueue.length - 1];
    guardQueue = guardQueue.slice(0, -1);
    frontQueue = [...frontQueue, pick];
    playingAs.set(pick.id, "front");
    toFront.push(pick);
  }
  if (toFront.length > 0) {
    const verb = toFront.length === 1 ? "fills" : "fill";
    warnings.push(frontHere === 0
      ? `Nobody here is set as Front, so ${nameList(toFront)} (Guard) ${verb} in up front. Set each player's role to Guard or Front to fix this.`
      : `Only ${plural(frontHere, "front-court player")} here, so ${nameList(toFront)} (Guard) ${verb} in up front.`);
  }
  const guardSpots = Math.min(settings.guardSpots, guardQueue.length);
  const frontSpots = Math.min(settings.frontSpots, frontQueue.length);
  if (guardSpots + frontSpots < settings.guardSpots + settings.frontSpots) {
    warnings.push(`Only ${present.length} players here for ${settings.guardSpots + settings.frontSpots} spots, so the team plays short-handed.`);
  }

  if (guardSpots >= 2 && !queueIsValid(guardQueue, guardSpots, guardWindowOk)) {
    const fixable = arrangeQueue(guardQueue, guardSpots, guardWindowOk) !== null;
    warnings.push(fixable
      ? "In this guard order, two guards tagged the same position end up on court together. Reshuffle or drag to fix it."
      : "The guards' 1/2 tags can't alternate with this group, so some shifts pair two of the same position.");
  }
  if (frontSpots > 0 && frontQueue.some(p => p.big) && !queueIsValid(frontQueue, frontSpots, frontWindowOk)) {
    const fixable = arrangeQueue(frontQueue, frontSpots, frontWindowOk) !== null;
    warnings.push(fixable
      ? "In this front-court order, some shifts have no Big on court. Reshuffle or drag to fix it."
      : `Not enough Bigs to put one in every group of ${frontSpots}, so some shifts have no Big on court.`);
  }

  // Shifts and the clock. A half that doesn't divide evenly ends with a shorter shift.
  const fullShifts = Math.floor(settings.halfMinutes / settings.shiftMinutes + 1e-9);
  const remainder = settings.halfMinutes - fullShifts * settings.shiftMinutes;
  const shiftLengths = Array.from({ length: fullShifts }, () => settings.shiftMinutes);
  if (remainder > 1e-6) {
    shiftLengths.push(remainder);
    warnings.push(`${formatMinutes(settings.halfMinutes)}-minute halves don't split evenly into ${formatMinutes(settings.shiftMinutes)}-minute shifts, so each half ends with a ${formatMinutes(remainder)}-minute shift.`);
  }
  const totalShifts = shiftLengths.length * 2;
  const flexShifts = Math.min(settings.flexShifts, totalShifts);
  if (flexShifts < settings.flexShifts) warnings.push("There are more flex shifts than shifts in the game.");
  const firstFlex = totalShifts - flexShifts;

  const name = new Map(present.map(p => [p.id, p.name]));
  const names = (ids: string[]) => sortNames(ids.map(id => name.get(id) ?? id));
  const windowAt = (queue: BasketballPlayer[], spots: number, start: number) =>
    queue.length <= spots ? queue.map(p => p.id) : Array.from({ length: spots }, (_, j) => queue[(start + j) % queue.length].id);

  // How far each queue's on-court window has moved by each shift.
  const subSize = Math.floor(settings.subSize ?? 2);
  const groups = () => [{ queue: guardQueue.length, spots: guardSpots }, { queue: frontQueue.length, spots: frontSpots }] as const;
  const maxSub = subSplit(1, MAX_SUB_SIZE, ...groups());
  const most = maxSub.guards + maxSub.front;
  if (subSize < MIN_SUB_SIZE || subSize > MAX_SUB_SIZE) {
    warnings.push(`Subs at a time must be ${MIN_SUB_SIZE} to ${MAX_SUB_SIZE}.`);
  } else if (subSize > most && most > 0) {
    warnings.push(`Only ${plural(most, "player")} can sub at once with this group, so subs are ${most} at a time.`);
  }
  const guardStarts = [0];
  const frontStarts = [0];
  for (let shift = 1; shift < totalShifts; shift++) {
    const split = subSplit(shift, subSize, ...groups());
    guardStarts.push(guardStarts[shift - 1] + split.guards);
    frontStarts.push(frontStarts[shift - 1] + split.front);
  }

  const halves: RotationResult["halves"] = [{ half: 1, rows: [] }, { half: 2, rows: [] }];
  const onCourtByShift: Set<string>[] = [];
  let previous: Set<string> | null = null;
  for (let shift = 0; shift < totalShifts; shift++) {
    const half = shift < shiftLengths.length ? 1 : 2;
    const index = shift % shiftLengths.length;
    const elapsed = shiftLengths.slice(0, index).reduce((sum, m) => sum + m, 0);
    const flex = shift >= firstFlex;
    const guards = windowAt(guardQueue, guardSpots, guardStarts[shift]);
    const front = windowAt(frontQueue, frontSpots, frontStarts[shift]);
    const on = new Set([...guards, ...front]);
    onCourtByShift.push(on);
    const bench = present.filter(p => !on.has(p.id)).map(p => p.id);
    halves[half - 1].rows.push({
      shift,
      half,
      clock: formatClock(settings.halfMinutes - elapsed),
      minutes: shiftLengths[index],
      flex,
      guards: flex ? [] : names(guards),
      front: flex ? [] : names(front),
      bench: flex ? [] : names(bench),
      in: flex || !previous ? [] : names([...on].filter(id => !previous!.has(id))),
      out: flex || !previous ? [] : names([...previous].filter(id => !on.has(id))),
      guardIds: flex ? [] : guards,
      frontIds: flex ? [] : front,
    });
    previous = on;
  }

  const lengthOf = (shift: number) => shiftLengths[shift % shiftLengths.length];
  const describe = (shift: number) => {
    const row = halves[shift < shiftLengths.length ? 0 : 1].rows[shift % shiftLengths.length];
    return `${row.half === 1 ? "1st" : "2nd"} half ${row.clock}`;
  };

  const minutes: MinutesLine[] = present.map(p => {
    let played = 0;
    let longestSit = 0;
    let longestSitFrom: string | null = null;
    let sit = 0;
    let sitStart = 0;
    for (let shift = 0; shift < firstFlex; shift++) {
      if (onCourtByShift[shift].has(p.id)) {
        played += lengthOf(shift);
        sit = 0;
      } else {
        if (sit === 0) sitStart = shift;
        sit += lengthOf(shift);
        if (sit > longestSit + 1e-9) {
          longestSit = sit;
          longestSitFrom = describe(sitStart);
        }
      }
    }
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      big: !!p.big,
      playingAs: playingAs.get(p.id) ?? null,
      minutes: played,
      longestSit,
      longestSitFrom,
    };
  }).sort((a, b) => b.minutes - a.minutes || byName(a.name, b.name));

  const longestSit = Math.max(0, ...minutes.map(m => m.longestSit));
  if (longestSit > 3 * settings.shiftMinutes + 1e-9) {
    warnings.push(`Some players sit ${formatClock(longestSit)} in a row. Shorter shifts or more subs at a time spread the minutes more evenly.`);
  }

  let flexSuggestion: string[] = [];
  if (flexShifts > 0 && firstFlex > 0 && minutes.length > 0) {
    const fewest = Math.min(...minutes.map(m => m.minutes));
    const picks = new Set(minutes.filter(m => Math.abs(m.minutes - fewest) < 1e-9).map(m => m.id));
    if (firstFlex >= 2) {
      for (const p of present) {
        if (!onCourtByShift[firstFlex - 1].has(p.id) && !onCourtByShift[firstFlex - 2].has(p.id)) picks.add(p.id);
      }
    }
    flexSuggestion = names([...picks]);
  }

  return {
    halves,
    minutes,
    flexSuggestion,
    warnings,
    guardQueue: guardQueue.map(p => p.id),
    frontQueue: frontQueue.map(p => p.id),
  };
}

/** Player ids in starting order for one queue: saved order first, then anyone new in roster order. */
export function startingOrder(players: BasketballPlayer[], order: string[] | undefined): string[] {
  return ordered(players, order).map(p => p.id);
}

export type CourtSpot = 1 | 2 | 3 | 4 | 5;

/**
 * Put on-court players on the 1–5 spots. Guards take the 1 and 2 (by
 * their 1/2 tag when set); front players take the 3, 4 and 5, with Bigs at
 * the 5 and 4 and a non-Big at the 3. With other spot counts, extra players
 * are listed without a number.
 */
export function assignSpots(
  guards: string[],
  front: string[],
  players: BasketballPlayer[],
): { spot: CourtSpot | null; id: string }[] {
  const byId = new Map(players.map((p) => [p.id, p]));
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

/**
 * Like assignSpots, but players who were already on court keep the spot they
 * had (`previous`: player id → spot). Players coming in take the open spots:
 * guards the 1/2 (their tagged spot if it's open), Bigs the 5 then 4, a
 * non-Big the 3. With no previous spots this is the same as assignSpots.
 */
export function stickySpots(
  guards: string[],
  front: string[],
  players: BasketballPlayer[],
  previous: Map<string, CourtSpot> | null,
): { spot: CourtSpot | null; id: string }[] {
  if (!previous || previous.size === 0) return assignSpots(guards, front, players);
  const byId = new Map(players.map((p) => [p.id, p]));
  const taken = new Map<CourtSpot, string>();
  const placed = new Set<string>();
  const keep = (ids: string[], allowed: CourtSpot[]) => {
    for (const id of ids) {
      const spot = previous.get(id);
      if (spot && allowed.includes(spot) && !taken.has(spot)) {
        taken.set(spot, id);
        placed.add(id);
      }
    }
  };
  keep(guards, [1, 2]);
  keep(front, [3, 4, 5]);
  const fill = (id: string, preferences: CourtSpot[]) => {
    const spot = preferences.find((s) => !taken.has(s));
    if (spot) {
      taken.set(spot, id);
      placed.add(id);
    }
  };
  for (const id of guards.filter((g) => !placed.has(g))) {
    const tag = byId.get(id)?.position;
    fill(id, tag === "2" ? [2, 1] : [1, 2]);
  }
  const newFront = front.filter((f) => !placed.has(f));
  // Bigs first so they get the post spots before a non-Big lands there.
  for (const id of [...newFront.filter((f) => byId.get(f)?.big), ...newFront.filter((f) => !byId.get(f)?.big)]) {
    fill(id, byId.get(id)?.big ? [5, 4, 3] : [3, 4, 5]);
  }
  const spots: { spot: CourtSpot | null; id: string }[] = ([1, 2, 3, 4, 5] as CourtSpot[])
    .filter((s) => taken.has(s))
    .map((s) => ({ spot: s, id: taken.get(s)! }));
  for (const id of [...guards, ...front]) if (!placed.has(id)) spots.push({ spot: null, id });
  return spots;
}
