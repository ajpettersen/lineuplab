# Overview

This project is a multi-tenant baseball/softball lineup manager designed for coaches. It allows coaches to manage rosters, schedule games, and generate fair rotational lineups for their teams. The system supports team branding, customizable lineup defaults, and comprehensive season statistics. The project aims to provide a robust tool for optimizing player rotation and ensuring equitable playing time, with advanced features like AI-powered lineup generation from images and natural language constraints.

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
- **Build**: esbuild (CJS bundle)

## UI/UX Decisions

- **Theming**: Default visual theme uses deep navy primary, warm gold accent, and cool off-white background.
- **Branding**: Header text is dynamically sourced from `team_settings.teamName`.
- **Lineup Grid**: Features pill-shaped player chips, circular inning badges, and alternating row backgrounds for clarity.
- **Interactive Editing**: Supports drag-and-drop and tap-to-move for inline lineup adjustments.
- **Data Visualization**: Recharts for displaying season statistics.

## Technical Implementations

- **Authentication**: Clerk (email/password) via `@clerk/react` for client and `@clerk/express` for API, filtering routes by `req.userId`.
- **Multi-tenancy**: Each coach (Clerk userId) has isolated data for roster, schedule, constraints, team branding, and lineup defaults.
- **Fairness Algorithm**: Lineup generation uses a fairness algorithm, with a configurable `global_equity_weight` to balance "best lineup" vs. "most equitable".
- **API Design**: Routes include `/api/healthz` (public), and all others require session authentication.
- **Image Processing**: `POST /api/games/:id/lineup/from-image` hardens image input (base64 charset regex, byte bounds, magic-byte sniff) before calling vision. `express.json({limit:"8mb"})` is route-scoped for large image payloads. **Performance:** the client downscales every photo to ≤1280px and re-encodes as JPEG q=0.85 before upload (typically 10–20× smaller payload, especially over LTE), and the vision call uses `image_url.detail: "low"` plus a tight `max_completion_tokens: 1500` budget. Lineup grids stay easily readable at low detail and the round-trip is several times faster than the original full-res / high-detail path.
- **Lineup Locks**: Stored in `lineup_locks` table with unique indexes to prevent conflicts. API enforces active player and position eligibility, using Drizzle transactions for inserts and mapping Postgres unique-violation errors to 409 HTTP status. The generator integrates locks, dropping now-ineligible players and performing a feasibility check. AI assistant respects existing locks.
- **AI Assistant Integration**: `POST /api/games/:id/ai-assistant` uses `gpt-5.2` with vision for image-based roster imports and natural language queries. It can return answers or regenerated lineups with an `explanation` and `pinned` player positions.
- **Lineup Editing Logic**: `applyMove` function handles drag/tap-to-move, implementing rules for swaps, moves to bench, and displacements. Invariant: `GET /api/games/:id/lineup` and `POST /api/games/:id/lineup/save` order by `(inning, position, id ASC)` to preserve bench insertion order.
- **iCal Import**: Server-side regex classifies events as `game`, `practice`, or `other` during import.
- **Constraint System**: Supports numeric global rules (sliders), boolean global rules (toggles), and player-specific rules.

## Feature Specifications

- **Roster Management**: Players with eligible/preferred positions, pitching eligibility.
- **Game Scheduling**: Date, location, innings.
- **Lineup Generation**: Auto-generates rotational lineups.
- **Season Stats**: Tracks playing time, bench time, position distribution, and fairness score. Includes position group breakdowns (C, MIF, CIF, OF, P, Bench).
- **Import Capabilities**:
    - Copy lineup from previous game.
    - Import lineup from screenshot using AI vision (`gpt-5.2`).
    - Roster bulk import via AI (text or screenshot).
    - iCal schedule import with event classification.
- **Post-Game Photo Override**: Coach can take a phone-camera photo (file
  input has `capture="environment"`) of the printed lineup with handwritten
  changes, parse it via the same AI vision route, and replace the saved
  lineup. When a saved lineup already exists, a confirm dialog asks whether
  to keep the original plan as a snapshot (`POST /api/games/:id/snapshot-plan`)
  or replace outright. The original plan can be reviewed via "View Original
  Plan" and discarded with `DELETE /api/games/:id/snapshot-plan`.
