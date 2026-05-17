import { createHash } from "node:crypto";

/**
 * Compute a stable fingerprint for a tournament so two coaches who
 * independently add the same real-world event can be auto-matched.
 *
 * The fingerprint is intentionally COARSE — we want "Memorial Day
 * Classic" added by Coach A to match "memorial day classic" added by
 * Coach B even though they're using slightly different capitalization,
 * punctuation, or trailing notes. We do NOT include venue / location
 * because many tournaments span multiple complexes and coaches type
 * the location field inconsistently.
 *
 * Normalization rules (applied to the name):
 *  - Lowercase, NFKD-normalize, strip diacritics.
 *  - Strip leading/trailing whitespace + collapse internal whitespace.
 *  - Drop common filler words ("tournament", "tourney", "classic"
 *    are LEFT IN — they're rarely the only differentiator and removing
 *    them risks collapsing distinct events).
 *  - Drop trailing year ("Memorial Day Classic 2026" → "memorial day
 *    classic") because the year is already in the date range.
 *  - Drop non-alphanumeric characters AFTER the year-strip so "Coach
 *    Bob's Memorial - 2026" → "coach bobs memorial".
 *
 * Date normalization: we use the calendar dates (UTC YYYY-MM-DD) of
 * start and end, ignoring time-of-day. Coaches in different timezones
 * who type the same calendar dates will match; coaches whose iCal pull
 * shifted a midnight game over a day boundary will NOT match — that's
 * acceptable since they can still join via the suggestion UI when the
 * other side appears.
 *
 * The hash is SHA1 — we're not protecting secrets, we just want a
 * cheap fixed-length opaque key.
 */
export function computeTournamentFingerprint(
  name: string,
  startDate: Date | string,
  endDate: Date | string,
): string {
  const normName = normalizeName(name);
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
  // Don't fingerprint blanks — caller checks for empty string and skips
  // writing the column. Otherwise every brand-new "" + epoch tournament
  // would collide into one giant network.
  if (!normName || !startKey || !endKey) return "";
  const input = `${normName}|${startKey}|${endKey}`;
  return createHash("sha1").update(input).digest("hex");
}

function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // diacritics
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, " ") // strip 4-digit year tokens
    .replace(/[^a-z0-9\s]/g, " ") // non-alphanumeric → space
    .replace(/\s+/g, " ")
    .trim();
}

function toDateKey(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
