# Overview

This project is a multi-tenant lineup management system for baseball/softball coaches. Its primary purpose is to efficiently manage rosters, schedule games, and generate fair rotational lineups. Key capabilities include team branding, customizable lineup defaults, comprehensive season statistics, and advanced AI features for lineup generation from images and natural language instructions. The system aims to optimize player rotation, ensure equitable playing time, and aspire to become the leading platform for youth sports team management, with future ambitions to expand to other sports and incorporate advanced predictive analytics.

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
- I want a Settings → Defaults toggle to hide the Fairness Score (both the Dashboard card and the Rotation Report bar) for coaches who don't want the metric on screen.
- I want a Settings → Defaults toggle to hide the "Make this lineup more equitable" suggestions popup on the game lineup view.
- I want a small info tooltip next to the Fairness Score that explains how it's calculated (per-player bench-rate stddev across completed games, scored 100 − stddev × 200).

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
- **Broadcast Visual Language**: App-wide "sports broadcast / app-store" treatment that extends the Field Display lower-third aesthetic into the rest of the app. Oswald is loaded as the display face (`font-broadcast` utility, `--font-display`) and Roboto Mono as the numeric face (`font-numeric` utility) — both pulled in via the Google Fonts `@import` in `src/index.css`. Reusable utilities `.eyebrow` (uppercase tracking-widest Oswald) and `.page-title` (large uppercase Oswald) are applied to every page header. The Dashboard "Today / Up Next" hero is a navy gradient panel with a gold top stripe, oversized Oswald opponent name in gold, and Roboto Mono game-time numerals — same chrome as the Field Display lower-third. Stat cards (Dashboard + Rotation Report) share a `BroadcastStatCard` component (`src/components/broadcast-stat-card.tsx`) with a gold top stripe, Oswald uppercase label, and big Roboto Mono numerals. The sidebar/header uses Oswald uppercase tracking-wide for the team name and nav items, and the active route now has a gold underline with a gold glow.
- **Lineup Grid**: Pill-shaped player chips, circular inning badges, alternating row backgrounds, drag-and-drop editing.
- **Data Visualization**: Recharts for season statistics.
- **Field Display**: Optimized for iPad with dynamic lighting, score steppers, game timer, defensive drag-and-drop, and robust offline support. Features responsive layouts for phone portrait, phone landscape, and iPad/desktop. Broadcast Booth visual style with a pure-black background, deep-navy panels, broadcast-gold accents, Oswald display headlines, and Roboto Mono for numerals — the same vocabulary now extended app-wide (see "Broadcast Visual Language").

## Technical Implementations

- **Authentication**: Clerk for user authentication and authorization.
- **Multi-tenancy**: Data isolation per coach (`Clerk userId`).
- **Fairness Algorithm**: Configurable `global_equity_weight` for lineup generation.
- **AI Integration**: Uses `gpt-5.2` for image-based roster imports, natural language queries, lineup regeneration, and practice plan generation, leveraging past practice data for personalized suggestions.
- **Data Handling**: Client-side downscaling and server-side validation for image uploads; server-side classification for iCal imports.
- **Lineup Features**: Supports "locked" positions, "Innings by Position" tally, and post-game photo overrides.
- **Game Status Management**: Differentiates between stored and client-side derived `effectiveStatus`; allows dynamic game endings.
- **Team Sharing**: Multi-coach co-ownership via single-use invite links.
- **Tournament Mode**: Supports grouping games into tournaments with free-form pitch rules (daily max, tournament max, rest tiers) and rolling per-pitcher pitch-count tracking and rest-day computation.
- **Offline Support**: Field Display page ensures reads and writes survive offline using `localStorage` for caching and pending changes, with last-writer-wins conflict resolution.
- **Roster Position Coverage**: Displays preferred position coverage for each position, indicating depth (uncovered, thin, covered).
- **Roster Management**: Supports bulk roster import with AI, including UPSERT logic for merging existing player data and selecting/clearing preferred positions.
- **NumberInput component**: Reusable component for robust numeric input handling with min/max clamping and fallback values.
- **Demo Data Seeding**: Preview-only functionality to seed demo players and games for development and testing.
- **Pitcher/Catcher Lock Preference**: A user preference to remind coaches to lock pitchers and catchers before generating a lineup, with a prompt and options to set locks or generate anyway.
- **Sidebar Reorganization**: Updated sidebar navigation order: Dashboard → Schedule → Rotation Report → Roster → Tournaments → Practices → Settings.
- **Constraints Management**: Lineup constraints are now embedded directly within the Settings page for a streamlined experience.
- **Dashboard Tasks**: A dashboard card that surfaces incomplete tasks (e.g., logging scores, pitch counts) with dismissal functionality. Tasks are derived from game data and dismissed tasks are persistently stored.
- **Stats Calculation**: Season and player statistics exclusively count data from completed games, excluding practices, upcoming games, and draft lineups to ensure accuracy.
- **Coach Profile (per team)**: Each `team_memberships` row carries a `displayName` and free-form `role` label (e.g. "Head Coach", "Assistant Coach"). The owner also gets a row in their own team (idempotently inserted by `ensureOwnerMembership`) so there is one source of truth for "who am I on this team". A modal (`coach-profile-prompt.tsx`) opens automatically the first time a user hits the app without a `displayName` set; it cannot be dismissed by clicking outside. The display name (with email fallback) replaces the raw email everywhere it used to be shown (sidebar footer, mobile sheet, member list).
- **Per-team Permission Tiers**: `team_memberships.permission` is `full | partial | view` (default `full`, check-constrained). Owner is always `full`. `full` = roster, settings, lineups, games, practices, coach mgmt; `partial` = lineups/games/practices/stats writes only; `view` = read-only on every page. The server is the source of truth — `assertPermission(level)` middleware (`api-server/src/lib/permissions.ts`) gates every write route, returning 403 if the caller lacks the required tier. The web `usePermission()` hook drives UX-level button hiding (Settings/Roster/Dashboard add-game/Game-detail edit) so a `view` coach doesn't see write controls at all. Head coach changes tiers from the Coaches card via a `<Select>` per non-owner row.
- **Master Admin (app owner)**: An env-allow-list `MASTER_ADMIN_USER_IDS` (comma-separated Clerk user IDs) flags app-owner accounts. Master admins bypass team scoping and unlock an `/admin` page (`pages/admin.tsx` + `pages/admin-team-detail.tsx`) listing every team and user, with a "View as this team" CTA that calls `/team/active` (which has a master-admin bypass for the owner-or-member check). The Admin nav item is gated on `useAdminMe().isMasterAdmin`, the route renders an "access denied" panel for non-admins, and the underlying `/admin/*` API routes are gated by the `requireMasterAdmin` middleware — so removing a user from the env list immediately revokes access without any redeploy of code.

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