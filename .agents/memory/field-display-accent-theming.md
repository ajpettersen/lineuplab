---
name: Field Display accent-token theming
description: How the dugout Field Display is themed in team colors and how gold is re-introduced only at championship rungs.
---

# Field Display theming: primary-derived surfaces + accent highlights

The dugout Field Display (`field-display.tsx`) is themed in TWO layers:

1. **Dark chrome SURFACES (header bar, panels, position chips, borders, field
   surround) are derived from the TEAM PRIMARY color** via `--fd-*` tokens in
   `index.css` (`--fd-bg/--fd-panel/--fd-panel-deep/--fd-chip/--fd-chip-soft/--fd-border`),
   each a `color-mix(in srgb, hsl(var(--primary)) N%, <near-black>)` (with a plain
   hex fallback line first for iPad Safari < 16.2). This is what makes a royal-blue
   (or maroon, forest…) team's WHOLE screen read in their color instead of generic
   slate. Use `bg-[var(--fd-panel)]` etc., NOT hardcoded `#0f172a`/`#0b1a35`/…
2. **HIGHLIGHTS (lineup title underline, inning number, active batter, POS labels,
   end-game buttons) use the `accent` token** (Tailwind `text-accent`/`border-accent`/
   `ring-accent`), which follows the team SECONDARY color and defaults to gold. The
   old `broadcast-gold` utility was the "this app is hardcoded gold" smell.

**Rule:** new chrome SURFACE → `--fd-*` (primary-derived); new HIGHLIGHT → `accent`
utility. Never reintroduce hardcoded slate hexes or `broadcast-gold`. Reserve literal
gold for the championship "trophy" treatment only.

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

# App-wide brand chrome (beyond the Field Display)

The same primary-derived approach themes the MAIN app shell. The global sticky
header, mobile bottom nav, nav scroll-fade gradients (`layout.tsx`) and the
dashboard hero (`next-game-hero.tsx`) use `--brand`/`--brand-d`/`--brand-dd`/
`--brand-l`/`--brand-ll` tokens (`index.css`): `--brand = hsl(var(--primary))`,
the rest `color-mix(primary, black|white)`, each with a plain-hsl default-navy
fallback line first (iPad Safari < 16.2).

**Rule (the durable lesson):** any signed-in chrome surface must use
`var(--brand*)` (or `primary`/`accent`/`--fd-*`) tokens — NEVER a hardcoded
`hsl(220 85% L%)` navy. Hardcoded navy is why "the app stayed navy even though
the team color is royal blue." The signed-out auth page (`App.tsx`) is the one
intentional exception: no team context exists pre-login, so it stays fixed navy.
Tailwind v4 DOES support opacity-on-var (`via-[var(--brand-d)]/85` compiles to a
`color-mix(... transparent)` path), so that pattern is safe here.
