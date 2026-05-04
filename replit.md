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
- **Field Display**: Read-only page optimized for iPad, featuring dynamic lighting based on time of day, score steppers with swipe gestures, game timer, defensive drag-and-drop, and robust offline support with optimistic UI updates and auto-sync on reconnect. Three responsive layouts via Tailwind 4 `max-lg:landscape:` and `lg:` variants: phone portrait reflows the batting order to a 2-column grid with `min-h-10` rows under the field (page may scroll for deep rosters); phone landscape splits side-by-side with a 180–240px sidebar locked to viewport; iPad/desktop keeps the full 320–400px sidebar with equal-distribution rows. The `max-lg:` scoping is essential because `landscape:` is emitted after `lg:` in the compiled CSS — an unscoped `landscape:` rule would override `lg:` on iPad-landscape and shrink the iPad sidebar to phone width.

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
- **Roster import (re-import merge)**: `POST /api/players/bulk` is an UPSERT — for each incoming player keyed by case-insensitive `name|number`, existing rows have their `preferredPositions` UNION-merged with the incoming positions and `canPitch` OR-merged (additive only; position removal stays an explicit per-player edit). `eligiblePositions` is recomputed via `deriveEligible(mergedCanPitch)`. `notes` is **never** touched on update — defense-in-depth against UI status strings ever leaking into a player's actual notes. The whole batch (selects + updates + inserts) runs in one `db.transaction` so a partial failure can't leave the roster half-updated. Rows that wouldn't actually change are skipped to keep the `updated` count meaningful. Response is `{ created, updated, skipped: [] }`; `skipped` is retained as an empty array purely for backwards compatibility. The `ImportRosterDialog` (`pages/players.tsx`) shows a "Will update positions" badge on duplicate rows (UI-only, via a `dup` flag — never written to the DB) and pre-includes them so re-importing an updated screenshot picks up new positions automatically. The toast summarises both counts (e.g. "Added 3 new players · updated positions for 5 existing players").
- **NumberInput component** (`components/ui/number-input.tsx`): Reusable wrapper around shadcn `Input` for any `type="number"` field. Holds an internal draft string so the user can fully clear the field, only forwards `onChange(parsedNumber)` to the parent when the draft is a finite int, and on blur clamps to min/max or commits an explicit `fallback`. This replaces the buggy `onChange={(e) => setX(parseInt(e.target.value, 10) || fallback)}` pattern (which snapped state back to the fallback the moment the field went empty, making it impossible to delete-and-retype values like 90 → 60). Currently used for practice/block durations and the default-innings/max-position/max-bench inputs in Settings; preferred for any new numeric input.

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