- **Lineup Editing**: Inline editing, drag-and-drop, copy to Sheets (TSV format) for both the per-inning lineup grid and the per-player "Innings by Position" tally (Pitching/Infield/Outfield/Bench/Out/Total). Both use a shared `writeTsvToClipboard` helper with Clipboard API + textarea/execCommand fallback.
- **Position Locks**: Pinning players to specific positions/innings, with validation and generator integration.
- **AI Assistant**: Natural language querying and lineup regeneration, with conflict resolution against existing locks. Per-game **AI memory** persists assistant-issued pins across calls (table `ai_pinned_assignments`, unique on `gameId+playerId+inning` and on `gameId+inning+position` where position!='Bench'). Each AI regenerate merges new pins on top of memory pins (new wins on conflict by player+inning OR inning+position) and writes the union back. Locks always win over both. UI shows a "Remembering N pins" indicator with a "Reset" button (`DELETE /api/games/:id/ai-pins`). `GET /api/games/:id/ai-pins` returns `{pins, count}`.
- **Equity Insights Popup**: Dismissible call-out above the lineup grid that flags inequities in the currently displayed lineup (preview > unsaved edits > saved): players sitting ≥2 innings more than the team minimum, players with no infield time, and players with no outfield time. Resets when a new save lands or a new AI preview arrives.
- **Innings by Position Tally**: Live updates on player position counts per game. Includes an "Out" column showing innings the player has no entry for (e.g. they showed up late, left early, or a photo import didn't pick them up), so each row's total equals the game length.
- **Unavailable / Out Innings**: Server stats compute `unavailableInnings` per player as the sum, across attended games, of `game.innings - distinctInningsWithEntry`. Included in `combinedTotal` and exposed as a dedicated "Out" group/column on the season Position Group Breakdown and as an "Out (Unavailable)" stat card on the player detail page. Bench/position breakdown still uses actual entries; fairness calculations are not based on `combinedTotal` and so are unaffected.
- **Position Group Toggle**: The season Position Group Breakdown defaults to a merged "Infield" column that sums Catcher + Corner IF (1B/3B) + Middle IF (2B/SS). A "Group catcher + infield as 'Infield'" checkbox in the card header lets the coach uncheck to expand into the four separate columns. Server data shape is unchanged — the merge is purely client-side display.
- **Game Ended Early (10-run rule)**: A "Game Ended Early" button on the game-detail page lets the coach pick the last inning that was actually played. The PATCH `/api/games/:id` handler runs in a transaction: it verifies ownership, updates `innings`, and — when the new value is smaller than the previous — cascades `DELETE … WHERE inning > newInnings` against `lineup_entries`, `lineup_locks`, and `ai_pinned_assignments` so trimmed innings don't ghost in tallies or come back if the game is later re-extended.
- **Stat Exclusions**: Dashboard "Total Games" counts only actual games, excluding practices/other events.

## Database Schema

- `players`: Team roster details.
- `games`: Game schedule information. Includes a nullable `plan_snapshot` jsonb column that stores the lineup as it stood before a post-game photo override, so coaches can review or restore their original plan.
- `lineup_entries`: Per-game, per-inning player assignments.
- `historical_fielding`: Imported historical fielding data.
- `batting_stats`: Batting statistics per player per game.
- `lineup_constraints`: Persisted lineup generation rules.
- `lineup_locks`: Stores player position locks for games.

# External Dependencies

- **Clerk**: For user authentication (`@clerk/react`, `@clerk/express`).
- **PostgreSQL**: Primary database.
- **OpenAI (GPT-5.2)**: For AI vision (image-to-lineup/roster extraction) and AI Assistant natural language processing.
- **Zod**: Schema validation.
- **Drizzle ORM**: Type-safe ORM for PostgreSQL.
- **Orval**: API client and Zod schema generation from OpenAPI.
- **React**: Frontend library.
- **Vite**: Frontend build tool.
- **Tailwind CSS**: Utility-first CSS framework.
- **shadcn/ui**: UI component library.
- **Recharts**: Charting library.
- **Wouter**: React router.
- **@dnd-kit/core**: Drag-and-drop library for lineup editing.