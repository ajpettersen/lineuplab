/**
 * Display catalog of pitch-count rulesets, mirrored from the server's
 * authoritative `lib/db/src/schema/pitch-rules.ts`. We can't import the
 * server module directly because `@workspace/db` eagerly opens a pg
 * connection at module load. The actual rule MATH lives server-side —
 * this is just the label/dailyMax pair the UI needs to render selects
 * and budget summaries.
 *
 * Keep in sync with the server file. The set rarely changes (these are
 * Little League's standardized tiers).
 */
export type PitchRulesetMeta = {
  key: string;
  label: string;
  dailyMax: number;
};

export const PITCH_RULESETS: Record<string, PitchRulesetMeta> = {
  littleLeague_7_8: {
    key: "littleLeague_7_8",
    label: "Little League 7-8U (50/day)",
    dailyMax: 50,
  },
  littleLeague_9_10: {
    key: "littleLeague_9_10",
    label: "Little League 9-10U (75/day)",
    dailyMax: 75,
  },
  littleLeague_11_12: {
    key: "littleLeague_11_12",
    label: "Little League 11-12U (85/day)",
    dailyMax: 85,
  },
  littleLeague_13_16: {
    key: "littleLeague_13_16",
    label: "Little League 13-16U (95/day)",
    dailyMax: 95,
  },
};

export const PITCH_RULESET_OPTIONS = Object.values(PITCH_RULESETS);
export const DEFAULT_PITCH_RULESET = "littleLeague_11_12";
