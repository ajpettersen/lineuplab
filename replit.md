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

**Required ENV Vars:**
- `CLERK_SECRET_KEY`
- `DATABASE_URL`
- `OPENAI_API_KEY`
- `MASTER_ADMIN_USER_IDS` (comma-separated Clerk user IDs)

## Stack

- **Frameworks**: React, Express
- **Runtime**: Node.js 24
- **ORM**: Drizzle ORM
- **Validation**: Zod (v4)
- **Build Tool**: Vite
- **UI**: Tailwind CSS, shadcn/ui
- **Charting**: Recharts
- **Routing**: Wouter
- **Auth**: Clerk

## Where things live

- **Frontend Source**: `src/`
- **Backend Source**: `api-server/src/`
- **Database Schema**: `api-server/src/db/schema.ts`
- **API Contracts**: `api-server/src/routes/` (generated client in `src/lib/api-client/`). Note: `/api/batting` and `/api/pitching` are hand-rolled (not in OpenAPI) — call with plain `fetch`.
- **Theme/Styling**: `src/index.css`, `tailwind.config.js`
- **Components**: `src/components/`
- **Utilities**: `src/lib/`

## Architecture decisions

- **Broadcast Visual Language**: App-wide aesthetic inspired by sports broadcasts, using Oswald for display and Roboto Mono for numerals.
- **Multi-tenancy**: Data isolation per coach (`Clerk userId`) with `assertPermission` middleware gating write routes.
- **AI Integration**: Uses `gpt-5.2` for image/text roster imports, natural language lineup generation, and practice plan suggestions.
- **Practice Plan AI**: `/api/practices/:id/generate-plan` accepts `requiredDrills?: string[]` (each guaranteed as its own block) and `coachNotes`. For blocks tagged with defensive focus areas (`infield | outfield | catching | pitching`), the AI may emit a `groups` array on the block — `{label, playerNames}[]` — splitting players by preferred position. When today's attendance has any rows marked, groups are limited to PRESENT players; otherwise the full active roster is used. Player names in groups are validated server-side against the roster, and groups round-trip through `PATCH /practices/:id`. See `routes/practice-plan-ai.ts` and `PracticeBlockJson.groups` in `lib/db/src/schema/practices.ts`.
  - **Things to work on (`practice.focusPoints`)**: Coach-authored free-text bullet list (`jsonb string[]`, capped 20 entries × 200 chars, deduped case-insensitively in `routes/practices.ts::dedupeFocusPoints`). Different from `focusAreas` (structured category keys): focusPoints are SYMPTOMS in the coach's own words ("Bunt defense", "Reading fly balls in LF"). The AI route reads them directly from the practice row (single source of truth — not in the generate body), injects them as a separate "Things to work on" prompt section instructing the model to weave coverage across blocks (NOT each as its own block, unlike requiredDrills), and tags each emitted block with `addressesFocusPoints: string[]` listing which entries it targets. Server-side `parseAiPlan` validates AI tags as case-insensitive verbatim matches against the practice's focusPoints (drops paraphrases). The practice-detail page renders an inline-editable "Things to work on" Card between the header and the Plan card; mutations flow through the standard `useUpdatePractice` hook with a local optimistic mirror + `focusPointsPendingRef` to skip the server-sync effect during in-flight writes. Block badges show "Addresses: …" pills for each tagged focus point.
