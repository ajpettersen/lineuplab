import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import { eq } from "drizzle-orm";
import {
  db,
  playersTable,
  gamesTable,
  lineupEntriesTable,
  type InsertPlayer,
  type InsertGame,
  type InsertLineupEntry,
} from "@workspace/db";

const router: IRouter = Router();
router.use("/demo", gateWrites("full"));

/**
 * Demo seed endpoint — used so a freshly-signed-in coach can click around
 * the app without manually creating a roster and a schedule first. Idempotent:
 * if the requesting team already has any players OR any games, this is a
 * no-op (we don't want to clobber real data on a misclick).
 *
 * **Dev-only.** In production we 404 the route entirely so a real coach
 * who signs into the live app never accidentally gets demo data injected
 * into their team. The Vite client also gates the auto-seeder + button
 * on `import.meta.env.DEV`, so the route should only ever be hit from the
 * preview environment in normal use.
 *
 * Scoped to req.ownerUserId (the active team), set by resolveTeamContext.
 */
const isDev = process.env.NODE_ENV !== "production";

const ALL_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;

type DemoPlayer = {
  name: string;
  number: number;
  preferredPositions: string[];
  canPitch: boolean;
  notes?: string;
};

// 12 players — enough to fill a 9-position field with subs and bench rotation.
// Mix of pitchers (3), middle infielders (2 SS-capable), outfield depth (4),
// and position specialists. Numbers chosen to look like a real travel-ball
// roster, no duplicates.
const DEMO_PLAYERS: DemoPlayer[] = [
  { name: "Sam Rivera", number: 1, preferredPositions: ["SS", "2B"], canPitch: false, notes: "Captain — quiet leader" },
  { name: "Jordan Park", number: 3, preferredPositions: ["P", "1B"], canPitch: true, notes: "Lefty — 4 inning max" },
  { name: "Avery Chen", number: 7, preferredPositions: ["C", "3B"], canPitch: false },
  { name: "Riley Morgan", number: 8, preferredPositions: ["CF", "LF"], canPitch: false, notes: "Fastest on the team" },
  { name: "Casey Brooks", number: 11, preferredPositions: ["P", "SS"], canPitch: true },
  { name: "Drew Patel", number: 12, preferredPositions: ["2B", "RF"], canPitch: false },
  { name: "Quinn Foster", number: 14, preferredPositions: ["1B", "3B"], canPitch: false, notes: "Power bat" },
  { name: "Morgan Avila", number: 17, preferredPositions: ["LF", "CF"], canPitch: false },
  { name: "Taylor Kim", number: 21, preferredPositions: ["RF", "1B"], canPitch: false },
  { name: "Reese Nguyen", number: 22, preferredPositions: ["3B", "C"], canPitch: false, notes: "Backup catcher" },
  { name: "Kai Sullivan", number: 24, preferredPositions: ["P", "CF"], canPitch: true, notes: "Closer — 2 inning max" },
  { name: "Phoenix Bell", number: 28, preferredPositions: ["SS", "2B", "3B"], canPitch: false },
];

function deriveEligible(canPitch: boolean): string[] {
  return canPitch ? [...ALL_POSITIONS] : ALL_POSITIONS.filter((p) => p !== "P");
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(10, 0, 0, 0);
  return d;
}

// 6-inning × 12-player rotation for the completed Riverdale Raptors demo
// game. One position (or "Bench") per cell, indexed by [inning - 1][playerIdx]
// where playerIdx matches DEMO_PLAYERS order. Designed by hand so:
//   - every inning has exactly one of each of the 9 positions + 3 benched
//   - Jordan Park (#3, "Lefty — 4 inning max") pitches innings 1–3 only
//   - Casey Brooks (#11) takes innings 4–5; Kai Sullivan (#24, "Closer —
//     2 inning max") closes inning 6
//   - everyone gets at least 3 field innings and at least 1 bench inning
//   - assignments mostly land on each player's preferred positions
// Without this matrix the demo's only completed game would have no lineup
// entries, so the Stats / Player Detail pages would show 0 across the board.
const DEMO_LINEUP_GRID: ReadonlyArray<ReadonlyArray<string>> = [
  // Players: Sam, Jord, Aver, Rile, Case, Drew, Quin, Morg, Tayl, Rees, Kai, Pho
  ["2B", "P",     "C",     "CF",    "Bench", "RF",    "1B",    "LF",    "3B",    "Bench", "Bench", "SS"   ],
  ["SS", "P",     "C",     "CF",    "Bench", "2B",    "Bench", "LF",    "1B",    "3B",    "RF",    "Bench"],
  ["Bench", "P",  "Bench", "CF",    "SS",    "2B",    "1B",    "Bench", "RF",    "C",     "LF",    "3B"   ],
  ["2B", "1B",    "C",     "CF",    "P",     "RF",    "Bench", "LF",    "Bench", "3B",    "Bench", "SS"   ],
  ["SS", "Bench", "3B",    "Bench", "P",     "Bench", "1B",    "LF",    "RF",    "C",     "CF",    "2B"   ],
  ["LF", "Bench", "C",     "CF",    "SS",    "2B",    "Bench", "Bench", "1B",    "3B",    "P",     "RF"   ],
];

