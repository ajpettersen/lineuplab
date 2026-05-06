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
- **Tournament Batting Order**: When `game.gameType === "tournament"`, the lineup generator arranges the top 5 by OPS in a table-setter / cleanup pattern (slots 1-2 = top OBPs, 3 = best remaining OPS, 4-5 = top SLGs, 6+ = OPS desc). Players missing recorded stats use the team-mean OBP/SLG (treated as average). League mode still sorts by ascending PA to even out playing time. See `lib/lineup-generator.ts`.
- **Offline Support**: Field Display page uses `localStorage` for caching and pending changes, with last-writer-wins conflict resolution.
- **Master Admin Bypass**: `MASTER_ADMIN_USER_IDS` environment variable allows app owners to bypass team scoping and access an `/admin` page (lists all teams + drill-into each). Also enables a "view as this team" switch from admin.
- **Per-Team Coach Profile**: Each coach's `displayName` + `role` lives on `team_memberships` (the owner has a row too with `isOwner=true`). Names are prompted via a one-time modal on first load (`coach-profile-prompt.tsx`).
- **Permission Tiers**: `team_memberships.permission` is `full | partial | upload | view` (linear rank: view < upload < partial < full). Server enforces with `assertPermission(level)` middleware (see `lib/permissions.ts`); web hides write controls via `usePermission()`. Owner row is locked to `full`. The `upload` tier is for a stat-keeper / "GameChanger" parent — read-only everywhere EXCEPT `/games/:id/box-score*` which gates at `upload` so partial+full pass too. **Access tier and role title are decoupled**: `team_memberships.role` is a free-form display label ("Head Coach", "Pitching Coach", "Stat Mom", etc.) while `permission` controls what the coach can actually do. Both `displayName` and `role` are inline-editable from the Coaches card (anyone can edit themselves; head coach / master admin can edit any teammate). Self-service account ID copy lives behind a "Show your account ID" disclosure at the bottom of the coach list (master-admin setup convenience).
- **GameChanger Box-Score Reminders**: `team_settings.usesGameChanger` (boolean, default false) opts a team into a derived `box_score` dashboard task — surfaces past non-cancelled games with `boxScoreImportedAt IS NULL`, dismissible via existing `task_dismissals` (taskType `box_score`). Toggled from Settings → Defaults → "We use GameChanger". See `routes/dashboard.ts` + `pages/settings.tsx`.
- **Roster Names**: `players.firstName` + `players.lastName` are required on writes; `players.name` is the derived "First Last" display string kept in sync server-side. The bulk-import schema accepts either (`name` is split on the last whitespace as a fallback). Box-score AI matching expands the roster prompt to include the "F. Lastname" alias so GameChanger screenshots line up reliably. Legacy single-token rows are tolerated with empty lastName until a coach edits them. See `lib/db/src/schema/players.ts`, `routes/players.ts`, and `src/lib/player-name.ts`.
- **Stats Navigation**: Two top-bar items — **Rotation Report** (`/stats`, fielding-time + import-history tabs) and **Season Stats** (`/season-stats`, batting + pitching tabs). The shared `<BattingTab>` lives in `src/components/batting-tab.tsx` so the Season Stats page can compose it alongside `<PitchingTab>`. Pitching aggregates come from `GET /api/pitching` (`routes/pitching.ts`) which rolls up `pitch_counts` per pitcher (totalPitches, outings, avg/max per outing, last outing date) joined with `games.gameDate`.
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
- Every matchup display shows `{teamName from settings} vs. {shortenTeamName(opponent)}`. Inline subcomponents (e.g. `GameCard` in `games.tsx`) must receive `teamName` as a prop — Vite's react-refresh transform hoists inline arrow components to module scope, breaking closure references to outer hook values.

## Pointers

- **Clerk Documentation**: `https://clerk.com/docs`
- **Drizzle ORM Documentation**: `https://orm.drizzle.team/docs`
- **Zod Documentation**: `https://zod.dev/`
- **Orval Documentation**: `https://orval.dev/docs`
- **Tailwind CSS Documentation**: `https://tailwindcss.com/docs`
- **shadcn/ui Documentation**: `https://ui.shadcn.com/docs`
- **Recharts Documentation**: `https://recharts.org/en-US/api`
- **Google Fonts**: `https://fonts.google.com/` (Oswald, Roboto Mono)