// Playing-time targets for one basketball game (court display, item "minutes
// vs. target", and the planner's season nudges).
//
// The base target is an even share of the game's court time among the
// players who are available. Season minutes nudge it: a player whose
// minutes per game so far are below the team's average gets a little more
// (half the per-game gap, at most 4 minutes), and one above it a little
// less. The nudges always add up to zero, so the team's total stays the
// length of the game times five.
//
// Pure functions, tested in test/basketball-targets.test.ts.

export interface SeasonLine {
  /** Seconds played in earlier games. */
  seconds: number;
  /** Games they played in earlier (available games). */
  games: number;
}

export interface MinuteTarget {
  targetSec: number;
  /** The season nudge included in targetSec (positive = gets more). */
  adjustSec: number;
}

export const MAX_SEASON_NUDGE_SEC = 4 * 60;
const NUDGE_SHARE = 0.5;

export function minuteTargets(
  ids: string[],
  gameSec: number,
  season: Map<string, SeasonLine> | null = null,
  onCourt = 5,
): Map<string, MinuteTarget> {
  const out = new Map<string, MinuteTarget>();
  if (ids.length === 0) return out;
  const total = gameSec * Math.min(onCourt, ids.length);
  const base = total / ids.length;
  // Per-game rate for players with history; newcomers aren't nudged.
  const rates = new Map<string, number>();
  for (const id of ids) {
    const line = season?.get(id);
    if (line && line.games > 0) rates.set(id, line.seconds / line.games);
  }
  let nudges = ids.map(() => 0);
  if (rates.size >= 2) {
    const avg = [...rates.values()].reduce((a, b) => a + b, 0) / rates.size;
    nudges = ids.map((id) => {
      const rate = rates.get(id);
      if (rate === undefined) return 0;
      return Math.max(-MAX_SEASON_NUDGE_SEC, Math.min(MAX_SEASON_NUDGE_SEC, (avg - rate) * NUDGE_SHARE));
    });
    // Re-center so the nudges add up to zero.
    const mean = nudges.reduce((a, b) => a + b, 0) / ids.length;
    nudges = nudges.map((n) => n - mean);
  }
  ids.forEach((id, i) => {
    const targetSec = Math.max(0, Math.min(gameSec, base + nudges[i]));
    out.set(id, { targetSec, adjustSec: targetSec - base });
  });
  return out;
}

export type TargetStatus = "owed" | "on-track" | "over";

/** How far off pace counts as owed / over (in seconds). */
export const PACE_SLACK_SEC = 60;

/**
 * Where a player stands now. `elapsedShare` is how much of the game has been
 * played (0–1); by then they should have that share of their target.
 */
export function paceOf(playedSec: number, targetSec: number, elapsedShare: number): { expectedSec: number; owedSec: number; status: TargetStatus } {
  const share = Math.max(0, Math.min(1, elapsedShare));
  const expectedSec = targetSec * share;
  const owedSec = expectedSec - playedSec;
  const status: TargetStatus = owedSec > PACE_SLACK_SEC ? "owed" : owedSec < -PACE_SLACK_SEC ? "over" : "on-track";
  return { expectedSec, owedSec, status };
}

/**
 * Season minutes before a game: season totals minus what this game already
 * recorded (the court display saves as it goes).
 */
export function seasonBeforeGame(
  season: { playerId: number; seconds: number; games: number }[],
  thisGame: Map<number, number>,
): Map<string, SeasonLine> {
  return new Map(
    season.map((p) => {
      const now = thisGame.get(p.playerId) ?? 0;
      return [String(p.playerId), { seconds: Math.max(0, p.seconds - now), games: Math.max(0, p.games - (now > 0 ? 1 : 0)) }];
    }),
  );
}
