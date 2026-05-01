import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, playersTable, lineupEntriesTable, lineupConstraintsTable, lineupLocksTable } from "@workspace/db";
import {
  GetGameLineupParams,
  GenerateLineupParams,
  GenerateLineupBody,
  SaveLineupParams,
  SaveLineupBody,
} from "@workspace/api-zod";
import { generateFairLineup, FIELD_POSITIONS } from "../lib/lineup-generator";
import { getOwnedGame, filterOwnedPlayerIds } from "../lib/ownership";

const router: IRouter = Router();

router.get("/games/:id/lineup", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = GetGameLineupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await getOwnedGame(userId, params.data.id))) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const entries = await db
    .select({
      id: lineupEntriesTable.id,
      gameId: lineupEntriesTable.gameId,
      playerId: lineupEntriesTable.playerId,
      playerName: playersTable.name,
      inning: lineupEntriesTable.inning,
      position: lineupEntriesTable.position,
      battingOrder: lineupEntriesTable.battingOrder,
    })
    .from(lineupEntriesTable)
    .innerJoin(playersTable, eq(lineupEntriesTable.playerId, playersTable.id))
    .where(eq(lineupEntriesTable.gameId, params.data.id))
    // Tie-break by `id` so multiple "Bench" rows for the same inning are returned
    // in insertion order — required for the "displace to bottom of bench" UX to
    // survive a reload (the displaced entry is the most recently inserted = highest id).
    .orderBy(lineupEntriesTable.inning, lineupEntriesTable.position, lineupEntriesTable.id);
  res.json(entries);
});

router.post("/games/:id/lineup/generate", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = GenerateLineupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = GenerateLineupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const game = await getOwnedGame(userId, params.data.id);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const { availablePlayerIds, constraints } = parsed.data;
  const innings = parsed.data.innings ?? game.innings;

  if (availablePlayerIds.length === 0) {
    res.status(400).json({ error: "No players available" });
    return;
  }

  // Tenant-isolation: silently drop any player ids the caller doesn't own
  // (e.g. crafted request) before hitting the generator.
  const ownedIds = await filterOwnedPlayerIds(userId, availablePlayerIds);
  if (ownedIds.length === 0) {
    res.status(400).json({ error: "No valid players found" });
    return;
  }

  const players = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.userId, userId), inArray(playersTable.id, ownedIds)));

  if (players.length === 0) {
    res.status(400).json({ error: "No valid players found" });
    return;
  }

  // Load this coach's stored constraints from DB.
  const storedConstraints = await db
    .select()
    .from(lineupConstraintsTable)
    .where(and(eq(lineupConstraintsTable.active, true), eq(lineupConstraintsTable.userId, userId)));

  // Load per-game locks. Each row is already a (playerId, inning, position)
  // tuple — exactly the shape `generateFairLineup` expects for `pinned`.
  // We drop rows for innings beyond the (possibly overridden) generation
  // length, for players excluded from `availablePlayerIds` (e.g. checked
  // off in the Generate dialog), and for locks pointing to a position the
  // player is no longer eligible for (eligibility can drift between when
  // the lock was created and when generate runs). Bench is always allowed.
  const lockRows = await db
    .select()
    .from(lineupLocksTable)
    .where(eq(lineupLocksTable.gameId, params.data.id));
  const availableSet = new Set(availablePlayerIds);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const pinned: Array<{ playerId: number; inning: number; position: string }> = [];
  for (const l of lockRows) {
    if (l.inning > innings) continue;
    if (!availableSet.has(l.playerId)) continue;
    const p = playerById.get(l.playerId);
    if (!p) continue;
    if (l.position !== "Bench") {
      const eligible = (p.eligiblePositions ?? []) as string[];
      if (!eligible.includes(l.position)) continue;
    }
    pinned.push({ playerId: l.playerId, inning: l.inning, position: l.position });
  }

  const generated = generateFairLineup(players, innings, constraints ?? {}, storedConstraints, pinned);

  // Feasibility check (mirrors the AI assistant route): every inning needs
  // all 9 field positions filled. If the locks made staffing impossible the
  // greedy generator would silently leave gaps — return 409 with a clear
  // message instead so the coach knows to remove a lock.
  if (pinned.length > 0) {
    const filledByInning = new Map<number, Set<string>>();
    for (const e of generated) {
      if (e.position === "Bench") continue;
      if (!filledByInning.has(e.inning)) filledByInning.set(e.inning, new Set());
      filledByInning.get(e.inning)!.add(e.position);
    }
    const understaffed: number[] = [];
    for (let i = 1; i <= innings; i++) {
      const filled = filledByInning.get(i) ?? new Set();
      if (filled.size < FIELD_POSITIONS.length) understaffed.push(i);
    }
    if (understaffed.length > 0) {
      res.status(409).json({
        error: `Couldn't fill every defensive position in inning ${understaffed.join(", ")} while honoring your locks. Remove a lock or include more players, then try again.`,
        understaffedInnings: understaffed,
      });
      return;
    }
  }

  // Return as lineup entries with player names (not saved yet)
  const playerMap = new Map(players.map((p) => [p.id, p.name]));
  const entries = generated.map((e, idx) => ({
    id: -(idx + 1), // temporary negative IDs to indicate unsaved
    gameId: params.data.id,
    playerId: e.playerId,
    playerName: playerMap.get(e.playerId) ?? "Unknown",
    inning: e.inning,
    position: e.position,
    battingOrder: e.battingOrder,
  }));

  res.json(entries);
});