- **Tournament Batting Order**: When `game.gameType === "tournament"`, the lineup generator arranges the top 5 by OPS in a table-setter / cleanup pattern (slots 1-2 = top OBPs, 3 = best remaining OPS, 4-5 = top SLGs, 6+ = OPS desc). Players missing recorded stats use the team-mean OBP/SLG (treated as average). League mode still sorts by ascending PA to even out playing time. See `lib/lineup-generator.ts`.
- **Offline Support**: Field Display page uses `localStorage` for caching and pending changes, with last-writer-wins conflict resolution. The flush chain (`flushSave` / `flushGameSave`) treats ANY thrown error as transient — pending writes stay in localStorage and the per-side 5s poll PAUSES while `hasUnsyncedLineup` / `hasUnsyncedScore` is true, so a successful background GET on a flaky/captive-portal connection can't overwrite optimistic state with stale server data. Polling + window-focus refetch resume automatically when the pending queue drains. Brightness mode (`fd-brightness-mode`) is a tri-state cycle: `auto | sunlight | dim` — sunlight forces the brightest grass palette + a 12% white wash for direct-sun legibility; the legacy `fd-dim-mode` boolean is migrated on first read. Field Display also has an "End Game" Flag button (confirms → routes to `/games/:id`, no status change) and an "Extra" inning button that appears only at the last inning and bumps `game.innings` via the offline-aware patch chain (capped at 12).
- **Master Admin Bypass**: `MASTER_ADMIN_USER_IDS` environment variable allows app owners to bypass team scoping and access an `/admin` page (lists all teams + drill-into each). Also enables a "view as this team" switch from admin.
- **Team Branding**: `team_settings.primaryColor` + `secondaryColor` (nullable HSL strings, format `"H S% L%"`). When set, `<TeamThemeApplier>` (mounted in `Layout`) overrides `--primary`/`--ring` and `--accent`/`--sidebar-primary`/`--sidebar-ring` CSS vars on `<html>`. Coaches pick from preset swatches in Settings → Team Colors (head coach only). `null` = app default (deep navy + warm gold). See `team-theme-applier.tsx` + `team-colors-card.tsx`.
- **Per-Team Coach Profile**: Each coach's `displayName` + `role` lives on `team_memberships` (the owner has a row too with `isOwner=true`). Names are prompted via a one-time modal on first load (`coach-profile-prompt.tsx`).
- **Permission Tiers**: `team_memberships.permission` is `full | partial | upload | view` (linear rank: view < upload < partial < full). Server enforces with `assertPermission(level)` middleware (see `lib/permissions.ts`); web hides write controls via `usePermission()`. Owner row is locked to `full`. The `upload` tier is for a stat-keeper / "GameChanger" parent — read-only everywhere EXCEPT `/games/:id/box-score*` which gates at `upload` so partial+full pass too. **Access tier and role title are decoupled**: `team_memberships.role` is a free-form display label ("Head Coach", "Pitching Coach", "Stat Mom", etc.) while `permission` controls what the coach can actually do. Both `displayName` and `role` are inline-editable from the Coaches card (anyone can edit themselves; head coach / master admin can edit any teammate). Self-service account ID copy lives behind a "Show your account ID" disclosure at the bottom of the coach list (master-admin setup convenience).
- **Tournament Feature Flag**: `team_settings.usesTournaments` (boolean, default `true`) is the master switch for tournament UI. When `false`, `useTeamSettings()` reports `usesTournaments=false` and: (1) the `Layout` Events nav drops the "Tournaments" leaf, (2) the `new-game.tsx` and `games.tsx` (`EditGameDialog`) game-type pickers omit the "Tournament" option. The `/tournaments` route still mounts so existing tournament games keep deep-linking, and `gameType="tournament"` rows continue to render their badges + tournament lineup behavior — this flag only controls discoverability of the feature, not historical data. Toggled from Settings → Defaults → "We play tournaments". See `routes/team-settings.ts`, `hooks/use-team-settings.ts`.
- **GameChanger Box-Score Reminders**: `team_settings.usesGameChanger` (boolean, default false) opts a team into a derived `box_score` dashboard task — surfaces past non-cancelled games with `boxScoreImportedAt IS NULL`, dismissible via existing `task_dismissals` (taskType `box_score`). Toggled from Settings → Defaults → "We use GameChanger". See `routes/dashboard.ts` + `pages/settings.tsx`.
- **Roster Names**: `players.firstName` + `players.lastName` are required on writes; `players.name` is the derived "First Last" display string kept in sync server-side. The bulk-import schema accepts either (`name` is split on the last whitespace as a fallback). Box-score AI matching expands the roster prompt to include the "F. Lastname" alias so GameChanger screenshots line up reliably. Legacy single-token rows are tolerated with empty lastName until a coach edits them. See `lib/db/src/schema/players.ts`, `routes/players.ts`, and `src/lib/player-name.ts`.
- **Stats Navigation**: Two top-bar items — **Rotation Report** (`/stats`, fielding-time + import-history tabs) and **Season Stats** (`/season-stats`, batting + pitching tabs). The shared `<BattingTab>` lives in `src/components/batting-tab.tsx` so the Season Stats page can compose it alongside `<PitchingTab>`. Pitching aggregates come from `GET /api/pitching` (`routes/pitching.ts`) which rolls up `pitch_counts` per pitcher (totalPitches, outings, avg/max per outing, last outing date) joined with `games.gameDate`.
- **Soft delete + Undo**: `players`, `games`, `practices`, `tournaments` carry a nullable `deletedAt` column. DELETE handlers stamp it; matching `POST /:id/restore` clears it. Every read site filters `isNull(deletedAt)` (admin routes intentionally don't, so app owners can audit). Box-score delete uses snapshot+restore (`DELETE /games/:id/box-score` returns the prior `{lines, pitchCounts, importedAt, ourScore, opponentScore}`; `POST /games/:id/box-score/restore` re-applies it in a transaction). Manual batting stats use `POST /api/batting/clear-all` (gated by `{confirm:"DELETE"}`) → returns snapshot → `POST /api/batting/restore` re-inserts. Frontend wires Undo via `src/lib/undo-toast.tsx` (~10 s shadcn toast action). The per-row Trash on Season Stats was retired in favor of the bulk nuke flow (per-row PUT/DELETE endpoint kept for back-compat).
- **Box Score on Schedule**: When a game's `boxScoreImportedAt` is set, the schedule (`games.tsx`) `GameCard` shows a green `FileText` icon button that opens the existing `BoxScoreImportDialog` (which auto-hydrates from saved state into the editable preview). This is the at-a-glance "submitted" indicator AND the view/edit entry point — no separate read-only view exists.
- **Onboarding Wizard**: `/welcome` route hosts a 7-step wizard (welcome → coach profile → team identity → colors → roster → invite coaches → tour) that posts to `POST /api/team-settings/complete-onboarding` on the final step. **Auto-redirect is disabled** — the `OnboardingGate` is currently a passthrough because forcing existing coaches (whose legacy row had a null `onboardingCompletedAt`) back into the wizard kept re-prompting them for team identity they'd already set. Anyone can still navigate to `/welcome` manually. Signed-out `/` renders `pages/landing.tsx` (free-marketing landing) instead of bouncing to `/sign-in`. Invite emails are stored on `team_invites.invitedEmail` with a `sentEmailAt` timestamp reserved for a future email-delivery worker — today the coach still copies the join link.
- **Offline / PWA**: `vite-plugin-pwa` registers a service worker (`generateSW`/Workbox, `registerType: "autoUpdate"`) that precaches the app shell + SPA-falls-back navigation requests to `index.html`. Runtime caching is intentionally limited to Google Fonts — `/api`, `/sign-in`, `/sign-up` are denylisted from the navigation fallback and never SW-cached, because data caching is owned by React Query's `PersistQueryClientProvider` (see `src/lib/query-persister.ts` — IndexedDB via `idb-keyval`, 14-day `maxAge`, `gcTime` matched, `buster: "v1.0.0"`). Per-user safety leans on the existing `ClerkQueryClientCacheInvalidator` which calls `qc.clear()` + `purgePersistedQueryCache()` on user change. PWA install icon, favicon, and apple-touch-icon all point at `public/icon.png` (single 1024² master, ~15% safe-zone padding for iOS's circular mask); manifest declares `sizes="192x192 512x512 1024x1024"` `purpose="any maskable"`. `<InstallPwaPrompt>` (in `Layout`) shows a one-time iOS A2HS banner (re-shows after 60d). `index.html` has the `apple-mobile-web-app-*` + `theme-color` meta tags. See `vite.config.ts` `VitePWA(...)`.
  - **Phase 2 — write queue visibility + auto-resume**: `src/lib/offline-queue.ts` is a tiny `useSyncExternalStore`-backed observable that counts pending offline writes. Sources scanned today: Field Display localStorage keys matching `fd-pending-save-v1:*` and `fd-pending-game-patch-v1:*` (the field-display already has its own per-page queue with last-writer-wins semantics — Phase 2 just makes it globally visible). `field-display.tsx`'s `saveJSON`/`clearKey` helpers call `bumpOfflineQueueCount()` whenever they touch a pending key, and a window `storage` listener picks up cross-tab drains. `<SyncStatusChip>` (header) now renders four states: `Loading` (rehydrating IDB) → `Offline · N waiting` (no network, pending writes) → `Offline` (no network, idle) → `Syncing N` (online, pending writes + `useIsMutating()` count) → hidden (idle online). `<OnlineResumer>` (mounted in App.tsx next to `ClerkQueryClientCacheInvalidator`) listens for the browser `online` event, calls `qc.resumePausedMutations()` then `qc.invalidateQueries()`, then re-bumps the queue count. This auto-resume benefits any mutation using the default `networkMode: "online"` (which pauses-when-offline) — field-display itself is unaffected because it explicitly uses `networkMode: "always"` and runs its own drain. Mutation persistence across reloads is still off (`shouldDehydrateMutation: () => false`); enabling that would require `setMutationDefaults` registrations for every persisted mutation type — Phase 3.
