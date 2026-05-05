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
- **API Contracts**: `api-server/src/routes/` (generated client in `src/lib/api-client/`)
- **Theme/Styling**: `src/index.css`, `tailwind.config.js`
- **Components**: `src/components/`
- **Utilities**: `src/lib/`

## Architecture decisions

- **Broadcast Visual Language**: App-wide aesthetic inspired by sports broadcasts, using Oswald for display and Roboto Mono for numerals.
- **Multi-tenancy**: Data isolation per coach (`Clerk userId`) with `assertPermission` middleware gating write routes.
- **AI Integration**: Uses `gpt-5.2` for image/text roster imports, natural language lineup generation, and practice plan suggestions.
- **Offline Support**: Field Display page uses `localStorage` for caching and pending changes, with last-writer-wins conflict resolution.
- **Master Admin Bypass**: `MASTER_ADMIN_USER_IDS` environment variable allows app owners to bypass team scoping and access an `/admin` page.

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

## Gotchas

- The `formatPlayerNameShort()` helper in `src/lib/player-name.ts` should always be used for short player name displays (`First L.`) instead of manual string splitting.
- When changing the tie badge format, ensure consistency across `dashboard.tsx`, `games.tsx`, and `game-detail.tsx`.
- AI assistant feasibility checks currently use a legacy 9-position layout; teams on 10-player layouts might see slightly looser feasibility errors.

## Pointers

- **Clerk Documentation**: `https://clerk.com/docs`
- **Drizzle ORM Documentation**: `https://orm.drizzle.team/docs`
- **Zod Documentation**: `https://zod.dev/`
- **Orval Documentation**: `https://orval.dev/docs`
- **Tailwind CSS Documentation**: `https://tailwindcss.com/docs`
- **shadcn/ui Documentation**: `https://ui.shadcn.com/docs`
- **Recharts Documentation**: `https://recharts.org/en-US/api`
- **Google Fonts**: `https://fonts.google.com/` (Oswald, Roboto Mono)