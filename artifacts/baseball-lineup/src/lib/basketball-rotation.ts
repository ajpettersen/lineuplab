// Youth basketball rotations for the Bench Sheet and game pages.
//
// The five spots are split into position groups the team picks (Settings →
// Rotation): Guards (1–2) + Front (3–5) by default, or Guards / Forwards /
// Center, Guards & wings / Bigs, or one group where everyone flexes. Each
// group is its own circular queue, and the players on court are a window over
// each queue that moves forward each sub: whoever has been on longest comes
// out and whoever has sat longest goes in, so a guard only ever swaps with a
// guard, a center with a center, and so on. The queues run straight through
// halftime. The last few shifts of the game are left to the coach.
//
// Pure functions only (no React, no fetch), so it can be tested with plain Node:
// `pnpm --filter @workspace/baseball-lineup run test:basketball-rotation`.

export type CourtSpot = 1 | 2 | 3 | 4 | 5;
export type GuardPosition = "1" | "2";
/** A position group key: "guard", "front", "forward", "center", "perimeter", "big" or "all". */
export type BasketballRole = string;

export interface PositionGroup {
  key: BasketballRole;
  /** Plural, for headings: "Guards". */
  label: string;
  /** One player: "Guard". */
  one: string;
  /** Initial for tight spaces: "G". */
  short: string;
  /** The court spots this group plays, in order. */
  spots: CourtSpot[];
}

export type GroupLayoutId = "guards-front" | "guards-forwards-center" | "perimeter-bigs" | "five-out";

export interface GroupLayout {
  id: GroupLayoutId;
  label: string;
  description: string;
  groups: PositionGroup[];
}

const GUARDS: PositionGroup = { key: "guard", label: "Guards", one: "Guard", short: "G", spots: [1, 2] };

export const GROUP_LAYOUTS: Record<GroupLayoutId, GroupLayout> = {
  "guards-front": {
    id: "guards-front",
    label: "Guards / Front",
    description: "Guards play the 1–2; front-court players flex across the 3–5 (tag your 4s and 5s as Big).",
    groups: [GUARDS, { key: "front", label: "Front", one: "Front", short: "F", spots: [3, 4, 5] }],
  },
  "guards-forwards-center": {
    id: "guards-forwards-center",
    label: "Guards / Forwards / Center",
    description: "2 guards (1–2), 2 forwards (3–4) and a center (5).",
    groups: [
      GUARDS,
      { key: "forward", label: "Forwards", one: "Forward", short: "F", spots: [3, 4] },
      { key: "center", label: "Center", one: "Center", short: "C", spots: [5] },
    ],
  },
  "perimeter-bigs": {
    id: "perimeter-bigs",
    label: "Guards & wings / Bigs",
    description: "Guards and wings play the 1–3; bigs play the 4–5.",
    groups: [
      { key: "perimeter", label: "Guards & wings", one: "Guard/wing", short: "G", spots: [1, 2, 3] },
      { key: "big", label: "Bigs", one: "Big", short: "B", spots: [4, 5] },
    ],
  },
  "five-out": {
    id: "five-out",
    label: "Everyone flexes",
    description: "One group: anyone plays 1–5, and subs rotate the whole roster.",
    groups: [{ key: "all", label: "Players", one: "Player", short: "P", spots: [1, 2, 3, 4, 5] }],
  },
};

export const GROUP_LAYOUT_IDS = Object.keys(GROUP_LAYOUTS) as GroupLayoutId[];
export const ALL_ROLE_KEYS = [...new Set(GROUP_LAYOUT_IDS.flatMap((id) => GROUP_LAYOUTS[id].groups.map((g) => g.key)))];

export function isGroupLayoutId(value: unknown): value is GroupLayoutId {
  return typeof value === "string" && value in GROUP_LAYOUTS;
}

export interface BasketballPlayer {
  id: string;
  name: string;
  role: BasketballRole;
  /** A 4/5 who can anchor the paint (used by the front court and spot placement). */
  big?: boolean;
  /** Optional: which guard spot they play. */
  position?: GuardPosition | null;
}

