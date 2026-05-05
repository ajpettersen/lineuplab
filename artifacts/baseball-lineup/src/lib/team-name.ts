/**
 * Trim youth-baseball "modifier" tokens off a team name so on-screen
 * matchups read as a clean "Edina vs Minnetonka" instead of the full
 * "10AA Blue Minnetonka - Pettersen".
 *
 * Strategy:
 *   1. Drop any " - " / " – " / " — " coach/sub-team suffix
 *      ("Minnetonka - Pettersen" → "Minnetonka").
 *   2. Find the longest contiguous run of NON-modifier tokens — that
 *      run is the city / mascot. Modifier tokens are color words
 *      ("Blue", "Gold") and youth level codes ("10AA", "12U", "U10").
 *   3. If no non-modifier tokens exist (e.g. the input was literally
 *      "10AA Blue"), fall back to the original input untouched —
 *      better to show too much than to show "Blue" as the team name.
 *
 * Compound city names ("Lakeville South") survive because we look for
 * the longest CONTIGUOUS run of non-modifier tokens.
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

  // 1. Drop coach/sub-team suffix after a dash separator. Match en-dash,
  //    em-dash, and ascii hyphen surrounded by spaces.
  const dashSplit = original.split(/\s+[-–—]\s+/);
  const working = dashSplit[0].trim() || original;

  const tokens = working.split(/\s+/);
  if (tokens.length <= 1) {
    // Single token — only return it if it isn't itself a modifier
    // (e.g. "Blue" alone shouldn't be displayed as a team name).
    return isModifier(tokens[0]) ? original : working;
  }

  // 2. Find the longest contiguous run of non-modifier tokens.
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let i = 0; i <= tokens.length; i += 1) {
    const isMod = i < tokens.length ? isModifier(tokens[i]) : true;
    if (!isMod && runStart === -1) {
      runStart = i;
    } else if (isMod && runStart !== -1) {
      const len = i - runStart;
      if (len > bestLen) {
        bestLen = len;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }

  // 3. No non-modifier tokens found → fall back to the original.
  if (bestStart === -1) return original;
  return tokens.slice(bestStart, bestStart + bestLen).join(" ");
}
