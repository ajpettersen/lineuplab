/**
 * Free-form pitch-rule helpers for the UI. Mirrors the server-side
 * `STANDARD_REST_TIERS` template — kept here as a static constant so
 * the UI doesn't need a network round-trip to load Little League's
 * standard tiers.
 *
 * The actual availability math lives server-side in `pitch-rules.ts`;
 * the UI only consumes resolved `{dailyMax, restTiers}` from the
 * tournament detail endpoint.
 */
export type RestTier = { maxPitches: number; daysRest: number };

/**
 * Little League's published rest tiers. Used as the "Use standard
 * rest tiers" template button in Settings + tournament edit dialogs.
 * Note: the catch-all tier uses 999 instead of Infinity so the value
 * survives JSON serialization.
 */
export const STANDARD_REST_TIERS: RestTier[] = [
  { maxPitches: 20, daysRest: 0 },
  { maxPitches: 35, daysRest: 1 },
  { maxPitches: 50, daysRest: 2 },
  { maxPitches: 65, daysRest: 3 },
  { maxPitches: 999, daysRest: 4 },
];
