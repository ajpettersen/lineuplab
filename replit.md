# Lineup Management System

A multi-tenant application for baseball/softball coaches to manage rosters, schedule games, and generate fair rotational lineups.

> This README captures durable decisions, conventions, and gotchas. Implementation specifics (exact function names, tuning constants, CSS values) live in the code — read it there rather than trusting a description here that may have drifted.

## Run & Operate

```bash
pnpm install
pnpm dev # Starts frontend and backend
pnpm build
pnpm typecheck
pnpm db:push # Apply Drizzle migrations
pnpm generate # Orval codegen
```

**Required ENV Vars:** `CLERK_SECRET_KEY`, `DATABASE_URL`, `OPENAI_API_KEY`, `MASTER_ADMIN_USER_IDS` (comma-separated Clerk user IDs), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (web push; degrades gracefully if absent).

## Stack

React + Express, Node.js 24, Drizzle ORM, Zod v4, Vite (manual vendor chunk splitting), Tailwind + shadcn/ui, Recharts, Wouter routing, Clerk auth, AI via `gpt-5.2`.

## Where things live

- **Frontend**: `src/`; **Backend**: `api-server/src/`; **DB schema**: `api-server/src/db/schema.ts`
- **API contracts**: `api-server/src/routes/` (generated client in `src/lib/api-client/`). `/api/batting`, `/api/pitching`, and `/api/push/*` are hand-rolled (not in OpenAPI) — call with plain `fetch`.
- **Theme/styling**: `src/index.css`, `tailwind.config.js`; **Components**: `src/components/`; **Utilities**: `src/lib/`

## Architecture decisions

These are the *rules and rationale* that aren't obvious from reading any single file. The mechanics are in the code.

### Multi-sport
- **Per-team sport**: `team_settings.sport` (default `"baseball"`) selects the sport for the whole team. Every fallback resolves to baseball, so existing teams are unchanged.
- **Single source of truth**: `@workspace/sport-profiles` (`lib/sport-profiles`), imported by BOTH api-server and web — carries positions, period labels, on-field count, terms, and a `features` map. `getSportProfile(sport)` falls back to baseball.
- **Gating rule**: sport-specific surfaces gate on `sportProfile.features.*` — NOT hardcoded sport checks, and NOT on broad flags like `usesTournaments` (defaults `true`).
- **Fair rotation reuse**: `generateFairLineup` is sport-agnostic (e.g. basketball passes court positions + `skipBattingOrder`); pitcher exclusion only fires on a literal "P".

### Core
- **Multi-tenancy**: data isolation per team scope key (`ownerUserId`); `assertPermission` middleware gates write routes.
- **Multi-team (one coach, many teams)**: a coach's first team is keyed by their Clerk userId; additional teams (`POST /api/teams`) get a synthetic `team_<uuid>` scope key = a `team_settings` row + an owner membership row (`isOwner=true`, `full`). No `teams` table. **Rules:** never check ownership via `userId === ownerUserId` (use `isTeamOwnerUser()`); never pass scope keys to Clerk lookups without filtering `team_`-prefixed ids; the team's owner-row is the membership with `isOwner=true`. `/teams` is the picker page; the header switcher always renders. See `.agents/memory/multi-team-synthetic-keys.md`.
- **Team-scope cache reset**: switching/creating teams (and invite accept) must use `resetQueries()` + persisted-cache purge — `qc.clear()` doesn't notify mounted observers and leaves stale UI. See `.agents/memory/react-query-clear-vs-reset.md`.
- **Permission tiers** (`team_memberships.permission`): `view < upload < partial < full` (linear rank). Owner locked to `full`. Server enforces via `assertPermission`; web hides write controls via `usePermission()`. `upload` = stat-keeper (read-only EXCEPT box-score routes). **`role` (free-form display label) is decoupled from `permission` (capabilities).**
- **Master admin bypass**: `MASTER_ADMIN_USER_IDS` enables `/admin`; admin routes intentionally skip the `deletedAt` filter for audit.

### Visual & branding
- **Broadcast visual language**: Oswald display + Roboto Mono numerals.
- **Team branding**: `team_settings.primaryColor`/`secondaryColor` (nullable HSL strings `"H S% L%"`, `null` = app default). `<TeamThemeApplier>` overrides CSS vars on `<html>`.
- **Rule — chrome must follow team colors**: any signed-in chrome surface must derive from the `--brand*`/`--fd-*` tokens or `primary`/`accent` — NEVER hardcoded `hsl(220 85% L%)` navy or `#0f172a`-style slate, or it won't follow custom team colors. The `--brand*`/`--fd-*` tokens carry a plain-hsl/hex fallback line first for iPad Safari <16.2. The signed-out auth page intentionally stays fixed navy (no team context yet).
- **Rule — theming providers mount at the signed-in app root, NOT in `<Layout>`**: full-screen surfaces (Field Display, `/welcome`) render outside the app shell, so a provider mounted in Layout silently leaves them on default navy/gold. See `.agents/memory/full-screen-routes-skip-layout-providers.md`.
- **Gold is reserved for trophies**: Field Display highlights use the team `accent` token; gold returns only at the championship rungs via a single `[data-fd-mode="champ"]` `--accent` override in `index.css`.

