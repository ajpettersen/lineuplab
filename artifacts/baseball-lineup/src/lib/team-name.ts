/**
 * Trim youth-baseball "modifier" tokens off a team name so on-screen
 * matchups read as a clean "Edina vs Minnetonka" instead of the full
 * "10AA Blue Minnetonka - Pettersen".
 *
 * Strategy:
 *   1. Drop any " - " / " – " / " — " coach/sub-team suffix
 *      ("Minnetonka - Pettersen" → "Minnetonka").
 *   2. Strip leading modifier tokens (color words like "Blue" or
 *      level codes like "10AA", "12U") so prefixes like
 *      "10AA Blue Minnetonka" collapse to "Minnetonka".
 *   3. Strip trailing modifier tokens the same way so suffixes like
 *      "Edina Green 10AA" collapse to "Edina".
 *   4. If the strip would empty the name, fall back to the original
 *      input untouched (per user request — better to show too much
 *      than nothing).
 *
 * Compound city names ("Lakeville South") survive because the strip
 * stops at the first non-modifier token from each side.
 *
 * Used everywhere a team or opponent name is displayed: Field Display,
 * Dashboard, Games list, Game Detail header / print / copy-from
 * dropdown.
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

function isModifier(token: string): boolean {
  const raw = token.replace(/^[.,;:]+|[.,;:]+$/g, "");
  if (!raw) return false;
  return (
    TEAM_MODIFIER_COLORS.has(raw.toLowerCase()) ||
    TEAM_LEVEL_RE.test(raw.toUpperCase())
  );
}

export function shortenTeamName(name: string | null | undefined): string {
  if (!name) return "";
  const original = name.trim();
  if (!original) return "";

  // 1. Drop coach/sub-team suffix after a dash separator.
  //    Match en-dash, em-dash, and ascii hyphen surrounded by spaces.
  const dashSplit = original.split(/\s+[-–—]\s+/);
  let working = dashSplit[0].trim();
  if (!working) working = original;

  const tokens = working.split(/\s+/);
  if (tokens.length <= 1) return working;

  // 2. Strip leading modifiers.
  let start = 0;
  while (start < tokens.length - 1 && isModifier(tokens[start])) {
    start += 1;
  }

  // 3. Strip trailing modifiers.
  let end = tokens.length;
  while (end > start + 1 && isModifier(tokens[end - 1])) {
    end -= 1;
  }

  const shortened = tokens.slice(start, end).join(" ").trim();
  // 4. Never collapse to empty — fall back to the original input.
  return shortened || original;
}
