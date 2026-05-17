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

**Required ENV Vars:** `CLERK_SECRET_KEY`, `DATABASE_URL`, `OPENAI_API_KEY`, `MASTER_ADMIN_USER_IDS` (comma-separated Clerk user IDs), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (for web push; degrades gracefully if absent).

## Stack

- **Frameworks**: React, Express
- **Runtime**: Node.js 24
- **ORM**: Drizzle ORM
- **Validation**: Zod (v4)
- **Build Tool**: Vite (with manual vendor chunk splitting — see `vite.config.ts`)
- **UI**: Tailwind CSS, shadcn/ui
- **Charting**: Recharts
- **Routing**: Wouter
- **Auth**: Clerk
- **AI**: `gpt-5.2`

## Where things live

- **Frontend**: `src/`
- **Backend**: `api-server/src/`
- **DB Schema**: `api-server/src/db/schema.ts`
- **API Contracts**: `api-server/src/routes/` (generated client in `src/lib/api-client/`). Note: `/api/batting` and `/api/pitching` are hand-rolled (not in OpenAPI) — call with plain `fetch`. Web Push routes (`/api/push/*`) are also hand-rolled.
- **Theme/Styling**: `src/index.css`, `tailwind.config.js`
- **Components**: `src/components/`
- **Utilities**: `src/lib/`

## Architecture decisions

### Core
- **Multi-tenancy**: Data isolation per coach (`Clerk userId`) with `assertPermission` middleware gating write routes.
- **Permission Tiers** (`team_memberships.permission`): `view < upload < partial < full` (linear rank). Owner row locked to `full`. Server enforces via `assertPermission(level)` (`lib/permissions.ts`); web hides write controls via `usePermission()`. `upload` is for a stat-keeper / "GameChanger" parent — read-only EXCEPT `/games/:id/box-score*`. **`role` (free-form display label) is decoupled from `permission` (what they can do).** Both inline-editable from the Coaches card.
- **Per-Team Coach Profile**: `displayName` + `role` on `team_memberships` (owner has a row with `isOwner=true`). Prompted via one-time modal (`coach-profile-prompt.tsx`).
- **Master Admin Bypass**: `MASTER_ADMIN_USER_IDS` env enables `/admin` page (all teams + "view as this team" switch); admin routes intentionally don't filter `isNull(deletedAt)` so app owners can audit.

### Visual
- **Broadcast Visual Language**: App-wide aesthetic inspired by sports broadcasts (Oswald display + Roboto Mono numerals).
- **Team Branding**: `team_settings.primaryColor` + `secondaryColor` (nullable HSL strings, format `"H S% L%"`). `<TeamThemeApplier>` (in `Layout`) overrides `--primary`/`--ring`/`--accent`/`--sidebar-primary`/`--sidebar-ring` CSS vars on `<html>`. Coaches pick from preset swatches in Settings → Team Colors (head coach only). `null` = app default. See `team-theme-applier.tsx` + `team-colors-card.tsx`.

### AI features
- **Roster import** (image/text), **lineup generation** (natural language), **practice plan suggestions**, **box-score import** all use `gpt-5.2`.
- **Practice Plan AI**: `/api/practices/:id/generate-plan` accepts `requiredDrills?: string[]` (each guaranteed as its own block) and `coachNotes`. Blocks tagged with defensive focus areas (`infield|outfield|catching|pitching`) may emit a `groups: {label, playerNames}[]` array splitting players by preferred position. When today's attendance has rows marked, groups are PRESENT-only; otherwise full active roster. Server validates names against roster; groups round-trip through `PATCH /practices/:id`.
- **Things to work on** (`practice.focusPoints`): Coach-authored free-text bullet list (`jsonb string[]`, capped 20×200 chars, deduped case-insensitively). SYMPTOMS in coach's own words ("Bunt defense"). AI weaves coverage across blocks (NOT each as its own block, unlike `requiredDrills`) and tags blocks with `addressesFocusPoints: string[]`. Server `parseAiPlan` validates AI tags as case-insensitive verbatim matches (drops paraphrases). Practice-detail page renders inline-editable Card between header and Plan; mutations use `useUpdatePractice` + local optimistic mirror + `focusPointsPendingRef`.

