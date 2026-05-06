/**
 * Player name display helpers.
 *
 * Players now have separate `firstName` + `lastName` columns. `name` is
 * kept as a derived display string ("First Last") for back-compat with
 * existing read sites. These helpers prefer the structured fields when
 * available and fall back to splitting `name` for legacy callers.
 */

type NameInput =
  | string
  | null
  | undefined
  | {
      name?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    };

function resolveParts(input: NameInput): { first: string; last: string } {
  if (!input) return { first: "", last: "" };
  if (typeof input === "string") {
    const tokens = input.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return { first: "", last: "" };
    if (tokens.length === 1) return { first: tokens[0]!, last: "" };
    return {
      first: tokens.slice(0, -1).join(" "),
      last: tokens[tokens.length - 1]!,
    };
  }
  const first = (input.firstName ?? "").trim();
  const last = (input.lastName ?? "").trim();
  if (first || last) return { first, last };
  return resolveParts(input.name ?? "");
}

/**
 * Returns "First L." (e.g. "Parker H.") when a last name is on file,
 * else returns the first name alone. Accepts either a raw name string
 * or a player-shaped object with firstName/lastName.
 */
export function formatPlayerNameShort(input: NameInput): string {
  const { first, last } = resolveParts(input);
  if (!first && !last) return "";
  if (!last) return first;
  const initial = last.charAt(0).toUpperCase();
  return first ? `${first} ${initial}.` : `${initial}.`;
}

/** Joins firstName + lastName into a display string, trimming extra space. */
export function formatPlayerNameFull(input: NameInput): string {
  const { first, last } = resolveParts(input);
  return [first, last].filter(Boolean).join(" ");
}
