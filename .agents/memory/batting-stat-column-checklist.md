---
name: Adding a batting stat column
description: Every place a new batting counting-stat (e.g. SF) must be threaded so it doesn't silently drop out of one surface.
---

Adding a counting stat to batting requires touching ALL of these — missing one silently corrupts a surface (e.g. PA undercount, or the stat never reaching the UI):

- **Schema** (both tables): `lib/db/src/schema/batting_stats.ts` AND `game_batting_lines.ts`, then `pnpm --filter @workspace/db run push` (root `pnpm db:push` does NOT exist).
- **batting-totals.ts**: `recomputeRates` PA formula, manual select, per-game sum select, `Acc` type, `addRow` accumulate, BOTH zero-row fills, `BattingTotalsRow` type, `BattingLineInput` type, `replaceBattingLinesForGameTx` insert.
- **batting.ts routes**: `BattingRowSchema`, `RestoreSchema`, `ImportSeasonSchema`, `computeRates` PA, `COUNT_KEYS`, per-game sum in PUT, the extract AI prompt, AND **the GET `/batting` response mapping** (a hand-written object map — easy to forget; it's what actually reaches the UI).
- **Frontend batting-tab.tsx**: `BattingRow` + `ExtractedRow` types, `computePA`, edit defaults, `COLS`.

**Why:** these routes are hand-rolled (not OpenAPI), so there's no codegen to catch a missing field — the GET mapping in particular was forgotten once and PA undercounted in the UI even though the DB was correct.

**How to apply:** when adding/removing a batting stat, walk this list end-to-end before typechecking.