export interface BasketballSettings {
  halfMinutes: number;
  shiftMinutes: number;
  /** Guards / Front layout only: how many of each are on court (default 2 + 3). */
  guardSpots: number;
  frontSpots: number;
  /** Shifts at the end of the game left to the coach. */
  flexShifts: number;
  /** Players subbed in (and out) each shift, 1–5. Default 2. */
  subSize?: number;
  /** How the five spots are grouped. Default Guards / Front. */
  groupLayout?: GroupLayoutId;
}

export const DEFAULT_BASKETBALL_SETTINGS: BasketballSettings = {
  halfMinutes: 20,
  shiftMinutes: 2.5,
  guardSpots: 2,
  frontSpots: 3,
  flexShifts: 1,
  subSize: 2,
  groupLayout: "guards-front",
};

export const MIN_SUB_SIZE = 1;
export const MAX_SUB_SIZE = 5;

/** The position groups in use, with Guards / Front sized by the spot settings. */
export function groupsFor(settings: Pick<BasketballSettings, "groupLayout" | "guardSpots" | "frontSpots">): PositionGroup[] {
  const layout = GROUP_LAYOUTS[settings.groupLayout ?? "guards-front"] ?? GROUP_LAYOUTS["guards-front"];
  if (layout.id !== "guards-front") return layout.groups;
  const g = Math.max(0, Math.floor(settings.guardSpots));
  const f = Math.max(0, Math.floor(settings.frontSpots));
  const spots = Array.from({ length: g + f }, (_, i) => Math.min(5, i + 1) as CourtSpot);
  return [
    { ...layout.groups[0], spots: spots.slice(0, g) },
    { ...layout.groups[1], spots: spots.slice(g) },
  ];
}

/**
 * A player's group in a layout. Roles saved under another layout are carried
 * over sensibly (a Big front-court player becomes a Center or a Big, a guard
 * stays a guard, and so on).
 */
export function roleIn(layoutId: GroupLayoutId | undefined, player: Pick<BasketballPlayer, "role" | "big" | "position">): BasketballRole {
  const layout = GROUP_LAYOUTS[layoutId ?? "guards-front"] ?? GROUP_LAYOUTS["guards-front"];
  const keys = layout.groups.map((g) => g.key);
  if (keys.includes(player.role)) return player.role;
  const guardish = player.role === "guard" || (player.role === "perimeter" && !!player.position) || (player.role === "all" && !!player.position);
  const big = !!player.big || player.role === "center" || player.role === "big";
  switch (layout.id) {
    case "guards-front":
      return guardish || player.role === "perimeter" ? "guard" : "front";
    case "guards-forwards-center":
      return guardish ? "guard" : big ? "center" : "forward";
    case "perimeter-bigs":
      return big ? "big" : "perimeter";
    case "five-out":
      return "all";
  }
}

/**
 * How many players of each group change on the `subNumber`-th sub (1-based)
 * when subbing `subSize` at a time. The sub is split evenly across the groups
 * that have someone on the bench (2 at a time with Guards / Front = one of
 * each); any extra rotates between groups from sub to sub, starting after the
 * first group (1 at a time = front, guard, front, …). A group can't change
 * more players than it has on court or on the bench; what it can't take goes
 * to the others.
 */
export function subSplit(subNumber: number, subSize: number, groups: { queue: number; spots: number }[]): number[] {
  const caps = groups.map((g) => Math.min(g.spots, Math.max(0, g.queue - g.spots)));
  const n = groups.length;
  const k = Math.max(0, Math.min(Math.floor(subSize), caps.reduce((a, b) => a + b, 0)));
  const counts = groups.map(() => Math.floor(k / Math.max(1, n)));
  const extra = n > 0 ? k % n : 0;
  const start = n > 0 ? (subNumber * Math.max(1, extra)) % n : 0;
  for (let i = 0; i < extra; i++) counts[(start + i) % n] += 1;
  // Move what a group can't take to the next groups with room.
  let spill = 0;
  for (let i = 0; i < n; i++) {
    if (counts[i] > caps[i]) {
      spill += counts[i] - caps[i];
      counts[i] = caps[i];
    }
  }
  for (let step = 0; spill > 0 && step < n; step++) {
    const i = (start + step) % n;
    const room = caps[i] - counts[i];
    const add = Math.min(room, spill);
    counts[i] += add;
    spill -= add;
  }
  return counts;
}