### Lineup & rotation
- **Active positions** (`team_settings.activeFieldPositions`): standard 9 (with CF) or 10-player (LCF+RCF) — source of truth for defensive shape. Flow through any lineup-generating/grid-rendering surface; render historical lineups via `active ∪ positions present` so old games don't lose columns.
- **Tournament Batting Order**: When `game.gameType === "tournament"`, lineup generator arranges top 5 by OPS in a table-setter/cleanup pattern (1-2 = top OBPs, 3 = best remaining OPS, 4-5 = top SLGs, 6+ = OPS desc). Players missing stats use team-mean OBP/SLG. League mode sorts by ascending PA. See `lib/lineup-generator.ts`.
- **Roster Names**: `players.firstName` + `players.lastName` required on writes; `players.name` is the derived "First Last" display string kept in sync server-side. Bulk-import accepts either (`name` split on last whitespace as fallback). Box-score AI matching includes "F. Lastname" alias for screenshot alignment. Legacy single-token rows tolerated with empty lastName.

### Field Display (iPad/dugout)
- **Offline Support**: `localStorage` cache + pending changes, last-writer-wins. `flushSave`/`flushGameSave` treats ANY thrown error as transient — pending writes stay in `localStorage`, the 5s poll PAUSES while `hasUnsyncedLineup`/`hasUnsyncedScore` is true so a successful background GET can't overwrite optimistic state. Resumes when queue drains.
- **Brightness mode** (`fd-brightness-mode`): tri-state `auto | sunlight | dim` — sunlight forces brightest grass palette + 12% white wash; legacy `fd-dim-mode` boolean migrated on first read.
- **Controls**: "End Game" Flag button confirms → routes to `/games/:id` (no status change). "Extra" inning button appears at last inning, bumps `game.innings` via offline-aware patch chain (capped at 12).
- **Celebrations**: Canvas-confetti scoped to a portaled canvas at zIndex 2147483646 for iPad visibility. Take-lead big show + scored-run small cheer with 600ms cooldowns. Web Audio API synthesized sounds (no asset files) — `playRunCheerSound` (C5→E5→G5 triangle arpeggio) and `playFanfareSound` (G4→C5→E5 sawtooth stab + sustained C5/E5/G5 chord + C6 pop, lowpassed). Honor `prefers-reduced-motion`. Audio ctx lazy-created on first pointerdown/keydown (iOS Safari unlock). Mute toggles for fireworks AND sound in kebab.
- **Championship Mode** (`fd-championship-mode`): opt-in via kebab on tournament games. Adds pulsing gold frame glow (`fd-championship`), animated rainbow chyron sweep (`fd-champ-chyron` — the ONLY animated piece; field/lineup chips stay static), pulsing scoreboard glow (`fd-champ-score`), Crown icons + "CHAMPIONSHIP" pre-title. CSS in `src/index.css`. Honors `prefers-reduced-motion`.
- **Tournament Pitches Panel**: When game has `tournamentId`, kebab toggle (`fd-show-tournament-pitches`, defaults ON) renders compact "still available" board sorted by FEWEST pitches LEFT today (resting pitchers first, then ascending). On phones only shows when viewing Order tab so the Field tab keeps full height.