- **Box Score Import**: GameChanger-style import. Coach uploads 1-4 phone screenshots; each image is sent to gpt-5.2 in a SEPARATE PARALLEL call (`reasoning_effort: "minimal"` since it's OCR/transcription, not reasoning) — wall-clock for a 4-image upload is roughly the same as a single image. Results are merged by playerId, keeping the row whose stat columns sum highest on overlap so re-scrolled screenshots don't double-count. Final score is taken from the first image where both sides are present. Per-game rows live in `game_batting_lines` (PK `(gameId, playerId)`) so re-import is idempotent — `POST /games/:id/box-score` replaces all lines for the game in a transaction, upserts pitch counts, sets score + status=completed + `boxScoreImportedAt`. Season totals come from `getBattingTotalsForPlayers()` (`api-server/src/lib/batting-totals.ts`) which unions manual `batting_stats` counts with summed `game_batting_lines` and recomputes rates; consumed by GET `/batting` and the lineup generator (no double-counting). DELETE clears lines + counts + flag (preserves `ourScore` so coach can keep manual edits).

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

- I prefer a deep navy primary (`220 85% 22%`), warm gold accent (`42 95% 55%`), cool off-white background.
- I want the header text to come from `team_settings.teamName` (no hardcoded brand).
- I want the lineup grid to use pill-shaped player chips, circular inning badges, and alternating row backgrounds.
- I want to be able to copy a new lineup from any past game's positions.
- I want to be able to import a lineup from a screenshot (PNG/JPEG/WebP, up to 6 MB raw).
- I want to be able to edit recorded lineups even after marking a game complete.
- I want to be able to "lock" players into specific positions for an inning or "all innings".
- I want a "Lineup Fairness" dial (0-100 slider) to control how strongly the generator equalizes playing time.
- I want to be able to import rosters in bulk using AI, either by pasting freeform text or uploading a screenshot.
- I want to be able to paste an iCal/webcal URL to import game schedules.
- I want an AI Assistant that can answer "why" questions about lineups and regenerate lineups based on natural language instructions.
- I want editable game cards with a pencil icon for inline editing.
- I want inline lineup editing with drag-and-drop functionality and the ability to copy the lineup to Sheets.
- I want a "Innings by Position" tally visible below the lineup card, showing pitching, infield, outfield, and bench counts per player.
- I want the dashboard "Total Games" stat to only count actual games, excluding practices and other events.
- I want a Settings → Defaults toggle to hide the Fairness Score (both the Dashboard card and the Rotation Report bar) for coaches who don't want the metric on screen.
- I want a Settings → Defaults toggle to hide the "Make this lineup more equitable" suggestions popup on the game lineup view.
- I want a small info tooltip next to the Fairness Score that explains how it's calculated (per-player bench-rate stddev across completed games, scored 100 − stddev × 200).
- I want the practice planner AI to incorporate specific drills I name ("Must-include drills" textarea, one per line) and to group players by preferred position on defensive blocks when it makes sense.
- I want to import GameChanger box scores by uploading 1-4 phone screenshots; the AI should extract per-player batting and pitching lines plus the final score, with an editable preview before saving, and re-importing should replace (not duplicate) the prior import.

## Gotchas

- The `formatPlayerNameShort()` helper in `src/lib/player-name.ts` should always be used for short player name displays (`First L.`) instead of manual string splitting.
- When changing the tie badge format, ensure consistency across `dashboard.tsx`, `games.tsx`, and `game-detail.tsx`.
- The team's `team_settings.activeFieldPositions` (standard 9 with CF, or 10-player with LCF+RCF) is the source of truth for defensive shape — flow it through any new lineup-generating or grid-rendering surface (see `lineups.ts`, `ai-assistant.ts`, `game-detail.tsx`, `field-display.tsx` for the pattern; render historical lineups via the `active ∪ positions present` union so old games don't lose columns).
- iCal opponent extraction uses `extractOpponentFromSummary(summary, teamName)` in `api-server/src/routes/games.ts` — it splits the SUMMARY on `vs/v/@/at` and matches each side against the user's `team_settings.teamName` at the token level so road games where the league shortened your team to just a color (e.g. `Plymouth @ Blue`) don't store your own team as the opponent.
- Every matchup display shows `{teamName from settings} vs. {formatOpponentForMatchup(opponent, teamName)}` (in `src/lib/team-name.ts`). The helper strips trailing parenthesized venues, prefers the `at <host>` side when the league mashed our coach/age into the opponent string ("10AA Blue - Pettersen at Westonka 10AA (Westonka)" → "Westonka"), and de-dupes our-team tokens. Use it everywhere a matchup is rendered (game-detail header/print/copy-from, games list, dashboard hero/upcoming/tasks, field-display). Inline subcomponents (e.g. `GameCard` in `games.tsx`) must receive `teamName` as a prop — Vite's react-refresh transform hoists inline arrow components to module scope, breaking closure references to outer hook values.

## Pointers

- **Clerk Documentation**: `https://clerk.com/docs`
- **Drizzle ORM Documentation**: `https://orm.drizzle.team/docs`
- **Zod Documentation**: `https://zod.dev/`
- **Orval Documentation**: `https://orval.dev/docs`
- **Tailwind CSS Documentation**: `https://tailwindcss.com/docs`
- **shadcn/ui Documentation**: `https://ui.shadcn.com/docs`
- **Recharts Documentation**: `https://recharts.org/en-US/api`
- **Google Fonts**: `https://fonts.google.com/` (Oswald, Roboto Mono)