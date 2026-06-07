---
name: Field Display per-device toggles leak across games
description: Why Field Display visual modes should key on per-game data, not a single global localStorage flag
---

Field Display visual modes (e.g. Championship Mode) must NOT be stored as a single
global per-device `localStorage` flag when the mode is conceptually "about this one
game". A global flag leaks the treatment onto later games viewed on the same iPad.

**Why:** Championship Mode used a global `fd-championship-mode` key. Once a coach
enabled it for the championship game, every later tournament game on that device
opened with the gold treatment too — felt like a bug, especially after we added a
data flag that auto-enables it.

**How to apply:** Drive such modes from a per-game data flag (DB column, e.g.
`games.isChampionship`) and compute the effective state as
`sessionOverride ?? Boolean(game.flag)`. The kebab toggle sets a SESSION-scoped
override (`useState<boolean|null>`), reset in an effect keyed on the game `id`
(Field Display does not reliably remount on a route-param change). The DB flag is
the durable signal; no global localStorage persistence needed. Server PATCH should
guard the flag (only valid on the right game kind) mirroring the `bracketStage`
semantic-guard pattern in `artifacts/api-server/src/routes/games.ts`.
