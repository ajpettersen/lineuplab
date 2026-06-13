---
name: Field Display accent-token theming
description: How the dugout Field Display is themed in team colors and how gold is re-introduced only at championship rungs.
---

# Field Display theming via the `accent` token

The Field Display (`field-display.tsx`) is painted in the TEAM's color by routing
all chrome through the Tailwind v4 `accent` utilities (`text-accent`,
`border-accent`, `ring-accent`, `bg-accent`) instead of hardcoded gold. The old
`broadcast-gold` utility class was the "this app is gold" smell.

**Rule:** new Field Display chrome should use `accent`-family utilities, never
`broadcast-gold`, so it follows `team_settings` colors. Reserve literal gold for
the championship "trophy" treatment only.

**The single lever for gold-at-championship:** in `index.css`,
`[data-fd-mode="champ"],[data-fd-mode="champ-elevated"]{ --accent:42 95% 55%; --accent-foreground:220 85% 18%; }`
re-points the accent CSS variable for the whole Field Display subtree. Because
Tailwind v4 maps `--color-accent: hsl(var(--accent))`, every themed `accent`
utility under the root instantly becomes trophy gold with NO per-element edits.

**Why:** nearest-scope CSS variable wins, so this subtree override coexists with
`TeamThemeApplier` (which sets `--accent`/`--primary` on `<html>`). Non-champ
rungs inherit the team accent from `<html>`; champ rungs get gold from the
subtree override.

**How to apply:** the root sets `data-fd-mode={fieldMode}` (`league|pool|bracket|champ|champ-elevated`).
If you add a new escalating rung or chrome element, drive it off `data-fd-mode`
+ `accent` utilities; do not add a parallel hardcoded color path. `TeamThemeApplier`
overrides `--accent` but NOT `--accent-foreground` for custom teams, so don't lean
on `accent-foreground` contrast for arbitrary team colors.