function buildDemoGames(): InsertGame[] {
  const today = startOfDay(new Date());

  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 5);

  return [
    {
      opponent: "Riverdale Raptors",
      gameDate: lastWeek,
      location: "Riverdale Field 2",
      innings: 6,
      status: "completed",
      type: "game",
      gameType: "league",
      ourScore: 8,
      opponentScore: 5,
      notes: "Demo game — feel free to delete.",
    },
    {
      opponent: "Test Tigers",
      gameDate: today,
      location: "Home — Diamond 1",
      innings: 6,
      status: "upcoming",
      type: "game",
      gameType: "league",
      ourScore: null,
      opponentScore: null,
      notes: "Demo game — feel free to delete.",
    },
    {
      opponent: "North Shore Storm",
      gameDate: nextWeek,
      location: "North Shore Complex",
      innings: 6,
      status: "upcoming",
      type: "game",
      gameType: "tournament",
      ourScore: null,
      opponentScore: null,
      notes: "Demo game — feel free to delete.",
    },
  ];
}

async function isSeedable(ownerUserId: string): Promise<boolean> {
  const [existingPlayer] = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(eq(playersTable.userId, ownerUserId))
    .limit(1);
  if (existingPlayer) return false;

  const [existingGame] = await db
    .select({ id: gamesTable.id })
    .from(gamesTable)
    .where(eq(gamesTable.userId, ownerUserId))
    .limit(1);
  if (existingGame) return false;

  return true;
}

/**
 * GET /api/demo/seed — returns whether the active team has zero data and
 * is therefore eligible for an automatic demo seed. The client uses this
 * to decide whether to auto-trigger the seed on first load.
 */
router.get("/demo/seed", async (req, res) => {
  if (!isDev) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const ownerUserId = req.ownerUserId;
  if (!ownerUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const seedable = await isSeedable(ownerUserId);
  res.json({ seedable });
});

/**
 * POST /api/demo/seed — creates a demo roster + schedule for the active
 * team. No-op (returns { created: false }) if the team already has any
 * players or games. Returns counts of what was created.
 */
router.post("/demo/seed", async (req, res) => {
  if (!isDev) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const ownerUserId = req.ownerUserId;
  if (!ownerUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!(await isSeedable(ownerUserId))) {
    res.json({ created: false, players: 0, games: 0 });
    return;
  }

  const playerRows: InsertPlayer[] = DEMO_PLAYERS.map((p) => {
    const tokens = p.name.trim().split(/\s+/).filter(Boolean);
    const firstName = tokens.length > 1 ? tokens.slice(0, -1).join(" ") : (tokens[0] ?? "");
    const lastName = tokens.length > 1 ? tokens[tokens.length - 1]! : "";
    return {
      name: p.name,
      firstName,
      lastName,
      number: p.number,
      eligiblePositions: deriveEligible(p.canPitch),
      preferredPositions: p.preferredPositions,
      canPitch: p.canPitch,
      active: true,
      notes: p.notes ?? null,
    };
  });

  const gameRows: InsertGame[] = buildDemoGames();

  // Re-check inside the work to keep the race window small. We can't do a
  // real transaction across players + games without restructuring, but the
  // double-check + idempotent client guard is enough for a demo seed.
  if (!(await isSeedable(ownerUserId))) {
    res.json({ created: false, players: 0, games: 0 });
    return;
  }

  // One transaction across players + games + lineup entries so the demo
  // either fully lands or fully rolls back. We need the inserted IDs to
  // build the lineup rows for the completed game, so use .returning() on
  // each insert and key entries off the returned arrays (preserving the
  // input order — Postgres returns rows in insert order).
  let insertedEntries = 0;
  await db.transaction(async (tx) => {
    const insertedPlayers = await tx
      .insert(playersTable)
      .values(playerRows.map((row) => ({ ...row, userId: ownerUserId })))
      .returning({ id: playersTable.id });

    const insertedGames = await tx
      .insert(gamesTable)
      .values(gameRows.map((row) => ({ ...row, userId: ownerUserId })))
      .returning({ id: gamesTable.id, status: gamesTable.status });

    // Find the one completed game (Riverdale Raptors) and seed it with the
    // hand-designed lineup matrix above. If for some reason the completed
    // game isn't there (shouldn't happen — buildDemoGames returns it), we
    // simply skip the lineup insert rather than fail the seed.
    const completedGame = insertedGames.find((g) => g.status === "completed");
    if (completedGame && insertedPlayers.length === DEMO_LINEUP_GRID[0]!.length) {
      const entryRows: InsertLineupEntry[] = [];
      for (let inningIdx = 0; inningIdx < DEMO_LINEUP_GRID.length; inningIdx++) {
        const row = DEMO_LINEUP_GRID[inningIdx]!;
        for (let playerIdx = 0; playerIdx < row.length; playerIdx++) {
          entryRows.push({
            gameId: completedGame.id,
            playerId: insertedPlayers[playerIdx]!.id,
            inning: inningIdx + 1,
            position: row[playerIdx]!,
            // Batting order mirrors roster order so the Innings-by-Position
            // tally and any "lineup card" view have a sensible top-to-bottom
            // order out of the box.
            battingOrder: playerIdx + 1,
          });
        }
      }
      await tx.insert(lineupEntriesTable).values(entryRows);
      insertedEntries = entryRows.length;
    }
  });

  req.log.info(
    {
      ownerUserId,
      players: playerRows.length,
      games: gameRows.length,
      lineupEntries: insertedEntries,
    },
    "demo seed created",
  );

  res.json({
    created: true,
    players: playerRows.length,
    games: gameRows.length,
    lineupEntries: insertedEntries,
  });
});

export default router;
