# Lineup Management System

A multi-tenant application for baseball/softball coaches to manage rosters, schedule games, and generate fair rotational lineups.

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

### Multi-sport
- **Per-team sport**: `team_settings.sport` (default `"baseball"`) selects the sport for the whole team. Every fallback resolves to baseball, so existing teams are unchanged.
- **Single source of truth**: `@workspace/sport-profiles` (`lib/sport-profiles`), imported by BOTH api-server and web. A profile carries positions, period labels, on-field count, terms, and `features{pitching,battingOrder,boxScoreImport,tournaments,pitchCounts}`. `getSportProfile(sport)` falls back to baseball.
- **Gating rule**: sport-specific surfaces gate on `sportProfile.features.*` — NOT hardcoded sport checks, and NOT on broad flags like `usesTournaments` (defaults `true`). Deep-link/hash tab state is guarded by a safety-net effect that resets to the always-present lineup tab when the target tab is hidden.
- **Fair rotation reuse**: `generateFairLineup` is sport-agnostic — basketball passes its court positions + `skipBattingOrder=true`; pitcher exclusion only fires on a literal "P".

### Core
- **Multi-tenancy**: Data isolation per coach (`Clerk userId`) with `assertPermission` middleware gating write routes.
- **Permission Tiers** (`team_memberships.permission`): `view < upload < partial < full` (linear rank). Owner locked to `full`. Server enforces via `assertPermission(level)` (`lib/permissions.ts`); web hides write controls via `usePermission()`. `upload` = stat-keeper (read-only EXCEPT `/games/:id/box-score*`). **`role` (free-form display label) is decoupled from `permission` (capabilities).**
- **Per-Team Coach Profile**: `displayName` + `role` on `team_memberships` (owner row has `isOwner=true`).
- **Master Admin Bypass**: `MASTER_ADMIN_USER_IDS` enables `/admin` (all teams + "view as" switch); admin routes intentionally skip the `deletedAt` filter for audit.

### Visual & branding
- **Broadcast Visual Language**: app-wide aesthetic (Oswald display + Roboto Mono numerals).
- **Team Branding**: `team_settings.primaryColor`/`secondaryColor` (nullable HSL strings `"H S% L%"`). `<TeamThemeApplier>` (in `Layout`) overrides primary/ring/accent CSS vars on `<html>`. Coaches pick preset swatches in Settings → Team Colors; `null` = app default.

### AI features
- Roster import (image/text), lineup generation (natural language), practice-plan suggestions, and box-score import all use `gpt-5.2`.
- **Season "Ask" assistant** (`POST /api/assistant`): bounded READ-ONLY tool-calling loop (`lib/team-assistant.ts` + `lib/assistant-tools.ts`); tools execute server-side with `ownerUserId` injected (model never supplies a userId). Surfaced on `/ask` and inline on the Rotation Report — both POST the same `{ messages }` contract. No write gate (any tier); charged via `chargeAiCall`.
- **Practice Plan AI** (`/api/practices/:id/generate-plan`): accepts `requiredDrills?: string[]` (each its own block) + `coachNotes`. Defensive blocks may emit `groups: {label, playerNames}[]` (PRESENT-only when attendance marked, else full roster). Server validates names against roster.
- **"Things to work on"** (`practice.focusPoints`, `jsonb string[]`, capped 20×200, deduped): coach symptoms in their own words. AI weaves coverage across blocks and tags them with `addressesFocusPoints` (validated as case-insensitive verbatim matches; paraphrases dropped).

