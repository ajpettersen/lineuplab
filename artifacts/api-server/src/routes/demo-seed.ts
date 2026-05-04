import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  playersTable,
  gamesTable,
  type InsertPlayer,
  type InsertGame,
} from "@workspace/db";

const router: IRouter = Router();

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

  const playerRows: InsertPlayer[] = DEMO_PLAYERS.map((p) => ({
    name: p.name,
    number: p.number,
    eligiblePositions: deriveEligible(p.canPitch),
    preferredPositions: p.preferredPositions,
    canPitch: p.canPitch,
    active: true,
    notes: p.notes ?? null,
  }));

  const gameRows: InsertGame[] = buildDemoGames();

  // Re-check inside the work to keep the race window small. We can't do a
  // real transaction across players + games without restructuring, but the
  // double-check + idempotent client guard is enough for a demo seed.
  if (!(await isSeedable(ownerUserId))) {
    res.json({ created: false, players: 0, games: 0 });
    return;
  }

  await db.insert(playersTable).values(
    playerRows.map((row) => ({ ...row, userId: ownerUserId })),
  );
  await db.insert(gamesTable).values(
    gameRows.map((row) => ({ ...row, userId: ownerUserId })),
  );

  req.log.info(
    { ownerUserId, players: playerRows.length, games: gameRows.length },
    "demo seed created",
  );

  res.json({
    created: true,
    players: playerRows.length,
    games: gameRows.length,
  });
});

export default router;
