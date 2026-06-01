---
name: Multi-sport architecture
description: How Lineup Lab supports multiple sports per team (baseball default, basketball v1) and how to add/gate sport-specific surfaces.
---

# Multi-sport architecture

Lineup Lab is ONE app whose sport is chosen PER TEAM via `team_settings.sport`
(text, DB default `"baseball"`). Existing teams stay baseball with zero behavior
change because every fallback resolves to baseball.

## Single source of truth: `@workspace/sport-profiles`
- The lib (`lib/sport-profiles`) is the registry. A profile carries:
  positions[{code,label,short,group}], periodLabel/Plural/Short, defaultPeriods,
  onFieldCount, benchLabel, terms{...}, and `features` flags
  (`pitching`, `battingOrder`, `boxScoreImport`, `tournaments`, `pitchCounts`).
- Both api-server and the web app import it. `getSportProfile(sport)` falls back
  to baseball for unknown/missing values.

## Gating rule (IMPORTANT)
Any sport-specific surface MUST gate on `sportProfile.features.*`, NOT on a
hardcoded sport check and NOT only on existing flags like `usesTournaments`.
- **Why:** `usesTournaments` defaults `true`, so basketball would otherwise still
  show Tournament game-type options. Box score / pitch counts / batting order are
  baseball-only and must disappear for basketball.
- **How to apply:** when adding a feature, decide which `features` flag governs it
  and gate the nav item (layout.tsx), the dialogs (new-game, edit-game), and the
  game-detail panels/tabs on that flag. Also guard any deep-link/hash tab state
  (e.g. `#pitch-counts-card`) so it can't land on a hidden tab — add a safety-net
  effect that resets to the always-present "defense"/lineup tab.

## Fair rotation reuse
`generateFairLineup` is sport-agnostic: basketball passes the 5 court positions as
`fieldPositions` + `skipBattingOrder=true` + periods=quarters. Pitcher exclusion
only triggers on a literal "P" position (basketball has none), so it's a no-op.

## Known accepted gap
game-detail's "innings by position" tally still hardcodes its category groups
(baseball Pitching/Infield/Outfield vs basketball Guard/Forward/Center) instead of
deriving from `positions[].group`. It is sport-aware and correct, but a future
refactor could derive it from the profile to remove drift risk.
