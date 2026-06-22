---
name: Inning-1 start fairness gap
description: Why the lineup generator keeps starting the same kids on the bench in inning 1, and the principle behind the season start-balancing fix.
---

# Inning-1 start fairness gap

The greedy lineup generator's fairness term is `(bench*10 - total) * mult`. In **inning 1** every player has `bench=0, total=0`, so this term is **structurally 0 for everyone** — the opening lineup is decided entirely by preferred-position contests + input array order. When players cluster on the same crowded preferred spots and don't list the open ones, the same one or two kids lose the contest every game and start benched — even though their season-long bench rate across ALL innings is fair.

**Why non-obvious:** the overall fairness dial works fine over a whole game; the skew is specific to the opening inning and is invisible unless you bucket bench events by inning.

## Durable principles for any future inning-1 / opening-lineup fairness work
- You **cannot lean on in-game bench-count fairness in inning 1** — it's always 0 there. Any opening-inning fairness signal must come from **out-of-game season history**, not the current game's state.
- **Gate balance features on the equity dial, NOT the per-game `competitiveness` slider.** Coaches think "dial over 50 = more balanced," which maps to equity/fairness (higher = fairer). The `competitiveness` slider is the OPPOSITE direction (higher = more competitive) and is usually left null — gating on it fires rarely or in the wrong games. `gameType` already forces equity (tournament→0.10, league→0.70), so an `equity > 0.5` gate auto-disables balance nudges in competitive games.
- Keep any such nudge **soft** (comparable to the must-play +20 boost) so it reorders eligible candidates without overriding pins / forced bench / must-play.

(Implementation specifics live in `replit.md` → "First-inning start balancing".)
