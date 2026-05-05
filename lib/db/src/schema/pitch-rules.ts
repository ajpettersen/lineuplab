/**
 * Pitch-count rule helpers for youth baseball.
 *
 * As of the free-form pitch-rule rewrite, this module no longer carries
 * a preset catalog — coaches transcribe per-tournament caps and rest
 * tiers directly. The `STANDARD_REST_TIERS` constant remains as a
 * one-click template the Settings UI can drop into a new tournament,
 * mirroring Little League's published tiers.
 *
 * Rest tiers map a single-day pitch total to required calendar days of
 * rest before the player can pitch again. If Sarah throws 51-65 pitches
 * Friday in tournament game 1, she needs 3 calendar days before her
 * next outing — a Saturday or Sunday game in the same tournament should
 * warn the coach.
 */

import type { RestTier } from "./team_settings";

export type { RestTier };

/**
 * Little League's published rest tiers. Used as the "Use standard
 * rest tiers" template in the Settings UI; not applied automatically
 * — coach must opt in by clicking the template button.
 */
export const STANDARD_REST_TIERS: RestTier[] = [
  { maxPitches: 20, daysRest: 0 },
  { maxPitches: 35, daysRest: 1 },
  { maxPitches: 50, daysRest: 2 },
  { maxPitches: 65, daysRest: 3 },
  // 999 acts as the catch-all tier (any total over the highest published
  // tier maps to this rest count). Avoids JSON-serializing Infinity.
  { maxPitches: 999, daysRest: 4 },
];

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
  /** Daily max actually applied. Null = no cap configured. */
  dailyMax: number | null;
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
 *
 * Both `dailyMax` and `restTiers` are nullable. Null `dailyMax` skips
 * the daily-cap math (`pitchesAvailableToday` will be `Infinity` —
 * callers should treat null `dailyMax` as "no cap configured" and not
 * render the X/Y meter). Null/empty `restTiers` skips rest enforcement.
 */
export function computePitcherAvailability({
  dailyMax,
  restTiers,
  outings,
  now,
}: {
  dailyMax: number | null;
  restTiers: RestTier[] | null;
  outings: PitcherOuting[];
  now: Date;
}): PitcherAvailability {
  const todayKey = dayKey(now);
  let pitchesToday = 0;
  for (const o of outings) {
    if (dayKey(o.date) === todayKey) pitchesToday += o.pitches;
  }

  // Find the most-restrictive prior-day outing — the one whose
  // required rest extends furthest into the future. If any such
  // window covers `now`, the player is resting.
  let restingUntil: PitcherAvailability["restingUntil"] = null;
  if (restTiers && restTiers.length > 0) {
    for (const o of outings) {
      if (dayKey(o.date) === todayKey) continue; // today doesn't impose rest on itself
      const daysRest = restDaysRequired(o.pitches, restTiers);
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
  }

  let pitchesAvailableToday: number;
  if (restingUntil) {
    pitchesAvailableToday = 0;
  } else if (dailyMax == null) {
    pitchesAvailableToday = Infinity;
  } else {
    pitchesAvailableToday = Math.max(0, dailyMax - pitchesToday);
  }

  return {
    pitchesToday,
    pitchesAvailableToday,
    dailyMax,
    restingUntil,
  };
}

export function restDaysRequired(pitches: number, restTiers: RestTier[]): number {
  if (pitches <= 0) return 0;
  if (restTiers.length === 0) return 0;
  for (const tier of restTiers) {
    if (pitches <= tier.maxPitches) return tier.daysRest;
  }
  return restTiers[restTiers.length - 1]?.daysRest ?? 0;
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
