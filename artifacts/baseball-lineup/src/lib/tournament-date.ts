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
export function tournamentDateAsLocal(value: string | Date): Date {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
