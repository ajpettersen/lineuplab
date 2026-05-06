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

/**
 * Returns true when `name` contains at least one token that isn't a
 * modifier (color / age-level code). Used by formatOpponentForMatchup
 * to decide which side of an "X at Y" iCal SUMMARY actually carries
 * the city/mascot.
 */
// Forward declaration so formatOpponentForMatchup (declared first) can
// call shortenTeamName (declared below). TypeScript hoists function
// declarations so this works at runtime; this comment is just a
// reader's nudge that the call ordering is intentional.
function hasCityToken(name: string): boolean {
  return name
    .split(/\s+/)
    .some((t) => t.length > 0 && !isModifier(t));
}

/**
 * Display-layer cleanup specifically for matchup headers
 * ("Us vs. Opponent"). Builds on shortenTeamName but additionally:
 *
 *  1. Strips a trailing parenthesized venue ("Westonka 10AA (Westonka)"
 *     → "Westonka 10AA") which leagues commonly tack on to iCal
 *     SUMMARY lines.
 *  2. When the opponent matches "X at Y" AND the X side has no real
 *     city token (only modifiers / coach suffix), prefers Y as the
 *     opponent — this catches league-imported away-games where the
 *     SUMMARY is "<our age/color> - <our coach> at <host>" and the
 *     iCal extractor stored the whole thing as the opponent because
 *     it couldn't recognize our team.
 *  3. After shortening, removes any tokens that overlap our own
 *     short team name so a duplicated "Minnetonka" or "Blue" doesn't
 *     show up on both sides of the "vs.".
 *
 * Falls back to the plain shortenTeamName() output (and ultimately
 * the raw opponent string) so we never render an empty matchup.
 */
export function formatOpponentForMatchup(
  opponent: string | null | undefined,
  ourTeamName: string | null | undefined,
): string {
  if (!opponent) return "";
  let candidate = opponent.trim();
  if (!candidate) return "";

  // 1. Strip trailing "(...)" venue.
  candidate = candidate.replace(/\s*\([^)]*\)\s*$/, "").trim();

  // 2. "X at Y" → prefer Y when X is all modifiers (very common
  //    away-game iCal pattern when the league shortened our team).
  const atMatch = candidate.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) {
    // Drop coach suffix from the left side before the city-token test
    // (the dash-suffix is OUR coach, not part of the team identity).
    const leftCore = atMatch[1].split(/\s+[-–—]\s+/)[0]?.trim() ?? "";
    const right = atMatch[2].trim();
    if (!hasCityToken(leftCore) && hasCityToken(right)) {
      candidate = right;
    }
  }

  let result = shortenTeamName(candidate) || candidate;

  // 3. Strip our-team tokens from result if they leaked in.
  const ourShort = shortenTeamName(ourTeamName ?? "");
  if (ourShort) {
    const ours = new Set(
      ourShort
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    );
    const tokens = result.split(/\s+/);
    const filtered = tokens.filter((t) => !ours.has(t.toLowerCase()));
    if (filtered.length > 0 && filtered.length < tokens.length) {
      result = filtered.join(" ");
    }
  }

  // 4. Trim dangling matchup separators ("at", "@", "vs", "v") that
  //    can be left behind after step 3 stripped one side of an
  //    embedded matchup string (e.g. "Edina at Minnetonka Blue"
  //    when ours = "Minnetonka Blue" → "Edina at" → "Edina").
  result = result
    .replace(/^(?:at|@|vs\.?|v\.?)\s+/i, "")
    .replace(/\s+(?:at|@|vs\.?|v\.?)$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return result || shortenTeamName(opponent) || opponent;
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
