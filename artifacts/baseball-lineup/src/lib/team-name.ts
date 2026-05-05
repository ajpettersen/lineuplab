/**
 * Trim youth-baseball "modifier" suffixes off a team name so on-screen
 * matchups read as a clean "Edina vs Minnetonka" instead of the full
 * "Edina Green 10AA vs Minnetonka 10AA Blue". We strip from the END so
 * compound city names ("Lakeville South") survive — a token only counts
 * as a modifier if it matches a known color word OR a youth age/level
 * code (10AA, 12U, U10, 11A, 13B, etc.). The first non-matching token
 * stops the strip, so "Wilsonville Blazers" stays intact (Blazers is
 * the mascot, not a modifier). Always returns at least the first word
 * so we never collapse to an empty string.
 *
 * Used by the Field Display header AND the Dashboard hero/list cards
 * so coaches see consistent short names everywhere on game day.
 */

const TEAM_MODIFIER_COLORS = new Set([
  "red", "blue", "green", "gold", "black", "white", "orange", "purple",
  "yellow", "silver", "maroon", "navy", "crimson", "gray", "grey", "pink",
  "teal", "royal", "scarlet", "cardinal", "carolina", "forest",
]);

// e.g. "10AA", "12U", "U10", "11A", "13B", "8C", "AAA", "AA". Tested
// case-insensitively (token is upper-cased before .test) so coaches who
// type "12u" or "u10" still get the same shortening.
const TEAM_LEVEL_RE = /^(?:\d{1,2}[A-Z]{1,3}|U\d{1,2}|A{1,3}|B|C)$/;

export function shortenTeamName(name: string | null | undefined): string {
  if (!name) return "";
  const tokens = name.trim().split(/\s+/);
  if (tokens.length <= 1) return name.trim();
  // Walk from the right, dropping modifier tokens until we hit a
  // "real" word. Don't strip below the first token (so an all-modifier
  // tail like "Blue 12U" still leaves "Blue" rather than collapsing
  // to empty).
  let end = tokens.length;
  while (end > 1) {
    // Strip trailing punctuation (commas, periods) before classifying
    // so "Edina, 10AA" still recognises "10AA" as a level token.
    const raw = tokens[end - 1].replace(/[.,;:]+$/, "");
    const isColor = TEAM_MODIFIER_COLORS.has(raw.toLowerCase());
    const isLevel = TEAM_LEVEL_RE.test(raw.toUpperCase());
    if (!isColor && !isLevel) break;
    end -= 1;
  }
  return tokens.slice(0, end).join(" ");
}