### AI features (all via `gpt-5.2`)
- Roster import (image/text), lineup generation (natural language), practice-plan suggestions, box-score import.
- **Season "Ask" assistant** (`POST /api/assistant`): bounded READ-ONLY tool-calling loop; tools execute server-side with `ownerUserId` injected (the model never supplies a userId). Surfaced on `/ask` and inline on the Rotation Report (same `{ messages }` contract). No write gate; charged via `chargeAiCall`.
- **Practice Plan AI**: accepts required drills + coach notes; defensive blocks may group players by preferred position (present-only when attendance is marked). Server validates all names against the roster.
- **"Things to work on"** (`practice.focusPoints`): coach symptoms in their own words; AI tags blocks with verbatim-matched `addressesFocusPoints` (paraphrases dropped).

### Lineup & rotation
- **Active positions** (`team_settings.activeFieldPositions`): standard 9 or 10-player — source of truth for defensive shape. Render historical lineups via `active ∪ positions present` so old games keep their columns.
- **Batting order**: league mode evens out plate appearances (ascending PA); tournament/competitive mode arranges top hitters by OPS. Missing stats use team means.
- **Per-game Competitiveness** (`games.competitiveness`, nullable 0-100): per-game dial for the BATTING ORDER ONLY (defense untouched); `null` = legacy behavior. Blends between an equitable order and a competitive OPS order. **UI lives in ONE place** — the Generate Lineup dialog, under the global Fairness Dial as an optional override. The redundant standalone slider on new/edit-game was removed.
- **First-inning start balancing**: inning 1 has no in-game bench history, so without help the same kids keep starting benched. The route mines a season start-rate from saved lineups and nudges below-average starters onto the field in inning 1 only. **Gated on the fairness dial leaning fair (`equity > 0.5`)** — on for league/untyped games, off for competitive/tournament games. Background stat only: no schema, no UI, not wired into the AI assistant regen route. See `.agents/memory/inning1-start-fairness-gap.md`.
- **Learned preferred batting slot**: at the competitive end, the generator nudges each player toward where the coach usually bats them, learned from the SAVED FINAL order of past competitive games (manual edits are baked in — there is no separate edit-audit signal).
- **Roster names**: `firstName` + `lastName` required on writes; `players.name` is the derived "First Last" kept in sync server-side. Bulk-import accepts either; legacy single-token rows tolerated.

### Field Display (iPad/dugout)
- **Offline support**: `localStorage` cache + pending write queue, last-writer-wins. **Critical policy:** any thrown error on flush is treated as transient — pending writes stay queued, polling pauses while unsynced so a background GET can't clobber optimistic state, and writes are NEVER dropped on error (`navigator.onLine` lies on flaky WiFi). Two independent drainers coordinate via a shared in-flight claim. See `.agents/memory/field-display-offline-drainers.md`.
- **Stakes Ladder**: one dugout screen with five escalating game-context rungs (`league < pool < bracket < champ < champ-elevated`) exposed as `data-fd-mode` on the root; CSS keys off that attribute. `champ-elevated` = championship game while our team leads.
- **Championship flag**: per game via `games.isChampionship` (Edit Game, tournament games only). The kebab toggle is a SESSION-scoped override that resets per game id (a global toggle used to leak gold onto later games).
- **Per-device toggles** (brightness, tournament-pitches panel, etc.): keep visual-mode flags scoped per game (DB flag + session override reset on game id) — global localStorage flags leak across games. See `.agents/memory/field-display-per-device-toggles.md`.
- **Tournament time limits**: per-tournament pool/bracket minutes resolved server-side per game; Field Display shows an advisory countdown — NO chime, NO auto-finalize.
- **Celebrations**: portaled canvas-confetti + Web Audio synthesized sounds (no asset files); audio ctx lazy-unlocked on first interaction (iOS Safari). All animations honor `prefers-reduced-motion`.

### Schedule & games
- **iCal opponent extraction**: matches each side of the SUMMARY against the team name at token level, so road games with a shortened team name don't store our own team as the opponent.
- **Box Score Import**: 1-4 phone screenshots → parallel OCR calls merged by playerId; per-game rows make re-import idempotent (replaces in a transaction). Season totals union manual `batting_stats` + summed game lines.
- **Season Batting Import**: accepts a GameChanger CSV (parsed deterministically, no AI charge) OR image/PDF (AI vision path). Stores full season totals + a cutoff so it overrides prior box-score rollups while future games accumulate on top. **GameChanger CSV gotcha:** 2-row header; shared column names appear in both batting & pitching sections, so batting reads are scoped to columns left of the "Pitching" marker.

### Feature flags
- **`usesTournaments`** (default `true`): master switch for tournament UI discoverability; existing tournament rows still render when off.
- **`usesGameChanger`** (default `false`): surfaces a box-score dashboard task for past games and (with opt-in) Web Push box-score reminders (~2h after game). Push scheduler polls with a single-flight atomic claim; no-ops if VAPID env vars are missing.