### Schedule & games
- **iCal opponent extraction**: `extractOpponentFromSummary(summary, teamName)` (`api-server/src/routes/games.ts`) splits SUMMARY on `vs/v/@/at` and matches each side against `team_settings.teamName` at token level so road games where the league shortened your team to a color (e.g. `Plymouth @ Blue`) don't store your own team as opponent.
- **Box Score on Schedule**: When `boxScoreImportedAt` is set, `GameCard` shows green `FileText` icon button opening `BoxScoreImportDialog` (auto-hydrates from saved state into editable preview) — at-a-glance "submitted" indicator AND view/edit entry point.
- **Box Score Import**: GameChanger-style. Coach uploads 1-4 phone screenshots; each sent to gpt-5.2 in SEPARATE PARALLEL calls (`reasoning_effort: "minimal"` since it's OCR). Results merged by playerId, keeping row whose stat columns sum highest on overlap. Final score from first image where both sides present. Per-game rows in `game_batting_lines` (PK `(gameId, playerId)`) so re-import is idempotent — `POST /games/:id/box-score` replaces all lines in a transaction. Season totals from `getBattingTotalsForPlayers()` (`api-server/src/lib/batting-totals.ts`) which unions manual `batting_stats` + summed `game_batting_lines` and recomputes rates.

### Feature flags & toggles
- **Tournament Flag** (`team_settings.usesTournaments`, default `true`): master switch for tournament UI. When `false`, Layout drops "Tournaments" nav leaf and new-game/edit-game pickers omit "Tournament" option. `/tournaments` route still mounts; `gameType="tournament"` rows still render correctly — flag only controls discoverability. Toggled from Settings → Defaults.
- **GameChanger Flag** (`team_settings.usesGameChanger`, default `false`): opts team into derived `box_score` dashboard task surfacing past non-cancelled games with `boxScoreImportedAt IS NULL`. Dismissible via `task_dismissals` (taskType `box_score`).
- **Web Push — Box-Score Reminders**: When `usesGameChanger=true` AND coach opts in via Settings → "Box-score reminder push", API fires Web Push ~2h after `gameDate`. `web-push` lib signed with VAPID env vars (singleton in `api-server/src/lib/push.ts`); subscriptions in `push_subscriptions` (PK on endpoint, FK to coach `userId`); `box-score-reminder-scheduler.ts` polls every 5min with single-flight guard, uses `UPDATE games SET boxScoreReminderSentAt=now() WHERE … AND boxScoreReminderSentAt IS NULL RETURNING *` as atomic claim, prunes 404/410 endpoints. `boxScoreReminderSentAt` resets to `null` when box score is (re-)imported. Custom `push-sw.js` is `importScripts`-merged into Workbox SW (vite-plugin-pwa). `usePushNotifications()` hook owns capability/permission/subscribe state machine and detects iOS-not-installed-PWA. If VAPID env vars missing, scheduler + routes no-op.

### Soft delete & undo
- `players`, `games`, `practices`, `tournaments` carry nullable `deletedAt`. DELETE stamps; `POST /:id/restore` clears. Every read site filters `isNull(deletedAt)` (admin routes don't, for audit).
- Box-score delete uses snapshot+restore: `DELETE /games/:id/box-score` returns prior state; `POST /games/:id/box-score/restore` re-applies in transaction.
- Manual batting: `POST /api/batting/clear-all` (gated by `{confirm:"DELETE"}`) → snapshot → `POST /api/batting/restore`.
- Frontend wires Undo via `src/lib/undo-toast.tsx` (~10s shadcn toast action).

### Onboarding & landing
- **Onboarding Wizard** (`/welcome`): 7-step (welcome → coach profile → team identity → colors → roster → invite coaches → tour) posts to `POST /api/team-settings/complete-onboarding`. **Auto-redirect is disabled** — `OnboardingGate` is a passthrough because forcing legacy coaches back into the wizard kept re-prompting them. Anyone can still navigate to `/welcome` manually.
- Signed-out `/` renders `pages/landing.tsx` (free-marketing landing) instead of bouncing to `/sign-in`.
- Invite emails stored on `team_invites.invitedEmail` with `sentEmailAt` reserved for future delivery worker — today coach copies join link.

### PWA & performance
- **PWA**: `vite-plugin-pwa` registers SW (`generateSW`/Workbox, `registerType: "autoUpdate"`) precaching app shell + SPA-falls-back navigation to `index.html`. Runtime caching limited to Google Fonts — `/api`, `/sign-in`, `/sign-up` denylisted (data caching owned by React Query's `PersistQueryClientProvider`; see `src/lib/query-persister.ts` — IndexedDB via `idb-keyval`, 14-day `maxAge`, `buster: "v1.0.0"`). Per-user safety: `ClerkQueryClientCacheInvalidator` calls `qc.clear()` + `purgePersistedQueryCache()` on user change. Icons + favicon point at `public/icon.png` (1024² master, ~15% safe-zone padding for iOS). `<InstallPwaPrompt>` shows one-time iOS A2HS banner (re-shows after 60d).
- **Bundle splitting**: `vite.config.ts` `rollupOptions.output.manualChunks` splits node_modules into `react-vendor`, `clerk-vendor`, `query-vendor`, `radix-vendor`, `icons-vendor`, `date-vendor` so vendor chunks cache across deploys (entry chunk shrank from 546KB → 119KB).
- **Offline write queue visibility** (Phase 2): `src/lib/offline-queue.ts` is a `useSyncExternalStore`-backed observable counting pending writes. Sources: Field Display `localStorage` keys matching `fd-pending-save-v1:*` and `fd-pending-game-patch-v1:*`. `<SyncStatusChip>` (header) renders four states: `Loading` → `Offline · N waiting` → `Offline` → `Syncing N` → hidden. `<OnlineResumer>` (in App.tsx) listens for browser `online` event, calls `qc.resumePausedMutations()` then `qc.invalidateQueries()`. Mutation persistence across reloads is off (`shouldDehydrateMutation: () => false`); enabling would need `setMutationDefaults` registrations — Phase 3.

## Product

- Roster management (bulk AI import, preferred positions)
- Game scheduling and lineup creation
- AI-powered lineup generation (from images, natural language)
- Customizable lineup defaults and "fairness" dial
- Season statistics and Rotation Report
- Tournament mode with free-form pitch rules and tracking
- Field Display for real-time game management (optimized for iPad)
- Multi-coach team sharing with permission tiers
- Dashboard with tasks and game stats (W-L-T record)

## User preferences

- Deep navy primary (`220 85% 22%`), warm gold accent (`42 95% 55%`), cool off-white background.
- Header text from `team_settings.teamName` (no hardcoded brand).
- Lineup grid: pill-shaped player chips, circular inning badges, alternating row backgrounds.
- Copy a new lineup from any past game's positions.
- Import lineup from screenshot (PNG/JPEG/WebP, up to 6 MB raw).
- Edit recorded lineups even after marking a game complete.
- "Lock" players into specific positions for an inning or "all innings".
- "Lineup Fairness" dial (0-100 slider) to control equalization.
- Bulk roster import via AI (text or screenshot).
- Paste iCal/webcal URL to import game schedules.
- AI Assistant that answers "why" questions and regenerates lineups from natural language.
- Editable game cards with pencil icon for inline editing.
- Inline lineup editing with drag-and-drop + copy to Sheets.
- "Innings by Position" tally below lineup card (pitching/infield/outfield/bench per player).
- Dashboard "Total Games" excludes practices and other events.
- Settings toggles to hide Fairness Score (dashboard + Rotation Report) and the equity suggestions popup.
- Info tooltip next to Fairness Score explaining calculation (per-player bench-rate stddev across completed games, scored 100 − stddev × 200).
- Practice planner AI: "Must-include drills" textarea (one per line), group players by preferred position on defensive blocks when it makes sense.
- Import GameChanger box scores from 1-4 phone screenshots; AI extracts per-player batting/pitching + final score with editable preview; re-importing replaces (not duplicates).

## Gotchas

- Use `formatPlayerNameShort()` (`src/lib/player-name.ts`) for short displays (`First L.`) instead of manual string splitting.
- Tie badge format must stay consistent across `dashboard.tsx`, `games.tsx`, `game-detail.tsx`.
- Every matchup display: `{teamName from settings} vs. {formatOpponentForMatchup(opponent, teamName)}` (in `src/lib/team-name.ts`). Helper strips trailing parenthesized venues, prefers the `at <host>` side when the league mashed our coach/age into the opponent string, de-dupes our-team tokens. Inline subcomponents (e.g. `GameCard` in `games.tsx`) must receive `teamName` as a PROP — Vite's react-refresh transform hoists inline arrow components to module scope, breaking closure references.
- `team_settings.activeFieldPositions` is the source of truth for defensive shape — flow through any new lineup-generating/grid-rendering surface (see `lineups.ts`, `ai-assistant.ts`, `game-detail.tsx`, `field-display.tsx`).

## Pointers

- **Clerk**: `https://clerk.com/docs`
- **Drizzle ORM**: `https://orm.drizzle.team/docs`
- **Zod**: `https://zod.dev/`
- **Orval**: `https://orval.dev/docs`
- **Tailwind CSS**: `https://tailwindcss.com/docs`
- **shadcn/ui**: `https://ui.shadcn.com/docs`
- **Recharts**: `https://recharts.org/en-US/api`
- **Google Fonts**: `https://fonts.google.com/` (Oswald, Roboto Mono)
