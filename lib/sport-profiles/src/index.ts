/**
 * Sport profile registry — the single source of truth for everything that
 * differs between the sports Lineup Lab supports. A team picks ONE sport
 * (`team_settings.sport`, default "baseball") and the rest of the app reads
 * its profile to decide:
 *   - which positions exist (and their labels/groupings),
 *   - what a "period" is called (Inning vs Quarter) and how many there are,
 *   - how many players are on the field/court at once,
 *   - which baseball-only features to hide (pitching, batting order, etc.),
 *   - sport-appropriate terminology for shared UI.
 *
 * Adding a new sport = add one entry to SPORT_PROFILES. Nothing baseball-
 * specific is hard-coded outside this file's data.
 */

export type SportId = "baseball" | "basketball";

export interface SportPosition {
  /** Canonical code stored in the DB (e.g. "SS", "PG"). */
  code: string;
  /** Full human label (e.g. "Shortstop", "Point Guard"). */
  label: string;
  /** Short label for chips/columns (usually equals `code`). */
  short: string;
  /** Grouping used in "by position" tallies (e.g. "Infield", "Guard"). */
  group: string;
}

export interface SportFeatures {
  /** Baseball: pitcher rotation + the per-player canPitch gate. */
  pitching: boolean;
  /** Baseball: a batting order is generated and shown. */
  battingOrder: boolean;
  /** Baseball: GameChanger box-score screenshot import. */
  boxScoreImport: boolean;
  /** Baseball: tournament mode with pitch rules. */
  tournaments: boolean;
  /** Baseball: per-pitcher pitch counts + rest tiers. */
  pitchCounts: boolean;
}

export interface SportTerms {
  /** What the generated assignment is called. */
  lineupNoun: string;
  /** Where players play. */
  fieldNoun: string;
  /** Heading for the per-position playing-time tally. */
  timeByPositionLabel: string;
  /** Verb-y label for the generate action. */
  generateLabel: string;
}

export interface SportProfile {
  id: SportId;
  /** Display label for the sport itself. */
  label: string;

  // --- Periods (innings vs quarters) ---
  periodLabel: string;
  periodLabelPlural: string;
  periodLabelShort: string;
  defaultPeriods: number;
  minPeriods: number;
  maxPeriods: number;

  // --- On-field / on-court shape ---
  /** Default number of players on the field/court each period. */
  onFieldCount: number;
  /** The positions filled each period, in render order. */
  positions: SportPosition[];
  benchLabel: string;

  features: SportFeatures;
  terms: SportTerms;
}

const BASEBALL_POSITIONS: SportPosition[] = [
  { code: "P", label: "Pitcher", short: "P", group: "Battery" },
  { code: "C", label: "Catcher", short: "C", group: "Battery" },
  { code: "1B", label: "First Base", short: "1B", group: "Infield" },
  { code: "2B", label: "Second Base", short: "2B", group: "Infield" },
  { code: "3B", label: "Third Base", short: "3B", group: "Infield" },
  { code: "SS", label: "Shortstop", short: "SS", group: "Infield" },
  { code: "LF", label: "Left Field", short: "LF", group: "Outfield" },
  { code: "CF", label: "Center Field", short: "CF", group: "Outfield" },
  { code: "RF", label: "Right Field", short: "RF", group: "Outfield" },
];

const BASKETBALL_POSITIONS: SportPosition[] = [
  { code: "PG", label: "Point Guard", short: "PG", group: "Guard" },
  { code: "SG", label: "Shooting Guard", short: "SG", group: "Guard" },
  { code: "SF", label: "Small Forward", short: "SF", group: "Forward" },
  { code: "PF", label: "Power Forward", short: "PF", group: "Forward" },
  { code: "C", label: "Center", short: "C", group: "Center" },
];

const BASEBALL_PROFILE: SportProfile = {
  id: "baseball",
  label: "Baseball / Softball",
  periodLabel: "Inning",
  periodLabelPlural: "Innings",
  periodLabelShort: "Inn",
  defaultPeriods: 6,
  minPeriods: 1,
  maxPeriods: 12,
  onFieldCount: 9,
  positions: BASEBALL_POSITIONS,
  benchLabel: "Bench",
  features: {
    pitching: true,
    battingOrder: true,
    boxScoreImport: true,
    tournaments: true,
    pitchCounts: true,
  },
  terms: {
    lineupNoun: "Lineup",
    fieldNoun: "Field",
    timeByPositionLabel: "Innings by Position",
    generateLabel: "Generate Lineup",
  },
};

const BASKETBALL_PROFILE: SportProfile = {
  id: "basketball",
  label: "Basketball",
  periodLabel: "Quarter",
  periodLabelPlural: "Quarters",
  periodLabelShort: "Qtr",
  defaultPeriods: 4,
  minPeriods: 1,
  maxPeriods: 8,
  onFieldCount: 5,
  positions: BASKETBALL_POSITIONS,
  benchLabel: "Bench",
  features: {
    pitching: false,
    battingOrder: false,
    boxScoreImport: false,
    tournaments: false,
    pitchCounts: false,
  },
  terms: {
    lineupNoun: "Rotation",
    fieldNoun: "Court",
    timeByPositionLabel: "Periods by Position",
    generateLabel: "Generate Rotation",
  },
};

export const SPORT_PROFILES: Record<SportId, SportProfile> = {
  baseball: BASEBALL_PROFILE,
  basketball: BASKETBALL_PROFILE,
};

export const SPORT_IDS: SportId[] = ["baseball", "basketball"];

export const DEFAULT_SPORT: SportId = "baseball";

/** Type guard for an unknown string. */
export function isSportId(value: unknown): value is SportId {
  return value === "baseball" || value === "basketball";
}

/**
 * Resolve a (possibly null/legacy) sport value to a profile. Anything we
 * don't recognize falls back to baseball so existing teams are never broken.
 */
export function getSportProfile(sport: unknown): SportProfile {
  return isSportId(sport) ? SPORT_PROFILES[sport] : BASEBALL_PROFILE;
}

/** The position codes filled each period for a sport, in render order. */
export function sportPositionCodes(sport: unknown): string[] {
  return getSportProfile(sport).positions.map((p) => p.code);
}
