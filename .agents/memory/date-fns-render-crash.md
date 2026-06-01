---
name: date-fns format render crash
description: Why raw date-fns format(new Date(x)) in render crashes whole pages, and the safe-format pattern to use instead.
---

# date-fns `format` render crashes

date-fns `format(new Date(x), fmt)` throws **"Invalid time value"** the
instant `x` is null, empty, or a malformed date string (`new Date` →
Invalid Date → format throws). When this runs during React render, the
throw is caught by the app's ErrorBoundary and blanks the WHOLE page
("Something went wrong / Reload page"). One legacy/bad row takes down the
entire screen — which presents to users as "sometimes clicking into a
game errors and makes me reload" (intermittent because it's data-
dependent, not random).

**Why:** API rows can carry null/empty/legacy dates that a `game` /
`!game` loading guard does NOT catch — the guard only proves the object
exists, not that its date field is valid.

**How to apply:** Never call `format(new Date(<dynamic value>), …)`
directly in render. Use a defensive wrapper that checks
`Number.isNaN(d.getTime())` and returns a fallback label
(`safeFormatDate(value, fmt, fallback)` lives in
`artifacts/baseball-lineup/src/pages/game-detail.tsx`). Apply the same
pattern to any new date rendering surface. Optionally promote it to a
shared lib util if more pages need it.
