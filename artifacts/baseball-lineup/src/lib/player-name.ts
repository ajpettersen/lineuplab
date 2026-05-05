/**
 * Player name display helpers.
 *
 * `players.name` is a single text column that typically holds the full
 * name (e.g. "Parker Handahl"), but coaches who only typed a first name
 * during quick-add are also supported. We never split into separate
 * first/last columns — see the task plan for that decision.
 */

/**
 * Returns "First L." when the player has a multi-token name on file,
 * else returns the trimmed name unchanged.
 *
 * Examples:
 *   "Parker Handahl"        → "Parker H."
 *   "Brody"                 → "Brody"
 *   "Mary Beth Smith"       → "Mary S."   (uses LAST token as the surname)
 *   "Henry"                 → "Henry"
 *   "  Will  Klous  "       → "Will K."
 *   ""                      → ""
 *   null/undefined          → ""
 *
 * The last initial is uppercased even if the source was lowercase.
 * If the surname is itself a single character (e.g. "Will K") we still
 * render it as "Will K." so the visual is consistent.
 */
export function formatPlayerNameShort(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  if (!trimmed) return "";
  const tokens = trimmed.split(/\s+/);
  if (tokens.length <= 1) return trimmed;
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  const initial = last.charAt(0).toUpperCase();
  return `${first} ${initial}.`;
}