export interface RotationInput {
  players: BasketballPlayer[];
  settings: BasketballSettings;
  /** Starting order, player ids across all groups (each group keeps this order). */
  order?: string[];
  /** Older saves: per-queue orders for Guards / Front. Used when `order` is missing. */
  guardOrder?: string[];
  frontOrder?: string[];
  absentIds?: string[];
}

export interface RowGroup {
  key: BasketballRole;
  label: string;
  /** Player ids on court in this group. */
  ids: string[];
  /** Their names, sorted. */
  names: string[];
}

export interface RotationRow {
  /** 0-based across the whole game. */
  shift: number;
  half: 1 | 2;
  /** Game clock at the start of the shift, counting down: "20:00". */
  clock: string;
  minutes: number;
  flex: boolean;
  /** On court by group (empty on flex rows). */
  groups: RowGroup[];
  bench: string[];
  in: string[];
  out: string[];
}

export interface MinutesLine {
  id: string;
  name: string;
  role: BasketballRole;
  /** The role's name in this layout: "Guard", "Center", … */
  roleLabel: string;
  big: boolean;
  /** Set when this player is filling a spot outside their group today: that group's name. */
  playingAs: string | null;
  minutes: number;
  longestSit: number;
  /** Clock and half where the longest sit starts, e.g. "1st half 17:30". */
  longestSitFrom: string | null;
}