### Lineup & rotation
- **Active positions** (`team_settings.activeFieldPositions`): standard 9 or 10-player (LCF+RCF) — source of truth for defensive shape. Render historical lineups via `active ∪ positions present` so old games keep their columns.
- **Batting order modes** (`lib/lineup-generator.ts`): tournament games arrange top 5 by OPS in a table-setter/cleanup pattern; league mode sorts by ascending PA (even out plate appearances). Missing stats use team means.
- **Per-game Competitiveness** (`games.competitiveness`, nullable int 0-100): per-game dial for the BATTING ORDER ONLY (defense untouched). `null` = legacy behavior (gameType branch + global fairness dial). When set, blends `w=competitiveness/100` between an equitable order (ascending PA) and a competitive order (OPS arrangement). UI: checkbox-gated `Slider` in new-game/edit-game (off → sends `null`).
- **Learned preferred batting slot**: at the competitive end, the generator nudges each player toward where the coach usually bats them (blended 50/50 with OPS). The route (`lineups.ts`) only mines history when `competitiveness != null`, averaging saved `battingOrder` across past competitive games (`competitiveness >= 50 OR gameType='tournament'`). We learn from the SAVED FINAL order (manual edits are baked in — there is no separate edit-audit signal). OPS already includes imported stats via `getBattingTotalsForPlayers`.
- **Roster Names**: `players.firstName` + `lastName` required on writes; `players.name` is the derived "First Last" kept in sync server-side. Bulk-import accepts either. Legacy single-token rows tolerated with empty lastName.

### Field Display (iPad/dugout)
- **Offline Support**: `localStorage` cache + pending changes, last-writer-wins. Any thrown error on flush is treated as transient — pending writes stay queued and the 5s poll PAUSES while unsynced so a background GET can't overwrite optimistic state; resumes when the queue drains.
- **Brightness mode** (`fd-brightness-mode`): tri-state `auto | sunlight | dim`.
- **Controls**: "End Game" routes to `/games/:id` (no status change). "Extra" inning button bumps `game.innings` (capped at 12) via offline-aware patch.
- **Celebrations**: portaled canvas-confetti (high zIndex for iPad) + Web Audio synthesized sounds (no asset files). Take-lead and scored-run cheers with cooldowns. Audio ctx lazy-unlocked on first pointer/key (iOS Safari). Mute toggles in kebab. Honors `prefers-reduced-motion`.
- **Championship Mode**: driven per game by `games.isChampionship` (notNull, default false), set via "championship game" checkbox in Edit Game (tournament games only; PATCH rejects it on non-tournament games). Field Display auto-enables a "party, not pressure" gold treatment; the kebab toggle is a SESSION-scoped override (reset when `id` changes — a global toggle used to leak gold onto later games). One-shot welcome confetti fires once per game when the mode turns on (latch keyed on route `id`, gated on `game?.id === id`). CSS in `src/index.css`; all animations honor `prefers-reduced-motion`.
- **Tournament Hub** (`lib/tournament-status.ts`): `computeTournamentStatus` (upcoming/live/completed + DAY N OF M), `computeTournamentRecord`, `formatRecord`. Used by the `tournaments.tsx` listing cards (games bucketed by `tournamentId` in a `useMemo` so render is O(T+G)) and the `tournament-detail.tsx` hero.
- **Tournament Time Limits**: per-tournament pool/bracket `no_new_inning`/`hard_stop` minutes (nullable) + per-game `bracket_stage` ("pool"|"bracket"|null). Server resolves `effectiveTimeLimits` on GET `/games/:id` (picks pool vs bracket from `bracketStage`, defaults pool). Field Display `GameTimer` shows a countdown pill with color states + three one-shot toasts (gated by localStorage); purely advisory — NO chime, NO auto-finalize. Tick interval adapts 15s→1s in the final minute.
- **Tournament Pitches Panel**: when game has `tournamentId`, kebab toggle (`fd-show-tournament-pitches`, default ON) shows a "still available" board sorted by fewest pitches left today.

### Schedule & games
- **iCal opponent extraction**: `extractOpponentFromSummary(summary, teamName)` (`routes/games.ts`) splits SUMMARY on `vs/v/@/at` and matches each side against the team name at token level, so road games where the league shortened our team don't store our own team as opponent.
- **Box Score on Schedule**: when `boxScoreImportedAt` is set, `GameCard` shows a green view/edit button opening `BoxScoreImportDialog` (hydrates from saved state).
- **Box Score Import**: coach uploads 1-4 phone screenshots; each sent to gpt-5.2 in separate parallel OCR calls. Results merged by playerId. Per-game rows in `game_batting_lines` (PK `(gameId, playerId)`) so re-import is idempotent (`POST /games/:id/box-score` replaces in a transaction). Season totals from `getBattingTotalsForPlayers()` (`lib/batting-totals.ts`) which unions manual `batting_stats` + summed `game_batting_lines`.
- **Season Batting Import** (`POST /api/batting/extract` → review → `POST /api/batting/import-season`): "Import Stats" accepts a **GameChanger CSV export** OR an image/PDF. Route branches on file type: CSV is parsed DETERMINISTICALLY (no AI charge) by `extractGameChangerBatting`; images/PDF use the gpt-5.2 vision path (`chargeAiCall` only there). `import-season` stores FULL season totals + a `seasonImportedAt` cutoff so it overrides prior box-score rollups while future games accumulate on top. **GameChanger CSV gotcha**: 2-row header (section markers row + column-names row); H/R/BB/SO/SB/HBP appear in BOTH batting & pitching sections, so batting reads are scoped to columns LEFT of the "Pitching" marker. Players matched by unique jersey number then normalized name; parsing stops at Totals/Glossary; leading UTF-8 BOM stripped.

