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
- **Field Display (dugout-fence iPad)**: Read-only `/games/:id/display` page designed to fill an iPad strapped to the dugout fence. The whole page fits in a single iPad-landscape viewport (~1180×820, `lg:h-[100dvh]` + `lg:overflow-hidden`) with no document scroll. Header packs Exit, team-vs-opponent, inning prev/next, score, Live indicator, and fullscreen on one row. Right sidebar has a sticky "AT BAT" hero block at the top — number badge, player name, On Deck and In the Hole rows, and a prominent amber "Next Batter" button — so the primary advance control is always visible without scrolling. Full batting order list scrolls below the hero. Lineup queries (`useGetGame`, `useGetGameLineup`) poll every 5 seconds with `refetchIntervalInBackground: true`, so edits made on a parent's phone propagate to the iPad automatically (a "Just updated" pulse fires on lineup change). Wake Lock keeps the iPad screen on across visibility changes. The at-bat index is tracked by playerId across polls so phone edits that reorder or shrink the batting list never blank out the hero.

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