export interface RotationResult {
  groups: PositionGroup[];
  halves: { half: 1 | 2; rows: RotationRow[] }[];
  minutes: MinutesLine[];
  flexSuggestion: string[];
  warnings: string[];
  /** The queues actually used, by group key, ids in starting order (after any borrowing). */
  queues: Record<string, string[]>;
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

/** The order rule for a group's queue, if it has one. */
function windowRule(group: PositionGroup): ((w: BasketballPlayer[]) => boolean) | null {
  if (group.key === "guard") return guardWindowOk;
  if (group.key === "front") return frontWindowOk;
  return null;
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

/** Players with their role resolved for the settings' layout. */
export function withLayoutRoles(players: BasketballPlayer[], settings: Pick<BasketballSettings, "groupLayout">): BasketballPlayer[] {
  return players.map((p) => ({ ...p, role: roleIn(settings.groupLayout, p) }));
}

/** A fresh random starting order (all groups) that follows the 1/2 and Big rules where possible. */
export function reshuffleStartingOrder(
  players: BasketballPlayer[],
  settings: BasketballSettings,
  absentIds: string[] = [],
  random: () => number = Math.random,
): string[] {
  const absent = new Set(absentIds);
  const all = withLayoutRoles(players, settings);
  const present = all.filter(p => !absent.has(p.id));
  const order: BasketballPlayer[] = [];
  for (const group of groupsFor(settings)) {
    const members = present.filter(p => p.role === group.key);
    const rule = windowRule(group);
    order.push(...((rule && arrangeQueue(members, group.spots.length, rule, random)) || shuffled(members, random)));
  }
  // Absent players keep a place at the end so they slot back in when they return.
  return [...order, ...all.filter(p => absent.has(p.id))].map(p => p.id);
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
const nameList = (ps: { name: string }[]) =>
  ps.length <= 2 ? ps.map(p => p.name).join(" and ") : `${ps.slice(0, -1).map(p => p.name).join(", ")} and ${ps[ps.length - 1].name}`;

/**
 * The starting queues by group, after moving players from a group with extras
 * into a group that's short (with a warning). Shared by the sheet and the live game.
 */
export function startingQueues(input: RotationInput): {
  groups: PositionGroup[];
  queues: BasketballPlayer[][];
  spots: number[];
  present: BasketballPlayer[];
  playingAs: Map<string, string>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const groups = groupsFor(input.settings);
  const absent = new Set(input.absentIds ?? []);
  const present = withLayoutRoles(input.players, input.settings).filter(p => !absent.has(p.id) && p.name.trim());
  const order = input.order ?? [...(input.guardOrder ?? []), ...(input.frontOrder ?? [])];
  const queues = groups.map(g => ordered(present.filter(p => p.role === g.key), order));
  const here = queues.map(q => q.length);
  const playingAs = new Map<string, string>();

  groups.forEach((group, gi) => {
    const needed = group.spots.length;
    const moved: { player: BasketballPlayer; from: PositionGroup }[] = [];
    while (queues[gi].length < needed) {
      // Take from whichever group has the most to spare.
      let donor = -1;
      for (let j = 0; j < groups.length; j++) {
        if (j === gi) continue;
        const spare = queues[j].length - groups[j].spots.length;
        if (spare > 0 && (donor < 0 || spare > queues[donor].length - groups[donor].spots.length)) donor = j;
      }
      if (donor < 0) break;
      const wantsBig = group.spots.includes(5) && !group.spots.includes(1);
      const pool = [...queues[donor]].reverse();
      const pick = pool.find(p => (wantsBig ? !!p.big : !p.big)) ?? pool[0];
      queues[donor] = queues[donor].filter(p => p !== pick);
      queues[gi] = [...queues[gi], pick];
      playingAs.set(pick.id, group.one);
      moved.push({ player: pick, from: groups[donor] });
    }
    if (moved.length > 0) {
      const verb = moved.length === 1 ? "fills" : "fill";
      const fromLabel = moved[0].from.one;
      warnings.push(here[gi] === 0
        ? `Nobody here is set as ${article(group.one)}, so ${nameList(moved.map(m => m.player))} (${fromLabel}) ${verb} in at ${group.one.toLowerCase()}. Set each player's role to fix this.`
        : `Only ${plural(here[gi], group.one.toLowerCase())} here, so ${nameList(moved.map(m => m.player))} (${fromLabel}) ${verb} in at ${group.one.toLowerCase()}.`);
    }
  });

  const spots = groups.map((g, i) => Math.min(g.spots.length, queues[i].length));
  const totalSpots = groups.reduce((n, g) => n + g.spots.length, 0);
  const filled = spots.reduce((a, b) => a + b, 0);
  if (filled < totalSpots) {
    warnings.push(`Only ${present.length} players here for ${totalSpots} spots, so the team plays short-handed.`);
  }
  return { groups, queues, spots, present, playingAs, warnings };
}

export function buildRotation(input: RotationInput): RotationResult {
  const warnings: string[] = [];
  const settings = {
    ...input.settings,
    guardSpots: Math.floor(input.settings.guardSpots),
    frontSpots: Math.floor(input.settings.frontSpots),
    flexShifts: Math.floor(input.settings.flexShifts),
  };
  const empty: RotationResult = { groups: groupsFor(settings), halves: [], minutes: [], flexSuggestion: [], warnings, queues: {} };

  const settingsError = validSettings(settings);
  if (settingsError) {
    warnings.push(settingsError);
    return empty;
  }
  const start = startingQueues({ ...input, settings });
  if (start.present.length === 0) {
    warnings.push("No players are marked present.");
    return empty;
  }
  const { groups, queues, spots, present, playingAs } = start;
  warnings.push(...start.warnings);

  groups.forEach((group, gi) => {
    const rule = windowRule(group);
    if (!rule || spots[gi] < 1) return;
    if (group.key === "guard") {
      if (spots[gi] >= 2 && !queueIsValid(queues[gi], spots[gi], rule)) {
        const fixable = arrangeQueue(queues[gi], spots[gi], rule) !== null;
        warnings.push(fixable
          ? "In this guard order, two guards tagged the same position end up on court together. Reshuffle or drag to fix it."
          : "The guards' 1/2 tags can't alternate with this group, so some shifts pair two of the same position.");
      }
    } else if (queues[gi].some(p => p.big) && !queueIsValid(queues[gi], spots[gi], rule)) {
      const fixable = arrangeQueue(queues[gi], spots[gi], rule) !== null;
      warnings.push(fixable
        ? "In this front-court order, some shifts have no Big on court. Reshuffle or drag to fix it."
        : `Not enough Bigs to put one in every group of ${spots[gi]}, so some shifts have no Big on court.`);
    }
  });

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
  const windowAt = (queue: BasketballPlayer[], n: number, at: number) =>
    queue.length <= n ? queue.map(p => p.id) : Array.from({ length: n }, (_, j) => queue[(at + j) % queue.length].id);

  // How far each queue's on-court window has moved by each shift.
  const subSize = Math.floor(settings.subSize ?? 2);
  const sizes = queues.map((q, i) => ({ queue: q.length, spots: spots[i] }));
  const most = subSplit(1, MAX_SUB_SIZE, sizes).reduce((a, b) => a + b, 0);
  if (subSize < MIN_SUB_SIZE || subSize > MAX_SUB_SIZE) {
    warnings.push(`Subs at a time must be ${MIN_SUB_SIZE} to ${MAX_SUB_SIZE}.`);
  } else if (subSize > most && most > 0) {
    warnings.push(`Only ${plural(most, "player")} can sub at once with this group, so subs are ${most} at a time.`);
  }
  const starts: number[][] = [queues.map(() => 0)];
  for (let shift = 1; shift < totalShifts; shift++) {
    const split = subSplit(shift, subSize, sizes);
    starts.push(starts[shift - 1].map((s, i) => s + split[i]));
  }

  const halves: RotationResult["halves"] = [{ half: 1, rows: [] }, { half: 2, rows: [] }];
  const onCourtByShift: Set<string>[] = [];
  let previous: Set<string> | null = null;
  for (let shift = 0; shift < totalShifts; shift++) {
    const half = shift < shiftLengths.length ? 1 : 2;
    const index = shift % shiftLengths.length;
    const elapsed = shiftLengths.slice(0, index).reduce((sum, m) => sum + m, 0);
    const flex = shift >= firstFlex;
    const byGroup = queues.map((q, i) => windowAt(q, spots[i], starts[shift][i]));
    const on = new Set(byGroup.flat());
    onCourtByShift.push(on);
    const bench = present.filter(p => !on.has(p.id)).map(p => p.id);
    halves[half - 1].rows.push({
      shift,
      half,
      clock: formatClock(settings.halfMinutes - elapsed),
      minutes: shiftLengths[index],
      flex,
      groups: groups.map((g, i) => ({ key: g.key, label: g.label, ids: flex ? [] : byGroup[i], names: flex ? [] : names(byGroup[i]) })),
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
  const roleLabel = new Map(groups.map(g => [g.key, g.one]));

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
      roleLabel: roleLabel.get(p.role) ?? p.role,
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
    groups,
    halves,
    minutes,
    flexSuggestion,
    warnings,
    queues: Object.fromEntries(groups.map((g, i) => [g.key, queues[i].map(p => p.id)])),
  };
}

/** Player ids in starting order: saved order first, then anyone new in roster order. */
export function startingOrder(players: BasketballPlayer[], order: string[] | undefined): string[] {
  return ordered(players, order).map(p => p.id);
}

/**
 * Put one group's on-court players on its spots. A guard tagged 1 or 2 takes
 * that spot when the group has it; Bigs take the group's highest spots (the 5,
 * then the 4) and everyone else the lowest (a non-Big at the 3 in the front
 * court). Ties go by name.
 */
function placeGroup(
  ids: string[],
  groupSpots: CourtSpot[],
  byId: Map<string, BasketballPlayer>,
  taken: Map<CourtSpot, string>,
): string[] {
  const name = (id: string) => byId.get(id)?.name ?? id;
  const free = () => groupSpots.filter(s => !taken.has(s));
  const left: string[] = [];
  // Tagged guards first, to their spot.
  const tagged = ids.filter(id => {
    const tag = byId.get(id)?.position;
    return tag && groupSpots.includes(Number(tag) as CourtSpot);
  }).sort((a, b) => name(a).localeCompare(name(b)));
  for (const id of tagged) {
    const spot = Number(byId.get(id)!.position) as CourtSpot;
    if (!taken.has(spot)) taken.set(spot, id);
    else left.push(id);
  }
  const rest = [...left, ...ids.filter(id => !tagged.includes(id))];
  const bigs = rest.filter(id => byId.get(id)?.big).sort((a, b) => name(a).localeCompare(name(b)));
  const others = rest.filter(id => !byId.get(id)?.big).sort((a, b) => name(a).localeCompare(name(b)));
  // Reserve the lowest spot for a non-Big when there is one; Bigs fill from the top.
  const unplaced: string[] = [];
  const lowFirst = (id: string) => {
    const spot = free()[0];
    if (spot) taken.set(spot, id);
    else unplaced.push(id);
  };
  const highFirst = (id: string) => {
    const f = free();
    const spot = f[f.length - 1];
    if (spot) taken.set(spot, id);
    else unplaced.push(id);
  };
  if (others.length) lowFirst(others.shift()!);
  for (const id of bigs) highFirst(id);
  for (const id of others) lowFirst(id);
  return unplaced;
}

/**
 * Put on-court players on the 1–5 spots, group by group. With the Guards /
 * Front layout: guards at the 1 and 2 (by their tag), a non-Big at the 3 and
 * Bigs at the 5 then 4. Players without a spot (odd spot counts) come last
 * with `spot: null`.
 */
export function assignSpots(
  onCourt: { ids: string[]; spots: CourtSpot[] }[],
  players: BasketballPlayer[],
): { spot: CourtSpot | null; id: string }[] {
  return stickySpots(onCourt, players, null);
}

/**
 * Like assignSpots, but players who were already on court keep the spot they
 * had (`previous`: player id → spot) if it's still one of their group's spots.
 * Players coming in take the open spots by the same rules.
 */
export function stickySpots(
  onCourt: { ids: string[]; spots: CourtSpot[] }[],
  players: BasketballPlayer[],
  previous: Map<string, CourtSpot> | null,
): { spot: CourtSpot | null; id: string }[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const taken = new Map<CourtSpot, string>();
  const unplaced: string[] = [];
  for (const group of onCourt) {
    const fresh: string[] = [];
    for (const id of group.ids) {
      const spot = previous?.get(id);
      if (spot && group.spots.includes(spot) && !taken.has(spot)) taken.set(spot, id);
      else fresh.push(id);
    }
    unplaced.push(...placeGroup(fresh, group.spots, byId, taken));
  }
  const spots: { spot: CourtSpot | null; id: string }[] = ([1, 2, 3, 4, 5] as CourtSpot[])
    .filter((s) => taken.has(s))
    .map((s) => ({ spot: s, id: taken.get(s)! }));
  for (const id of unplaced) spots.push({ spot: null, id });
  return spots;
}

/** Spot labels for a layout: "PG", "SG", … with the group initial for flexible spots. */
export const SPOT_CODES: Record<CourtSpot, string> = { 1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C" };

/**
 * Each group's present players in starting order (no fill-ins), for the
 * starting-order lists. `reorder` gives back the combined order after one
 * group's list changes.
 */
export function groupedQueues(
  players: BasketballPlayer[],
  settings: BasketballSettings,
  order: string[],
  absentIds: string[],
): { group: PositionGroup; players: BasketballPlayer[] }[] {
  const absent = new Set(absentIds);
  const present = withLayoutRoles(players, settings).filter(p => !absent.has(p.id));
  return groupsFor(settings).map(group => ({ group, players: ordered(present.filter(p => p.role === group.key), order) }));
}

export function reorderGroup(
  queues: { players: BasketballPlayer[] }[],
  groupIndex: number,
  ids: string[],
  allOrder: string[],
): string[] {
  const next = queues.flatMap((q, i) => (i === groupIndex ? ids : q.players.map(p => p.id)));
  // Keep anyone not listed (absent players) after, in their old order.
  return [...next, ...allOrder.filter(id => !next.includes(id))];
}

/**
 * Each non-flex shift's spot → player id, carried forward so players who stay
 * on keep their spot (used by the game grid and the printed sheets).
 */
export function spotsByShift(result: RotationResult, players: BasketballPlayer[]): Map<number, Map<CourtSpot, string>> {
  const map = new Map<number, Map<CourtSpot, string>>();
  let previous: Map<string, CourtSpot> | null = null;
  for (const row of result.halves.flatMap(h => h.rows)) {
    if (row.flex) continue;
    const spots = stickySpots(result.groups.map((g, i) => ({ ids: row.groups[i]?.ids ?? [], spots: g.spots })), players, previous);
    const placed = spots.filter((x): x is { spot: CourtSpot; id: string } => x.spot !== null);
    previous = new Map(placed.map(x => [x.id, x.spot]));
    map.set(row.shift, new Map(placed.map(x => [x.spot, x.id])));
  }
  return map;
}
