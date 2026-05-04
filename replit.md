# Overview

This project is a multi-tenant lineup management system for baseball/softball coaches, designed to manage rosters, schedule games, and generate fair rotational lineups. It features team branding, customizable lineup defaults, comprehensive season statistics, and advanced AI capabilities for lineup generation from images and natural language instructions. The system aims to optimize player rotation, ensure equitable playing time, and become the leading platform for youth sports team management, with future plans for expansion to other sports and advanced predictive analytics.

# User Preferences

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

# System Architecture

## Core Technologies

- **Monorepo**: pnpm workspaces
- **Backend**: Node.js 24, Express 5
- **Database**: PostgreSQL with Drizzle ORM
- **Frontend**: React, Vite, Tailwind CSS, shadcn/ui, Recharts, Wouter
- **TypeScript**: Version 5.9
- **Validation**: Zod (v4), drizzle-zod
- **API Codegen**: Orval (from OpenAPI spec)

## UI/UX Decisions

- **Theming**: Deep navy primary, warm gold accent, cool off-white background; dynamic header text.
- **Lineup Grid**: Pill-shaped player chips, circular inning badges, alternating row backgrounds.
- **Interactive Editing**: Drag-and-drop and tap-to-move for lineup adjustments.
- **Data Visualization**: Recharts for season statistics.
- **Field Display**: Read-only page optimized for iPad, featuring dynamic lighting based on time of day, score steppers with swipe gestures, game timer, defensive drag-and-drop, and robust offline support with optimistic UI updates and auto-sync on reconnect. Three responsive layouts via Tailwind 4 `max-lg:landscape:` and `lg:` variants: phone portrait reflows the batting order to a 2-column grid with `min-h-10` rows under the field (page may scroll for deep rosters); phone landscape splits side-by-side with a 180–240px sidebar locked to viewport; iPad/desktop keeps the full 320–400px sidebar with equal-distribution rows. The `max-lg:` scoping is essential because `landscape:` is emitted after `lg:` in the compiled CSS — an unscoped `landscape:` rule would override `lg:` on iPad-landscape and shrink the iPad sidebar to phone width. **Broadcast Booth visual style** (graduated from a canvas mockup): pure-black background, deep-navy panels, broadcast-gold accents (`--color-broadcast-gold`), Oswald display headlines (`--font-display`) for team names / inning / "LINEUP" header, Roboto Mono for all numerals (score, timer, inning), rectangular geometric position chips (gold position block + navy name block with a hard shadow), gold square slot numbers on the lineup, gold left-border + "AB" pill on the currently-at-bat row, and a deep-emerald field SVG with crisp white basepaths. The visual layer was rewritten without touching any handler — `DndContext` / `useDraggable` / `useDroppable` wiring, `ScoreStepper` swipe + key handling, `GameTimer` interval, inning controls, dim mode, fullscreen, and offline sync (`flushSave` / `flushGameSave` / `pendingLineupRef`) are unchanged. The "currently at bat" highlight is hardcoded to slot 1 pending real lineup-progression state (TODO comment in source); responsive `max-lg:landscape:` / `lg:` scoping was preserved verbatim.

## Technical Implementations

