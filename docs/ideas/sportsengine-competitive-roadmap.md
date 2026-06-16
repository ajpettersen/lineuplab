# Idea: What it would take to compete with SportsEngine

> Saved for later. SportsEngine is not a coaching tool — it's a **league/club
> operating system**. Competing means climbing a layer above the team:
> registration, money, websites, communication, and an org hierarchy.

## Where Lineup Lab sits today

A deep **in-season team-operations tool**: AI lineups + fairness, rotation
reporting, the iPad Field Display, box-score/stat import, tournament mode,
practice planning, multi-coach permissions, PWA/offline. This is *better* than
SportsEngine at game-day coaching. It's the wedge — don't lose it. The gap is
everything *around* the team: the org, the parents, the money, the public face.

## The 8 pillars (our coverage)

| # | Pillar | SportsEngine | Lineup Lab today |
|---|--------|--------------|------------------|
| 1 | Registration & payments | Online registration, fees, installments, refunds, waivers/e-sign | none |
| 2 | Org hierarchy (club → league → team → season) | First-class | flat: coach → team |
| 3 | Public websites / hubs | Drag-drop club & league sites, standings, public schedules | marketing landing only |
| 4 | Communication | Email/SMS/push blasts, threads, RSVP, alerts | push for box-score reminders only |
| 5 | Parent/fan app | Schedules, scores, rosters, RSVP, family notifications | coach-only |
| 6 | Scheduling & facilities | League scheduling, field assignment, conflicts, availability | iCal import + per-team games |
| 7 | Stats & live scoring | Live scorekeeping, standings, leaderboards | post-game box-score/stats; no public live scoreboard/standings |
| 8 | Compliance & admin | Background checks, SafeSport/NGB, member DB | none |

## Gap model — what to add (effort + dependency)

1. **Registration & payments — XL, the keystone.** Public registration forms,
   Stripe Connect (fees/installments/refunds/payouts), digital waivers + e-sign.
   *Unlocks:* parents as first-class users + a billing/ledger model. This is how
   SportsEngine makes money and locks in orgs.
2. **Org hierarchy — L, the foundation.** A layer above teams (Club → Season →
   Division → Team), org admins with cross-team visibility, member directory.
   *Dependency:* tenancy is currently `coach → team`; this is a schema +
   permissions refactor (every read/write gains an org scope). Do it BEFORE
   registration or it gets redone.
3. **Parent/family accounts — L.** Parent role scoped to their kid(s), RSVP,
   notifications, fee payment; guardian↔player relationships (one parent → many
   kids → many teams). *Bonus:* gives the Field Display + stats a fan audience.
4. **Communication suite — M→L.** Team/org broadcast (email + push; SMS via
   Twilio later), game RSVP/availability, threaded announcements. Extend the
   existing VAPID push plumbing beyond box-score reminders.
5. **Public hubs & standings — M→L.** Public team/league pages (schedule,
   roster, standings, scores); auto standings from results.
   *Reuse:* `computeTournamentStatus`/`computeTournamentRecord` generalize.
6. **League scheduling & facilities — L.** Multi-team round-robin/bracket
   generation, field assignment, conflict detection, shared availability.
   Builds on the tournament engine but needs cross-team scheduling.
7. **Live scoring & leaderboards — M.** Promote Field Display's live score to a
   public real-time scoreboard; season leaderboards from existing stats. Mostly
   surfacing data already captured.
8. **Compliance & screening — M (mostly integration).** Background-check vendor
   (NCSI/JDP), SafeSport tracking, coach credential status in member directory.

## Phased roadmap

- **Phase 0 — Sharpen the wedge (now):** public live scoreboard + season
  leaderboards. Cheap, viral with parents. *M.*
- **Phase 1 — Become an org, not a team:** org hierarchy + parent/family
  accounts + communication. Converts "a coach's tool" into "a club's platform."
  *XL combined — the real pivot.*
- **Phase 2 — Capture the money:** registration + Stripe Connect + waivers. The
  moat and the revenue. *XL.*
- **Phase 3 — League operations:** multi-team scheduling, standings/hubs,
  facilities, compliance. Wins leagues, not just teams. *XL.*

## Strategic recommendation

Don't clone SportsEngine head-on (they win on breadth + incumbency). Two plays:

- **Play A (recommended): best coaching layer, climbing into the club.** Land
  *teams* on game-day superiority, then expand upward via parent accounts →
  communication → registration. Land-and-expand beats feature-parity.
- **Play B: integrate, don't replace.** Be the AI lineup/rotation/field-display
  brain that plugs into SportsEngine/GameChanger orgs. Faster, but you're a
  feature, not a platform.

**First brick (non-negotiable):** #2 org hierarchy + #3 parent accounts — nearly
every other pillar depends on them, and they're the schema refactor that's
cheaper to do now than later.
