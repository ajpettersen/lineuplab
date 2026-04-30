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
- **Roster bulk import (AI)**: on the Roster page, "Import Roster" opens a dialog where
  the coach can paste freeform text OR upload a screenshot. `POST /api/players/extract`
  routes either to a JSON text call or a multipart vision call (gpt-5.2) and returns
  `{name, number, eligiblePositions, canPitch, notes}` per player. Editable preview
  table lets the coach toggle positions, fix names/numbers, exclude rows, then
  `POST /api/players/bulk` inserts them in one shot. Position chips in the preview
  are tri-state: tap once to mark eligible, again to mark preferred (★), again to
  remove — preferred positions are persisted alongside eligible ones.
- **Lineup Fairness dial**: on the Constraints page, a 0–100 slider ("Best lineup" ↔
  "Most equitable", default 50) controls how strongly the generator equalizes playing
  time. Persisted as a single `global_equity_weight` constraint. The generator scales
  its fairness term by `equity*2` (so 50 = legacy behavior) and adds a preferred-position
  bonus only when equity < 50, smoothly trading fairness for "best lineup". Slider
  commits are serialized client-side and re-fetch the live list to delete duplicates,
  enforcing a single-row invariant.
- **Lineup constraints system**: global rules + player-specific rules + AI natural language parsing
  - Numeric global rules (max bench innings, max same position) use a popup dialog with slider when toggled on
  - Boolean global rules (no bench 2 of 3, all positions covered, rotate pitcher) toggle directly
  - Lineup generator enforces "no player benched 2 of 3 innings" via score boost
- **iCal schedule import**: paste a webcal/ICS URL → preview events → confirm to import.
  Server-side regex classifier categorizes each event as `game`, `practice`, or `other`
  (meetings, picture day, banquets, etc.). The import dialog groups events by kind and
  auto-checks only games — practices/other events stay unchecked so they're a conscious
  opt-in. The schedule list shows a "Practice" or "Event" badge next to non-game items.
  Note: after a fresh deploy that adds the `games.type` column, existing rows default to
  `game`; run a one-shot reclassification (same regex on opponent strings) to backfill.
- **Editable game cards** with pencil icon for inline edit
- **Inline lineup editing + drag-and-drop + copy to Sheets** (Game Detail page):
  every player in any saved/preview lineup is rendered as its own draggable tile
  per inning. Coaches can either DRAG a tile (powered by `@dnd-kit/core`,
  PointerSensor distance:5, TouchSensor delay:150 for touch) onto another tile in
  the same inning, OR fall back to TAP-TO-MOVE (tap to select → tap target). Both
  paths funnel into a single `applyMove(sourceEntryId, target)` so the rules are
  identical:
    - field → empty field cell: source moves there.
    - field → occupied field cell: SWAP positions; both players stay on the
      field, they just exchange roles.
    - field → bench area (`bench-{inning}` drop zone): source goes to bench
      bottom; old field cell becomes empty.
    - field → specific bench tile: SWAP (preserves field occupancy).
    - bench → empty field: source moves there.
    - bench → occupied field: source takes position; target goes to bench
      bottom (this is the only "displace to bench" case left, because there's
      no field slot to give the target in exchange).
    - bench → bench area or bench tile: no-op.
  Cross-inning attempts show a destructive "same inning" toast and don't apply.
  Empty field cells render as dashed `+` drop hints only during an active drag
  or pending tap-select. Local edits live in `editedLineup` state and surface an
  amber "Unsaved changes" banner with Save Changes / Discard. Display precedence:
  `previewLineup ?? editedLineup ?? lineup`. Generating a new lineup while edits
  are pending prompts a confirm() dialog. A "Copy" button builds a TSV (header
  `Inning\tP\tC\t1B\t2B\t3B\tSS\tLF\tCF\tRF\tBench`, full names, multi-bench
  comma-joined) and writes it via `navigator.clipboard.writeText` with a
  hidden-textarea + `execCommand('copy')` fallback for non-secure contexts.
  Important backend invariant: `GET /api/games/:id/lineup` and the SELECT after
  `POST /api/games/:id/lineup/save` order by `(inning, position, id ASC)` so the
  insertion order of multiple bench rows in the same inning survives reload —
  this is what preserves "displace to bottom of bench" across saves.
- **Per-game Innings by Position tally** (Game Detail page, below the lineup
  card): a second card titled "Innings by Position" lists every active player
  in the displayed lineup with four colored count chips — Pitching, Infield
  ({C,1B,2B,3B,SS}), Outfield ({LF,CF,RF}), Bench — and a Total column equal
  to the game's innings. Updates live as the coach edits/previews/saves. Counts
  are deduped per (player, inning) so totals can never exceed the game's innings
  even with malformed data. Testids: `card-tally`, `tally-row-{playerId}`,
  `tally-{playerId}-pitching|infield|outfield|bench`.
- **Stat exclusions**: the dashboard "Total Games" stat counts only rows with
  `games.type === "game"`, excluding practices and other calendar events.

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
