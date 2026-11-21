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
}

export const DEFAULT_BASKETBALL_SETTINGS: BasketballSettings = {
  halfMinutes: 20,
  shiftMinutes: 2.5,
  guardSpots: 2,
  frontSpots: 3,
  flexShifts: 1,
};

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

  // Not enough guards: a front-court player (not a Big, if possible) plays guard.
  while (guardQueue.length < settings.guardSpots && frontQueue.length > settings.frontSpots) {
    const pick = [...frontQueue].reverse().find(p => !p.big) ?? frontQueue[frontQueue.length - 1];
    frontQueue = frontQueue.filter(p => p !== pick);
    guardQueue = [...guardQueue, pick];
    playingAs.set(pick.id, "guard");
    warnings.push(`Only ${plural(guardsHere, "guard")} here, so ${pick.name} (Front) fills in at guard.`);
  }
  // Not enough front-court players but extra guards: last resort, a guard plays up front.
  while (frontQueue.length < settings.frontSpots && guardQueue.length > settings.guardSpots) {
    const pick = guardQueue[guardQueue.length - 1];
    guardQueue = guardQueue.slice(0, -1);
    frontQueue = [...frontQueue, pick];
    playingAs.set(pick.id, "front");
    warnings.push(`Only ${plural(frontHere, "front-court player")} here, so ${pick.name} (Guard) fills in up front.`);
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
  const windowAt = (queue: BasketballPlayer[], spots: number, shift: number) =>
    queue.length <= spots ? queue.map(p => p.id) : Array.from({ length: spots }, (_, j) => queue[(shift + j) % queue.length].id);

  const halves: RotationResult["halves"] = [{ half: 1, rows: [] }, { half: 2, rows: [] }];
  const onCourtByShift: Set<string>[] = [];
  let previous: Set<string> | null = null;
  for (let shift = 0; shift < totalShifts; shift++) {
    const half = shift < shiftLengths.length ? 1 : 2;
    const index = shift % shiftLengths.length;
    const elapsed = shiftLengths.slice(0, index).reduce((sum, m) => sum + m, 0);
    const flex = shift >= firstFlex;
    const guards = windowAt(guardQueue, guardSpots, shift);
    const front = windowAt(frontQueue, frontSpots, shift);
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
