# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Charts**: Recharts
- **Routing**: Wouter

## App: Baseball Lineup Manager (DugoutManager)

A travel baseball team defensive lineup manager for coaches. Features:
- **Roster management**: Add/edit players with eligible and preferred positions, pitching eligibility
- **Game scheduling**: Create games with date, location, innings
- **Lineup generation**: Auto-generate fair rotational lineups using a fairness algorithm
- **Season stats**: Track playing time, bench time, position distribution, and a fairness score
- **Inning-by-inning grid**: Visual lineup display per game

### Artifacts
- `artifacts/baseball-lineup` — React+Vite frontend (preview at `/`)
- `artifacts/api-server` — Express API server (at `/api`)

### Features
- Roster management with eligible/preferred positions
- Game scheduling
- Fair lineup generation (fairness algorithm)
- Season stats with position group breakdowns (C, MIF, CIF, OF, P, Bench)
- Historical fielding import (CSV paste → aggregate innings)
- Batting stats with AI image extraction (OpenAI vision)
- **Lineup constraints system**: global rules + player-specific rules + AI natural language parsing
  - Numeric global rules (max bench innings, max same position) use a popup dialog with slider when toggled on
  - Boolean global rules (no bench 2 of 3, all positions covered, rotate pitcher) toggle directly
  - Lineup generator enforces "no player benched 2 of 3 innings" via score boost
- **iCal schedule import**: paste a webcal/ICS URL → preview events → confirm to import as games
- **Editable game cards** with pencil icon for inline edit

### Database tables
- `players` — team roster
- `games` — game schedule
- `lineup_entries` — per-game, per-inning position assignments
- `historical_fielding` — imported historical fielding data
- `batting_stats` — batting stats per player per game
- `lineup_constraints` — persisted lineup generation rules (global + player-specific)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