router.post("/games/:id/lineup/save", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = SaveLineupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SaveLineupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!(await getOwnedGame(userId, params.data.id))) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  // Tenant-isolation: every entry's playerId must belong to this coach.
  const incomingIds = parsed.data.entries.map((e) => e.playerId);
  if (incomingIds.length > 0) {
    const ownedIds = await filterOwnedPlayerIds(userId, incomingIds);
    if (ownedIds.length !== new Set(incomingIds).size) {
      res.status(400).json({ error: "One or more players are not on your roster." });
      return;
    }
  }

  // Delete + insert is wrapped in a single transaction so a failure between
  // the two statements can't leave the game with an empty lineup. This matters
  // especially for the post-game photo override flow, where the coach has just
  // chosen to overwrite a saved plan and would lose all of it on a crash.
  if (parsed.data.entries.length === 0) {
    await db
      .delete(lineupEntriesTable)
      .where(eq(lineupEntriesTable.gameId, params.data.id));
    res.json([]);
    return;
  }

  const insertValues = parsed.data.entries.map((e) => ({
    gameId: params.data.id,
    playerId: e.playerId,
    inning: e.inning,
    position: e.position,
    battingOrder: e.battingOrder ?? null,
  }));

  await db.transaction(async (tx) => {
    await tx
      .delete(lineupEntriesTable)
      .where(eq(lineupEntriesTable.gameId, params.data.id));
    await tx.insert(lineupEntriesTable).values(insertValues);
  });

  // Return the saved entries with player names
  const entries = await db
    .select({
      id: lineupEntriesTable.id,
      gameId: lineupEntriesTable.gameId,
      playerId: lineupEntriesTable.playerId,
      playerName: playersTable.name,
      inning: lineupEntriesTable.inning,
      position: lineupEntriesTable.position,
      battingOrder: lineupEntriesTable.battingOrder,
    })
    .from(lineupEntriesTable)
    .innerJoin(playersTable, eq(lineupEntriesTable.playerId, playersTable.id))
    .where(eq(lineupEntriesTable.gameId, params.data.id))
    .orderBy(lineupEntriesTable.inning, lineupEntriesTable.position, lineupEntriesTable.id);

  res.json(entries);
});

export default router;