### Feature flags & toggles
- **Tournament Flag** (`team_settings.usesTournaments`, default `true`): master switch for tournament UI discoverability. When `false`, drops the nav leaf and the "Tournament" game-type option; existing tournament rows still render.
- **GameChanger Flag** (`team_settings.usesGameChanger`, default `false`): opts into a derived `box_score` dashboard task for past games missing a box score. Dismissible via `task_dismissals`.
- **Web Push — Box-Score Reminders**: when `usesGameChanger=true` and the coach opts in, the API fires Web Push ~2h after `gameDate`. Subscriptions in `push_subscriptions`; `box-score-reminder-scheduler.ts` polls every 5min with a single-flight guard and an atomic claim (`UPDATE … RETURNING`), prunes dead endpoints. Resets when the box score is (re-)imported. No-ops if VAPID env vars are missing.

### Soft delete & undo
- `players`, `games`, `practices`, `tournaments` carry nullable `deletedAt`. DELETE stamps; `POST /:id/restore` clears. Every read filters `isNull(deletedAt)` (admin routes don't, for audit).
- Box-score and manual-batting deletes use snapshot+restore. Frontend wires Undo via `src/lib/undo-toast.tsx` (~10s toast action).

### Onboarding & landing
- **Onboarding Wizard** (`/welcome`): 7 steps posting to `POST /api/team-settings/complete-onboarding`. **Auto-redirect is disabled** (`OnboardingGate` is a passthrough — forcing legacy coaches back kept re-prompting); still reachable manually.
- Signed-out `/` renders `pages/landing.tsx` (marketing landing) instead of bouncing to `/sign-in`.
- Invite emails stored on `team_invites.invitedEmail`; today coach copies the join link.

### PWA & performance
- **PWA**: `vite-plugin-pwa` (`generateSW`/Workbox, `autoUpdate`) precaches the app shell. Runtime caching limited to Google Fonts; `/api`, `/sign-in`, `/sign-up` denylisted (data caching owned by React Query's `PersistQueryClientProvider` — IndexedDB, 14-day maxAge). On user change, `qc.clear()` + purge persisted cache. `<InstallPwaPrompt>` shows a one-time iOS A2HS banner.
- **Bundle splitting**: `vite.config.ts` `manualChunks` splits node_modules into stable vendor chunks that cache across deploys.
- **Offline write queue** (`src/lib/offline-queue.ts`): a `useSyncExternalStore` observable counting pending Field Display writes (`fd-pending-*` localStorage keys). `<SyncStatusChip>` renders status. On browser `online`, `<OnlineResumer>` drains the localStorage queue → `resumePausedMutations()` → `invalidateQueries()` (order matters).
- **Mutation persistence across reloads**: paused mutations dehydrate to IndexedDB; `registerMutationDefaults` (`src/lib/mutation-defaults.ts`) registers the allowlist (idempotent, no `File`/`Blob`, safe to replay) so rehydrated mutations can resume. Field Display's `saveLineup`/`updateGame` use `networkMode: "always"` and ride the localStorage queue instead — see the docblock for what's intentionally excluded.

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
- "Lineup Fairness" dial (0-100 slider); info tooltip explains the score (per-player bench-rate stddev across completed games, scored 100 − stddev × 200).
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

## Pointers

Clerk · Drizzle ORM · Zod · Orval · Tailwind CSS · shadcn/ui · Recharts · Google Fonts (Oswald, Roboto Mono).
