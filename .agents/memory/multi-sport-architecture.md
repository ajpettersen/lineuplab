---
name: Multi-sport architecture (delta only)
description: Pointer to the full multi-sport design in replit.md, plus the one accepted gap not captured there.
---

# Multi-sport architecture

The full design (per-team `team_settings.sport`, `@workspace/sport-profiles`
registry, the `features.*` gating rule, fair-rotation reuse) lives in
**replit.md → Architecture decisions → Multi-sport**. Read that first; it is the
source of truth. Do not duplicate it here.

## Accepted gap (NOT in replit.md)
game-detail's "innings by position" tally hardcodes its category groups
(baseball Pitching/Infield/Outfield vs basketball Guard/Forward/Center) instead
of deriving from `positions[].group`. It is sport-aware and correct today, but a
future refactor could derive groups from the profile to remove drift risk.

**Why:** worth knowing before adding a 3rd sport — the tally won't "just work"
from the profile; it needs a code change.