- **Authentication**: Clerk for user authentication and authorization.
- **Multi-tenancy**: Data isolation per coach (`Clerk userId`).
- **Fairness Algorithm**: Configurable `global_equity_weight` for lineup generation.
- **AI Integration**: Uses `gpt-5.2` for image-based roster imports, natural language queries, lineup regeneration, and practice plan generation.
- **Data Handling**: Client-side downscaling and server-side validation for image uploads; server-side classification for iCal imports.
- **Lineup Features**: Supports "locked" positions, "Innings by Position" tally, and post-game photo overrides.
- **Game Status Management**: Differentiates between stored `status` and client-side derived `effectiveStatus`; allows dynamic game endings.
- **Team Sharing**: Multi-coach co-ownership via single-use invite links.
- **Tournament Mode**: Supports grouping games into tournaments, with pitch count tracking based on Little League rulesets and per-pitcher availability calculations.
- **Practice Planner**: Allows coaches to plan practices with date, duration, focus areas, and AI-drafted time-blocked plans, including attendance tracking. The AI generator (`practice-plan-ai.ts`) also pulls up to the 8 most recent past practices with non-empty blocks (filtered at the SQL level via `jsonb_array_length`) and feeds a "coach style digest" — favorite drill titles by frequency, typical block durations per drill type, recurring focus areas, and 4 recent practice skeletons (titles + drillType + duration only, hard-capped to bound prompt size) — into the gpt-5.2 prompt so generated plans lean into the coach's recurring drills and naming conventions while still adapting to today's focus areas.
- **Offline Support**: Field Display page ensures reads and writes survive offline using `localStorage` for caching and pending changes, with last-writer-wins conflict resolution.
- **Roster Position Coverage** (`pages/players.tsx` → `PositionCoveragePanel`): Above the roster grid (only when `players.length >= 1`), a 9-cell horizontal panel shows how many players list each position as a preferred position. Thresholds are absolute (youth rosters are small): `0` = uncovered (red, `AlertTriangle` tooltip "No one prefers this position. Consider training a player here."), `1` = thin (amber, `Info` tooltip "Only one player prefers this position — no backup if they're absent."), `>= 2` = covered (emerald). Header summary either reads "All positions covered" (with `ShieldCheck`) or "Needs depth at: 3B, RF" with each abbreviation color-coded by its level. Reuses the existing `ALL_POSITIONS` constant; computed inline (no API change). Coverage is preferred-position depth, not lineup-fill — separate concept from the generator's `eligiblePositions`.
- **Roster preferred-position select-all**: Both `ImportRosterDialog` (per-row "All" / "Clear" pill in the positions cell, `data-testid="button-pos-all-${i}"`) and `AddPlayerDialog` (single "Select all" / "Clear all" toggle next to the "Preferred Positions" label, `data-testid="button-preferred-toggle-all"`) flip between `[...ALL_POSITIONS]` and `[]`. Button label is reactive — when all 9 are currently selected the button reads "Clear" (and clears on click); otherwise reads "All" / "Select all" (and selects all on click). Reuses the existing `togglePos` / `togglePreferred` infrastructure for state shape; no new state variables.
- **Roster import (re-import merge)**: `POST /api/players/bulk` is an UPSERT — for each incoming player keyed by case-insensitive `name|number`, existing rows have their `preferredPositions` UNION-merged with the incoming positions and `canPitch` OR-merged (additive only; position removal stays an explicit per-player edit). `eligiblePositions` is recomputed via `deriveEligible(mergedCanPitch)`. `notes` is **never** touched on update — defense-in-depth against UI status strings ever leaking into a player's actual notes. The whole batch (selects + updates + inserts) runs in one `db.transaction` so a partial failure can't leave the roster half-updated. Rows that wouldn't actually change are skipped to keep the `updated` count meaningful. Response is `{ created, updated, skipped: [] }`; `skipped` is retained as an empty array purely for backwards compatibility. The `ImportRosterDialog` (`pages/players.tsx`) shows a "Will update positions" badge on duplicate rows (UI-only, via a `dup` flag — never written to the DB) and pre-includes them so re-importing an updated screenshot picks up new positions automatically. The toast summarises both counts (e.g. "Added 3 new players · updated positions for 5 existing players").
- **NumberInput component** (`components/ui/number-input.tsx`): Reusable wrapper around shadcn `Input` for any `type="number"` field. Holds an internal draft string so the user can fully clear the field, only forwards `onChange(parsedNumber)` to the parent when the draft is a finite int, and on blur clamps to min/max or commits an explicit `fallback`. This replaces the buggy `onChange={(e) => setX(parseInt(e.target.value, 10) || fallback)}` pattern (which snapped state back to the fallback the moment the field went empty, making it impossible to delete-and-retype values like 90 → 60). Currently used for practice/block durations and the default-innings/max-position/max-bench inputs in Settings; preferred for any new numeric input.
- **Demo data seed (preview-only)**: `POST /api/demo/seed` (server: `artifacts/api-server/src/routes/demo-seed.ts`; client mutation: `artifacts/baseball-lineup/src/hooks/use-demo-seeder.ts`) seeds 12 demo players + 3 games (one past with score, one today, one upcoming) for the active team — and also a full 6-inning × 12-player lineup for the one completed game (Riverdale Raptors) so the Stats / Player Detail / Innings-by-Position views actually have data to render after seeding. The lineup matrix is hand-designed (`DEMO_LINEUP_GRID`) so every inning has exactly one of each of the 9 positions + 3 benched, Jordan Park pitches innings 1-3 (his "4 inning max" note), Casey Brooks takes 4-5, and Kai Sullivan closes inning 6 (his "closer" note); each player gets at least 3 field innings and at least 1 bench inning. The whole seed (players + games + entries) runs in one `db.transaction` so a partial failure rolls back atomically. **Strictly preview/dev only** — defense in depth at three layers: (1) the server route returns 404 when `process.env.NODE_ENV === 'production'`; (2) the production `artifact.toml` for the api-server explicitly sets `NODE_ENV=production` in both `services.production.build.env` and `services.production.run.env`; (3) the client exports `DEMO_SEED_ENABLED = import.meta.env.DEV` and the entire "Demo data" card on the Settings page (`pages/settings.tsx` → `DemoDataCard`) is rendered only when that flag is true, so a production `vite build` ships zero seed UI. The endpoint is also idempotent — if the active team already has any players OR games it returns `{ created: false }` and the toast surfaces "Already have data" instead. Coaches signing into the live deployment at `lineup-lab.replit.app` therefore see no demo affordance and cannot accidentally inject sample data into a real team. **Express route convention reminder**: the main router is mounted at `app.use("/api", router)` so sub-router paths must be relative (`/demo/seed`, not `/api/demo/seed`) — the same pattern as `players.ts` (`/players`) and every other router. Writing the absolute path produces silent 404s because the resulting Express path becomes `/api/api/demo/seed`.
- **Stats only count completed games** (`api-server/src/routes/stats.ts`): both `/stats/season` and `/stats/players` filter live `lineup_entries` to those whose parent game has `status === "completed"`. This means a draft lineup on an upcoming game (e.g. coach pre-builds tomorrow's lineup, or experiments with the AI generator before game day) does NOT move season totals, position distribution, fairness score, per-player games-played, field innings, bench innings, position innings, or unavailable innings. Once the coach marks the game complete (with score), all of its innings flow into stats. Historical fielding (imported past data) is unaffected — it always counts because it represents games that already happened. Practice rows and other non-`game` event types are likewise excluded by the existing `type === "game"` filter. The `totalGames` count on `/stats/season` still reflects all scheduled games regardless of status (it answers "how many games are on the schedule") while `completedGames` answers "how many have been played"; the two are returned side-by-side so the UI can show both.

# External Dependencies

- **Clerk**: User authentication and authorization.
- **PostgreSQL**: Primary database.
- **OpenAI (GPT-5.2)**: AI vision and natural language processing.
- **Zod**: Schema validation.
- **Drizzle ORM**: Type-safe ORM.
- **Orval**: API client and Zod schema generation.
- **React**: Frontend library.
- **Vite**: Frontend build tool.
- **Tailwind CSS**: Utility-first CSS framework.
- **shadcn/ui**: UI component library.
- **Recharts**: Charting library.
- **Wouter**: React router.
- **@dnd-kit/core**: Drag-and-drop functionality.