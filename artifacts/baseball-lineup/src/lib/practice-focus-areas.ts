import { useTeamSettings } from "@/hooks/use-team-settings";

/**
 * Shared catalog of focus areas + drill types used by the practice
 * planner UI. Mirrored loosely on the server's AI prompt — keep these
 * keys in sync with `routes/practice-plan-ai.ts` so the model returns
 * focus-area keys we can render as chips here.
 *
 * The set is intentionally short (10 items) so the "pick what we're
 * working on today" multi-select doesn't overwhelm the coach.
 */
export type FocusAreaMeta = {
  key: string;
  label: string;
  /** Tailwind class for the chip background tint when active. */
  tint: string;
};

export const PRACTICE_FOCUS_AREAS: FocusAreaMeta[] = [
  { key: "hitting", label: "Hitting", tint: "bg-rose-100 text-rose-800 border-rose-200" },
  { key: "bunting", label: "Bunting", tint: "bg-pink-100 text-pink-800 border-pink-200" },
  { key: "baserunning", label: "Baserunning", tint: "bg-amber-100 text-amber-800 border-amber-200" },
  { key: "infield", label: "Infield", tint: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { key: "outfield", label: "Outfield", tint: "bg-teal-100 text-teal-800 border-teal-200" },
  { key: "pitching", label: "Pitching", tint: "bg-blue-100 text-blue-800 border-blue-200" },
  { key: "catching", label: "Catching", tint: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  { key: "situational", label: "Situational", tint: "bg-purple-100 text-purple-800 border-purple-200" },
  { key: "conditioning", label: "Conditioning", tint: "bg-orange-100 text-orange-800 border-orange-200" },
  { key: "team", label: "Team building", tint: "bg-slate-100 text-slate-800 border-slate-200" },
];

/** Basketball teams' focus areas. Keys must match the server's list in routes/practice-plan-ai.ts. */
export const BASKETBALL_PRACTICE_FOCUS_AREAS: FocusAreaMeta[] = [
  { key: "ball_handling", label: "Ball handling", tint: "bg-rose-100 text-rose-800 border-rose-200" },
  { key: "shooting", label: "Shooting", tint: "bg-pink-100 text-pink-800 border-pink-200" },
  { key: "layups", label: "Layups & finishing", tint: "bg-amber-100 text-amber-800 border-amber-200" },
  { key: "passing", label: "Passing", tint: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { key: "defense", label: "Defense", tint: "bg-teal-100 text-teal-800 border-teal-200" },
  { key: "rebounding", label: "Rebounding", tint: "bg-blue-100 text-blue-800 border-blue-200" },
  { key: "post_play", label: "Post play", tint: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  { key: "team_offense", label: "Team offense & transition", tint: "bg-purple-100 text-purple-800 border-purple-200" },
  { key: "conditioning", label: "Conditioning", tint: "bg-orange-100 text-orange-800 border-orange-200" },
  { key: "team", label: "Team building", tint: "bg-slate-100 text-slate-800 border-slate-200" },
];

/** The focus areas to offer for a team's sport. */
export function focusAreasFor(sport: string): FocusAreaMeta[] {
  return sport === "basketball" ? BASKETBALL_PRACTICE_FOCUS_AREAS : PRACTICE_FOCUS_AREAS;
}

export const FOCUS_AREA_BY_KEY: Record<string, FocusAreaMeta> = Object.fromEntries(
  [...BASKETBALL_PRACTICE_FOCUS_AREAS, ...PRACTICE_FOCUS_AREAS].map((f) => [f.key, f]),
);

export type DrillTypeMeta = {
  key: string;
  label: string;
  /** Tailwind class for the small badge next to the block title. */
  badge: string;
};

export const PRACTICE_DRILL_TYPES: DrillTypeMeta[] = [
  { key: "warmup", label: "Warm-up", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "drill", label: "Drill", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { key: "scrimmage", label: "Scrimmage", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "conditioning", label: "Conditioning", badge: "bg-orange-50 text-orange-700 border-orange-200" },
  { key: "meeting", label: "Meeting", badge: "bg-slate-50 text-slate-700 border-slate-200" },
];

export const DRILL_TYPE_BY_KEY: Record<string, DrillTypeMeta> = Object.fromEntries(
  PRACTICE_DRILL_TYPES.map((d) => [d.key, d]),
);

export const DEFAULT_PRACTICE_DURATION = 90;

/** Focus areas for the current team's sport. */
export function usePracticeFocusAreas(): FocusAreaMeta[] {
  const { sport } = useTeamSettings();
  return focusAreasFor(sport);
}