### Soft delete & undo
- `players`, `games`, `practices`, `tournaments` carry nullable `deletedAt`. DELETE stamps; `/:id/restore` clears. Every read filters `isNull(deletedAt)` (admin routes don't, for audit). Box-score and manual-batting deletes use snapshot+restore with a ~10s Undo toast.

### Onboarding & landing
- **Onboarding Wizard** (`/welcome`): auto-redirect is intentionally DISABLED (forcing legacy coaches back kept re-prompting); still reachable manually.
- Signed-out `/` renders the marketing landing instead of bouncing to `/sign-in`. Invites: coach copies the join link.

### PWA & performance
- **PWA**: `vite-plugin-pwa` (Workbox, autoUpdate) precaches the app shell. Runtime caching limited to Google Fonts; `/api` and auth routes denylisted (data caching owned by React Query's persisted client, IndexedDB). On user change, the query cache is cleared + persisted cache purged.
  - **Gotcha — embedded artifact iframes**: an artifact embedded via iframe needs its path on the `navigateFallbackDenylist`, or the SW serves index.html into the frame (prod-only). See `.agents/memory/pwa-iframe-artifact-denylist.md`.
- **Bundle splitting**: `manualChunks` splits node_modules into stable vendor chunks that cache across deploys.
- **"Slow load" is boot/shell, not code-splitting** — routes are already lazy and vendors already split; the cost is Clerk/IndexedDB boot. See `.agents/memory/load-perf-is-boot-not-splitting.md`.
- **Offline write queue** (`src/lib/offline-queue.ts`): a `useSyncExternalStore` observable counting pending Field Display writes; `<OnlineResumer>` drains on reconnect (drain queue → resume paused mutations → invalidate, order matters). Field Display's lineup/game saves ride the localStorage queue rather than the persisted-mutation path — see the docblock for what's intentionally excluded.

## Product

- Roster management (bulk AI import, preferred positions)
- Game scheduling and lineup creation; AI lineup generation (images, natural language)
- Customizable lineup defaults and "fairness" dial; season statistics and Rotation Report
- Tournament mode with free-form pitch rules and tracking
- Field Display for real-time game management (iPad-optimized)
- Multi-coach team sharing with permission tiers
- Dashboard with tasks and W-L-T record

## User preferences

- Deep navy primary (`220 85% 22%`), warm gold accent (`42 95% 55%`), cool off-white background.
- Header text from `team_settings.teamName` (no hardcoded brand).
- Lineup grid: pill-shaped player chips, circular inning badges, alternating row backgrounds.
- Copy a new lineup from any past game; import lineup from screenshot (PNG/JPEG/WebP, ≤6 MB).
- Edit recorded lineups even after a game is marked complete.
- "Lock" players into positions for an inning or all innings.
- "Lineup Fairness" dial (0-100 slider); info tooltip explains the score (per-player bench-rate stddev across completed games, scored 100 − stddev × 400 — multiplier tuned so the realistic spread uses the full 0-100 range; a bench-rate stddev of ~0.20 ≈ score 20).
- Bulk roster import via AI (text or screenshot); paste iCal/webcal URL to import schedules.
- AI Assistant that answers "why" questions and regenerates lineups from natural language.
- Editable game cards (pencil icon); inline lineup editing with drag-and-drop + copy to Sheets.
- "Innings by Position" tally below the lineup card.
- Dashboard "Total Games" excludes practices/other events.
- Settings toggles to hide the Fairness Score and the equity-suggestions popup.
- Practice planner: "Must-include drills" textarea; group players by preferred position on defensive blocks.
- Import GameChanger box scores (1-4 screenshots) and season stats (GameChanger CSV or image/PDF) with editable preview; re-importing replaces, not duplicates.

## Gotchas

- Use `formatPlayerNameShort()` (`src/lib/player-name.ts`) for short displays (`First L.`) instead of manual string splitting.
- Tie badge format must stay consistent across `dashboard.tsx`, `games.tsx`, `game-detail.tsx`.
- Every matchup display: `{teamName} vs. {formatOpponentForMatchup(opponent, teamName)}` (`src/lib/team-name.ts`). Inline subcomponents (e.g. `GameCard`) must receive `teamName` as a PROP — Vite's react-refresh hoists inline arrow components to module scope, breaking closure references.
- `team_settings.activeFieldPositions` is the source of truth for defensive shape — flow it through any new lineup-generating/grid surface (`lineups.ts`, `ai-assistant.ts`, `game-detail.tsx`, `field-display.tsx`).
- Adding a batting stat column touches multiple surfaces (schema, batting-totals, hand-rolled routes incl. the GET response map, frontend) — see `.agents/memory/batting-stat-column-checklist.md` or it silently drops on one surface.
- Match game↔tournament by comparing `YYYY-MM-DD` substrings client-side, NOT server-side `date_trunc` on UTC timestamps (evening-game off-by-one). See `.agents/memory/tournament-date-matching.md`.

## Pointers

Clerk · Drizzle ORM · Zod · Orval · Tailwind CSS · shadcn/ui · Recharts · Google Fonts (Oswald, Roboto Mono).
