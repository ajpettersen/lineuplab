# Overview

This project is a multi-tenant lineup management system for baseball/softball coaches. It enables coaches to manage rosters, schedule games, and generate fair rotational lineups. Key features include team branding, customizable lineup defaults, and comprehensive season statistics. The system aims to optimize player rotation, ensure equitable playing time, and offers advanced AI capabilities for lineup generation from images and natural language instructions. The long-term vision is to be the leading platform for youth sports team management, expanding to other sports and offering advanced predictive analytics for player development and game strategy.

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

- **Theming**: Deep navy primary, warm gold accent, cool off-white background.
- **Branding**: Dynamic header text from `team_settings.teamName`.
- **Lineup Grid**: Pill-shaped player chips, circular inning badges, alternating row backgrounds.
- **Interactive Editing**: Drag-and-drop and tap-to-move for lineup adjustments.
- **Data Visualization**: Recharts for season statistics.

## Technical Implementations

- **Authentication**: Clerk for user authentication and authorization.
- **Multi-tenancy**: Data isolation per coach (`Clerk userId`).
- **Fairness Algorithm**: Configurable `global_equity_weight` for lineup generation.
- **API Design**: Public `/api/healthz` and authenticated routes.
- **Image Processing**: Client-side downscaling and server-side validation for image uploads used by AI vision.
- **Lineup Locks**: Stored and enforced via database transactions; integrated with the lineup generator and AI assistant.
- **AI Assistant Integration**: Uses `gpt-5.2` for image-based roster imports, natural language queries, and lineup regeneration, including handling player pins and removals.
- **iCal Import**: Server-side classification of imported events.
- **Constraint System**: Supports numeric, boolean, and player-specific rules.
- **Team Sharing**: Multi-coach co-ownership via single-use invite links, allowing coaches to manage multiple teams with isolated data contexts.
- **Game Status Management**: Differentiates between stored `status` and client-side derived `effectiveStatus` for dynamic display.
- **Dynamic Game Endings**: Allows coaches to adjust the number of innings played in a game, with cascading deletions of lineup data for trimmed innings.

## Feature Specifications

