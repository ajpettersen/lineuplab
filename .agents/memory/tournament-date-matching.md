---
name: Tournament/game date matching is timezone-safe via date-string compare
description: Why auto-linking a game to a tournament by date is done client-side comparing YYYY-MM-DD substrings, not server-side date_trunc on UTC timestamps
---

When deciding whether a game falls within a tournament's date range (e.g. to
auto-link it), compare the **date-portion strings** (`isoString.slice(0,10)`),
not the timestamps.

**Why:** tournament `startDate`/`endDate` are stored as date-only values
(UTC-midnight ISO, e.g. `2026-06-07T00:00:00.000Z`), but a game's `gameDate` is
a real timestamp from a datetime-local/date input. A server-side
`date_trunc('day', ...) <= gameDate < ... + 1 day` comparison runs in the DB
session timezone (UTC), so an evening game in a western US zone (e.g. 7pm CDT =
00:00 UTC next day) lands on the wrong UTC day — it gets missed on the last
tournament day or false-matched onto the day before. The app already learned
this for *display* (`tournamentDateAsLocal` exists only to dodge the off-by-one).

**How to apply:** do the match on the client where the local day is known.
`gameDay = gameDate.slice(0,10)` is the calendar day the coach typed;
`t.startDate.slice(0,10)..t.endDate.slice(0,10)` are the tournament's stored
days. Lexical `gameDay >= start && gameDay <= end` on `YYYY-MM-DD` is correct and
needs no timezone conversion. The create endpoint already persists a
client-supplied `tournamentId` + `gameType` (sets `bracketStage="pool"`), so pass
the matched id in the POST body rather than re-deriving it server-side. Caveat:
this relies on tournament dates staying canonical date-only; non-date-only
timestamps would make `slice(0,10)` mean the UTC day.
