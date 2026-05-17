import { format as dateFnsFormat } from "date-fns";

/**
 * Tournament start/end dates are stored as `timestamp with timezone` in
 * Postgres (see `lib/db/src/schema/tournaments.ts`), but the coach picks
 * them via a date-only `<input type="date">` and we send the bare
 * `YYYY-MM-DD` string. The server runs `new Date("YYYY-MM-DD")` which is
 * interpreted as UTC midnight, so the column ends up holding e.g.
 * `2026-05-15T00:00:00Z`.
 *
 * On the client, naively doing `new Date(t.startDate)` and formatting
 * with the user's local timezone (e.g. CDT, UTC-5) renders that as
 * `May 14`, one day behind what the coach typed.
 *
 * This helper rebuilds a local-midnight Date from the stored value's
 * UTC year/month/day so `format(...)` shows the calendar date the coach
 * actually picked, regardless of their browser timezone.
 */
export function tournamentDateAsLocal(value: string | Date | null | undefined): Date {
  // Defensive: callers sometimes hit this before the React Query result
  // has resolved (or with a row that has a NULL date). `new Date(null)`
  // would parse as the epoch and `new Date(undefined)` returns Invalid
  // Date, which then crashes `date-fns/format` with "Invalid time value"
  // — and the crash bubbled up as a blank tournament page that needed a
  // reload. Returning today's date is a harmless placeholder for the
  // UI; the underlying row is still rendered (just with a today label)
  // instead of nuking the whole page.
  if (value == null) return new Date();
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return new Date();
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Safe wrapper around `date-fns/format` for any datetime field that may
 * be `null`/`undefined`/malformed at runtime. Returns the provided
 * fallback string instead of throwing, so a single bad row in a list
 * doesn't crash the whole page.
 *
 * Use this anywhere we render `game.gameDate`, `outing.dateLocal`, etc.
 * directly in JSX — those columns are non-null in the schema, but
 * mid-flight optimistic state and edge cases (e.g. a newly created game
 * referenced before the GET hydrated) can produce undefined transiently.
 */
export function safeFormatDate(
  value: string | Date | null | undefined,
  pattern: string,
  fallback: string = "—",
): string {
  if (value == null) return fallback;
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return fallback;
    return dateFnsFormat(d, pattern);
  } catch {
    return fallback;
  }
}