- **Roster Management**: Players with eligible/preferred positions and pitching eligibility.
- **Game Scheduling**: Date, location, innings.
- **Lineup Generation**: Auto-generates rotational lineups based on fairness and constraints.
- **Season Stats**: Tracks playing time, bench time, position distribution, and fairness score, with position group breakdowns.
- **Import Capabilities**: Copy from previous games, AI-powered screenshot import for lineups and rosters, iCal schedule import.
- **Post-Game Photo Override**: Allows coaches to update lineups from photos of handwritten changes, with options to snapshot or replace original plans.
- **Lineup Editing**: Inline drag-and-drop editing, copy to Sheets (TSV), and "Innings by Position" tally with live updates.
- **Position Locks**: Pinning players to specific positions/innings with validation and generator integration.
- **Equity Insights Popup**: Highlights inequities in the current lineup.
- **Innings by Position Tally**: Displays player position counts, including "Out" innings, with options to remove players from the lineup.
- **Edit Available Players (per game)**: Toolbar dialog on the game-detail page that lets coaches toggle players in/out of an existing lineup in one batch — uncheck to drop a player from every inning (injuries/early departures), check to add a missing roster player as Bench in every inning. Stages into editedLineup so the coach reviews and saves like any other manual edit.
- **Per-Game Game Type (League / Tournament / Unspecified)**: Each game stores an optional `gameType` (`games.game_type` text column). The lineup generator switches behavior based on it: **tournament** overrides equity to ~10 and doubles the preferred-position bonus (best fielders in their best spots), and orders the batting lineup by season OBP descending. **League** overrides equity to ~70 and orders the batting lineup by ascending season plate appearances (PA = AB + BB + HBP + SAC, summed across all batting_stats rows per player) so under-used kids bat earlier and gain more PAs over the season. **Unspecified/null** keeps the legacy behavior driven by the global equity slider. The generate route loads the game's gameType plus aggregated batting stats and passes them to `generateFairLineup` via `LineupConstraints.gameType` / `playerSeasonPlateAppearances` / `playerSeasonOBP`. The new-game page and Edit Game dialog expose a 3-way selector; the games list shows a small badge for league/tournament games; the generate dialog shows an info banner describing what mode is active.
- **Position Group Toggle**: Client-side grouping/ungrouping of infield positions in season stats.
- **Stat Exclusions**: Excludes practices/other events from dashboard game totals.
- **Dashboard "Up Next" Hero**: The home `/` dashboard surfaces a prominent hero card for the soonest FUTURE actual game so opening the app on game day is one tap from the Field Display. Two-tier picker: (1) prefer the soonest `isTrulyUpcoming` game (date >= now, sorted ascending); (2) only if there are no future games, fall back to the most-recent `isPastUnrecorded` game labeled "Needs Result" so a forgotten old game doesn't hijack the hero. CTAs swap based on tier — upcoming shows Field Display (primary) + Open Game; past-fallback hides Field Display and promotes "Record Result" as the primary CTA.
- **Plate Appearances (PA) on Stats**: `/stats` Batting Stats tab displays a derived "PA" column right after AB (and surfaces "SAC" after HBP so the math reads cleanly). PA = AB + BB + HBP + SAC — the same formula the league-mode lineup generator uses internally for batting-order equity. Computed client-side via `computePA()`, never stored. Live-updates in the edit row and in the "Extract from Screenshot" preview as the coach types, so coaches can keep PAs equitable across the roster, not just at-bats.
- **Field Display (dugout-fence iPad)**: Read-only `/games/:id/display` page designed to fill an iPad strapped to the dugout fence. The whole page fits in a single iPad-landscape viewport (~1180×820, `lg:h-[100dvh]` + `lg:overflow-hidden`) with no document scroll. Header packs Exit, team-vs-opponent, inning prev/next, score, Live indicator, **Dim Mode toggle**, and fullscreen on one row. Right sidebar shows the **full batting order with no scrolling** — each row is `flex-1 basis-0` inside the sidebar so 9-batter rosters get larger rows and 18-batter rosters get smaller ones, the list always fills the sidebar height exactly. (The previous "currently at bat / on deck / in the hole" hero with Next Batter buttons was removed: without GameChanger integration there was no way to know what was actually happening on the field, and a stale at-bat indicator was worse than no indicator. We'll re-add an at-bat tracker if/when we can sync to a live scoring source.) Lineup queries (`useGetGame`, `useGetGameLineup`) poll every 5 seconds with `refetchIntervalInBackground: true`, so edits made on a parent's phone propagate to the iPad automatically (a "Just updated" pulse fires on lineup change). Wake Lock keeps the iPad screen on across visibility changes.
- **Field Display Time-of-Day Lighting**: The field card's lighting palette swaps based on `game.gameDate.getHours()`: **morning** (5–9) gets a soft amber sunrise wash; **day** (9–16) is the default bright midday green; **evening** (16–19) gets a warm orange "golden hour" wash; **night** (19–5) renders a darker grass plus 3 stadium-light pools (`mix-blend-screen` radial gradients from the back of the outfield) so a 7pm weeknight game feels like under-the-lights baseball. Implemented via a `LightingMode` derived in a `useMemo` keyed on `game?.gameDate` (memoized so 5s lineup polls don't re-derive), feeding a `FIELD_LIGHTING` palette table that drives the grass gradient, top vignette color, optional ambient overlay (`mix-blend-soft-light` warm wash), and stadium-lights toggle. Exposed as `data-lighting`/`data-testid` on the field container so e2e tests can assert the right palette is active. Driven off scheduled start (not wall clock) so the visual identity is stable for the duration of the game.
- **Dim Mode (Field Display battery saver)**: Header toggle (Moon ↔ Sun icon) drops a 40% black overlay over the entire page, preserved across reloads via `localStorage` key `fd-dim-mode`. The overlay is fixed/full-viewport with `pointer-events-none` so it covers fullscreen and lets every underlying control (Next Batter, inning arrows, the toggle itself) stay tappable without disabling dim. Designed for multi-game tournament weekends where Wake Lock + bright accents would otherwise drain the iPad — coach taps Moon between innings or between games to cut the backlight pump without losing legibility from the dugout.
- **Field Display Defensive Drag-and-Drop**: The Field Display page (`/games/:id/display`) wraps the field + bench area in a `DndContext` so the dugout-fence iPad coach can rearrange defense in the current inning without leaving the page. Each filled position chip is both droppable and draggable; empty position cells are droppable; the bench strip is one big drop zone. Drop semantics mirror `game-detail.tsx` so muscle memory transfers: field→field swaps, field→bench swaps, field→empty moves, field→bench-strip benches, bench→field swaps. Every drop runs `applyMove()` to compute the next full lineup, then `saveLineupOptimistically()` does an immediate `qc.setQueryData(getGetGameLineupQueryKey(id), nextLineup)` for instant chip-snap-into-place. **Concurrency model:** saves are serialized through a `saveQueueRef` promise chain so only one POST is ever in flight (server REPLACE semantics mean two racing POSTs could undo each other). A `pendingLineupRef` always holds the latest optimistic state, and each chained save reads it at save-time — so 2-3 rapid drags during one in-flight save coalesce into a single follow-up POST carrying the final state. Each save calls `qc.cancelQueries` first so a stale 5s-poll response can't overwrite the optimistic state mid-save. On failure we DON'T snapshot-rollback (a stale snapshot could clobber newer successful state); instead we drop pending follow-ups, invalidate to refetch authoritative server state, and toast "Couldn't save move — pulled the latest from the server". On success we invalidate lineup + season + per-player stats (position counts changed → fairness math). Sensors mirror game-detail (`PointerSensor` distance 5 + `TouchSensor` delay 150ms tolerance 5) so iPad scroll vs drag is unambiguous. A `DragOverlay` shows a floating amber-bordered chip that vanishes on drop (no return-to-source animation since the cache is already updated). The 5s polling carries the change to a parent's phone (and vice versa) automatically.

# External Dependencies

- **Clerk**: User authentication and authorization.
- **PostgreSQL**: Primary database.
- **OpenAI (GPT-5.2)**: AI vision and natural language processing for lineup/roster extraction and AI Assistant.
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