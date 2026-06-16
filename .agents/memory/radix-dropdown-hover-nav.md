---
name: Radix dropdown trigger reopen loop
description: Why a hover/click nav dropdown built on Radix DropdownMenu can refuse to close, and the two anti-patterns that cause it.
---

# Radix DropdownMenu controlled-trigger gotchas (nav hover dropdowns)

For hover-open nav dropdowns built on a **controlled** Radix `DropdownMenu`
(`open`/`onOpenChange`, `modal={false}`), two trigger handlers silently break
closing:

1. **`onFocus={() => setOpen(true)}` causes a reopen loop.** Radix restores
   focus to the trigger when the menu closes. So any close (hover-away,
   sibling-hover, the cross-dropdown coordination event) immediately bounces
   back open because focus lands on the trigger and re-opens it. Symptom:
   "the dropdown won't close when I move to a sibling item," even though the
   close logic is firing. **Do not auto-open on focus.** Keyboard users still
   open via Enter/Space/ArrowUp/Down, which Radix routes through `onOpenChange`.

2. **A manual `onClick={() => setOpen(o => !o)}` double-toggles.** Radix's
   trigger already toggles on *pointerdown* via `onOpenChange`. Adding a manual
   toggle in `onClick` (fires on pointerup) flips it a second time, so a second
   click can't close the menu (open → Radix closes → manual reopens). Let Radix
   own the click toggle; in your handler only clear pending hover-intent timers
   (`cancelOpen()`).

**Why:** Radix trigger semantics (focus-restore-on-close + pointerdown toggle)
collide with hand-rolled open/close handlers. The diagnostic that nailed it:
after hovering the sibling, `elementFromPoint` was the sibling link and the menu
did NOT geometrically overlap it, yet `aria-expanded` stayed `true` — proving the
menu was being *re-opened*, not "never closed."

**How to apply:** When a Radix dropdown "won't close," check the trigger's
`onFocus`/`onClick` for redundant `setOpen` calls before adding more close
machinery. Lives in `artifacts/baseball-lineup/src/components/layout.tsx`
(`NavGroupDropdown`).
