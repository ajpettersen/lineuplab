/**
 * Pitch-count rule sets for youth baseball.
 *
 * Defaults below mirror the standard Little League pitching rules,
 * which are the most widely-cited reference set for youth baseball
 * (USSSA, PONY, AAU all publish similar tiers — exact numbers vary
 * by tournament). Coach can override per-team or per-tournament via
 * a custom `dailyPitchMax`.
 *
 * Rest tiers map a single-day pitch total to required calendar days
 * of rest before the player can pitch again. If Sarah throws 51-65
 * pitches Friday in tournament game 1, she needs 3 calendar days
 * before her next outing — a Saturday or Sunday game in the same
 * tournament should warn the coach.
 */

export type PitchRuleset = {
  key: string;
  label: string;
  /** Maximum pitches allowed in a single calendar day. */
  dailyMax: number;
  /**
   * Rest tiers ordered by ascending pitch threshold. Find the first
   * tier whose `maxPitches` is >= the player's day total to get the
   * required rest days.
   */
  restTiers: { maxPitches: number; daysRest: number }[];
};

const STANDARD_REST_TIERS = [
  { maxPitches: 20, daysRest: 0 },
  { maxPitches: 35, daysRest: 1 },
  { maxPitches: 50, daysRest: 2 },
  { maxPitches: 65, daysRest: 3 },
  // 66+ is the catch-all: 4 days regardless of how far over the cap.
  { maxPitches: Number.POSITIVE_INFINITY, daysRest: 4 },
];

export const PITCH_RULESETS: Record<string, PitchRuleset> = {
  littleLeague_7_8: {
    key: "littleLeague_7_8",
    label: "Little League 7-8U (50/day)",
    dailyMax: 50,
    restTiers: STANDARD_REST_TIERS,
  },
  littleLeague_9_10: {
    key: "littleLeague_9_10",
    label: "Little League 9-10U (75/day)",
    dailyMax: 75,
    restTiers: STANDARD_REST_TIERS,
  },
  littleLeague_11_12: {
    key: "littleLeague_11_12",
    label: "Little League 11-12U (85/day)",
    dailyMax: 85,
    restTiers: STANDARD_REST_TIERS,
  },
  littleLeague_13_16: {
    key: "littleLeague_13_16",
    label: "Little League 13-16U (95/day)",
    dailyMax: 95,
    restTiers: STANDARD_REST_TIERS,
  },
};

export const PITCH_RULESET_KEYS = Object.keys(PITCH_RULESETS);
export const DEFAULT_PITCH_RULESET = "littleLeague_11_12";

export type PitcherOuting = {
  /** Game date — what calendar day the pitches were thrown. */
  date: Date;
  pitches: number;
};

export type PitcherAvailability = {
  /** Pitches thrown today already (for awareness). */
  pitchesToday: number;
  /** Pitches still available within today's daily max. */
  pitchesAvailableToday: number;
  /** Daily max for the active ruleset (after override). */
  dailyMax: number;
  /**
   * If non-null, the player is on mandatory rest from a recent
   * outing — the date they're available again, plus the outing
   * date and pitch count that triggered it.
   */
  restingUntil: {
    availableOn: Date;
    fromOutingDate: Date;
    fromOutingPitches: number;
    daysRest: number;
  } | null;
};

/**
 * Walk through a player's prior outings + today's running count and
 * compute what they have left to throw.
 *
 * Pure function — no DB / clock access. Pass `now` explicitly so
 * unit tests are deterministic and timezone behavior is the caller's
 * responsibility.
 *
 * Calendar-day comparisons use the LOCAL day boundary (per the host's
 * timezone). For tournament weekends — the only place this matters —
 * coach + games + iPad are all in the same time zone, so this is the
 * right semantic.
 */
export function computePitcherAvailability({
  ruleset,
  dailyMaxOverride,
  outings,
  now,
}: {
  ruleset: PitchRuleset;
  dailyMaxOverride?: number | null;
  outings: PitcherOuting[];
  now: Date;
}): PitcherAvailability {
  const dailyMax =
    dailyMaxOverride !== null && dailyMaxOverride !== undefined
      ? dailyMaxOverride
      : ruleset.dailyMax;

  const todayKey = dayKey(now);
  let pitchesToday = 0;
  for (const o of outings) {
    if (dayKey(o.date) === todayKey) pitchesToday += o.pitches;
  }

  // Find the most-restrictive prior-day outing — the one whose
  // required rest extends furthest into the future. If any such
  // window covers `now`, the player is resting.
  let restingUntil: PitcherAvailability["restingUntil"] = null;
  for (const o of outings) {
    if (dayKey(o.date) === todayKey) continue; // today doesn't impose rest on itself
    const daysRest = restDaysRequired(o.pitches, ruleset);
    if (daysRest === 0) continue;
    const availableOn = addDays(startOfDay(o.date), daysRest + 1);
    if (availableOn.getTime() > startOfDay(now).getTime()) {
      if (
        !restingUntil ||
        availableOn.getTime() > restingUntil.availableOn.getTime()
      ) {
        restingUntil = {
          availableOn,
          fromOutingDate: o.date,
          fromOutingPitches: o.pitches,
          daysRest,
        };
      }
    }
  }

  const pitchesAvailableToday = restingUntil
    ? 0
    : Math.max(0, dailyMax - pitchesToday);

  return {
    pitchesToday,
    pitchesAvailableToday,
    dailyMax,
    restingUntil,
  };
}

export function restDaysRequired(pitches: number, ruleset: PitchRuleset): number {
  if (pitches <= 0) return 0;
  for (const tier of ruleset.restTiers) {
    if (pitches <= tier.maxPitches) return tier.daysRest;
  }
  return ruleset.restTiers[ruleset.restTiers.length - 1]?.daysRest ?? 0;
}

export function getRulesetOrDefault(key: string | null | undefined): PitchRuleset {
  if (key && PITCH_RULESETS[key]) return PITCH_RULESETS[key];
  return PITCH_RULESETS[DEFAULT_PITCH_RULESET]!;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dayKey(d: Date): string {
  // Local-day key (YYYY-MM-DD in host TZ).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
