import { Router, type IRouter } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  basketballGameLineupsTable,
  basketballGameStatsTable,
  basketballRotationSettingsTable,
  basketballLiveGamesTable,
  gamesTable,
  playersTable,
  type BasketballGameDay,
  type BasketballPlayerTags,
} from "@workspace/db";
import { assertPermission, gateWrites } from "../lib/permissions";
import { filterOwnedPlayerIds, getOwnedGame } from "../lib/ownership";
import { basketballSeason } from "../lib/basketball-season";

// Basketball bench sheet: per-team rotation setup on top of the team's roster.
// Building the rotation for a game is lineup work, so assistant coaches with
// "partial" access can save it (same tier as game lineups).
const router: IRouter = Router();
router.use("/basketball-rotation", gateWrites("partial"));
router.use("/basketball-games", gateWrites("partial"));

const DEFAULTS = { halfMinutes: 20, shiftMinutes: 2.5, guardSpots: 2, frontSpots: 3, flexShifts: 1 };

const BASKETBALL_CODES = new Set(["PG", "SG", "SF", "PF", "C"]);

/**
 * First guess at a player's tags from the positions the roster lists for them
 * (`preferredPositions`: PG/SG/SF/PF/C on a basketball team). Not
 * `eligiblePositions`, which the server always fills with baseball positions.
 */
export function defaultTags(preferredPositions: string[]): BasketballPlayerTags {
  const positions = preferredPositions.map((p) => p.toUpperCase()).filter((p) => BASKETBALL_CODES.has(p));
  const guardOnly = positions.length > 0 && positions.every((p) => p === "PG" || p === "SG");
  if (guardOnly) {
    const position = positions.length === 1 ? (positions[0] === "PG" ? "1" : "2") : null;
    return { role: "guard", big: false, position };
  }
  return { role: "front", big: positions.includes("C"), position: null };
}

// Position group keys across all layouts (see GROUP_LAYOUTS on the web side).
const ROLE_KEYS = ["guard", "front", "forward", "center", "perimeter", "big", "all"] as const;
const GROUP_LAYOUTS = ["guards-front", "guards-forwards-center", "perimeter-bigs", "five-out"] as const;

const TagsZ = z.object({
  role: z.enum(ROLE_KEYS),
  big: z.boolean(),
  position: z.enum(["1", "2"]).nullable(),
});

const BodyZ = z.object({
  halfMinutes: z.number().min(1).max(60),
  shiftMinutes: z.number().min(0.5).max(60),
  guardSpots: z.number().int().min(0).max(5),
  frontSpots: z.number().int().min(0).max(5),
  flexShifts: z.number().int().min(0).max(20),
  playerTags: z.record(z.string().regex(/^\d+$/), TagsZ),
  gameDay: z.object({
    absentIds: z.array(z.number().int().positive()).max(100),
    /** Starting order across all position groups. */
    order: z.array(z.number().int().positive()).max(100).optional(),
    // Older clients sent one order per Guards / Front queue.
    guardOrder: z.array(z.number().int().positive()).max(100).optional(),
    frontOrder: z.array(z.number().int().positive()).max(100).optional(),
  }),
})
  .refine((b) => b.shiftMinutes <= b.halfMinutes, { message: "Shift length can't be longer than a half." })
  .refine((b) => b.guardSpots + b.frontSpots >= 1, { message: "There must be at least one spot on court." });

async function rosterFor(userId: string) {
  return db
    .select({
      id: playersTable.id,
      name: playersTable.name,
      number: playersTable.number,
      preferredPositions: playersTable.preferredPositions,
    })
    .from(playersTable)
    .where(and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt), eq(playersTable.active, true)))
    .orderBy(asc(playersTable.name));
}

router.get("/basketball-rotation", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const [roster, [saved]] = await Promise.all([
    rosterFor(userId),
    db.select().from(basketballRotationSettingsTable).where(eq(basketballRotationSettingsTable.userId, userId)),
  ]);
  const tags = saved?.playerTags ?? {};
  const known = new Set(roster.map((p) => p.id));
  const keep = (ids: number[]) => ids.filter((id) => known.has(id));
  const gameDay: BasketballGameDay = saved?.gameDay ?? { absentIds: [], guardOrder: [], frontOrder: [] };
  res.json({
    settings: saved
      ? {
          halfMinutes: saved.halfMinutes,
          shiftMinutes: saved.shiftMinutes,
          guardSpots: saved.guardSpots,
          frontSpots: saved.frontSpots,
          flexShifts: saved.flexShifts,
          groupLayout: saved.groupLayout,
        }
      : { ...DEFAULTS, groupLayout: "guards-front" },
    rules: saved?.rules ?? {},
    players: roster.map((p) => ({
      id: p.id,
      name: p.name,
      number: p.number,
      ...(tags[String(p.id)] ?? defaultTags(p.preferredPositions)),
      tagged: tags[String(p.id)] !== undefined,
    })),
    gameDay: {
      absentIds: keep(gameDay.absentIds),
      order: keep(gameDay.order ?? [...gameDay.guardOrder, ...gameDay.frontOrder]),
    },
    // Subs at a time for new game lineups; null = ask each time.
    defaultSubSize: saved ? saved.defaultSubSize : 2,
    saved: !!saved,
  });
});

// Settings → Rotation: how the five spots are grouped.
router.patch("/basketball-rotation/group-layout", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = z.object({ groupLayout: z.enum(GROUP_LAYOUTS) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Unknown position groups." });
    return;
  }
  const { groupLayout } = parsed.data;
  await db
    .insert(basketballRotationSettingsTable)
    .values({ userId, groupLayout, updatedAt: new Date() })
    .onConflictDoUpdate({ target: basketballRotationSettingsTable.userId, set: { groupLayout, updatedAt: new Date() } });
  res.json({ ok: true, groupLayout });
});

// Settings → Rotation: limits for Rebalance, halves or quarters, pairing
// rules. Each key replaces the saved one; null removes it (back to default).
const RulesPatchZ = z.object({
  maxOnSec: z.number().int().min(60).max(2400).nullable().optional(),
  maxBenchSec: z.number().int().min(60).max(2400).nullable().optional(),
  minShareGapSec: z.number().int().min(0).max(2400).nullable().optional(),
  keepGroupBalance: z.boolean().nullable().optional(),
  format: z.object({ periods: z.union([z.literal(2), z.literal(4)]), periodMinutes: z.number().min(1).max(30) }).nullable().optional(),
  neverTogether: z.array(z.array(z.string().regex(/^\d+$/)).min(2).max(5)).max(20).nullable().optional(),
  atLeastOne: z
    .array(z.object({ label: z.string().trim().min(1).max(40), ids: z.array(z.string().regex(/^\d+$/)).min(1).max(15) }))
    .max(10)
    .nullable()
    .optional(),
});

router.patch("/basketball-rotation/rules", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = RulesPatchZ.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid rotation rules" });
    return;
  }
  const [saved] = await db
    .select({ rules: basketballRotationSettingsTable.rules })
    .from(basketballRotationSettingsTable)
    .where(eq(basketballRotationSettingsTable.userId, userId));
  const rules: Record<string, unknown> = { ...(saved?.rules ?? {}) };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    if (value === null) delete rules[key];
    else rules[key] = value;
  }
  // Halves or quarters: the period length lives in half_minutes (one source of truth).
  const periodMinutes = parsed.data.format ? parsed.data.format.periodMinutes : undefined;
  const set = { rules, updatedAt: new Date(), ...(periodMinutes !== undefined ? { halfMinutes: periodMinutes } : {}) };
  await db
    .insert(basketballRotationSettingsTable)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: basketballRotationSettingsTable.userId, set });
  res.json({ ok: true, rules });
});

// Settings → Rotation: default subs at a time (1–5), or null to ask for each game.
router.patch("/basketball-rotation/default-sub-size", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = z.object({ defaultSubSize: z.number().int().min(1).max(5).nullable() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Subs at a time must be 1 to 5, or ask each time." });
    return;
  }
  const { defaultSubSize } = parsed.data;
  await db
    .insert(basketballRotationSettingsTable)
    .values({ userId, defaultSubSize, updatedAt: new Date() })
    .onConflictDoUpdate({ target: basketballRotationSettingsTable.userId, set: { defaultSubSize, updatedAt: new Date() } });
  res.json({ ok: true, defaultSubSize });
});

router.put("/basketball-rotation", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = BodyZ.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid bench sheet settings" });
    return;
  }
  const body = parsed.data;
  // Only keep ids that are on this team's roster.
  const known = new Set((await rosterFor(userId)).map((p) => p.id));
  const keep = (ids: number[]) => [...new Set(ids.filter((id) => known.has(id)))];
  const playerTags = Object.fromEntries(
    Object.entries(body.playerTags)
      .filter(([id]) => known.has(Number(id)))
      .map(([id, t]): [string, BasketballPlayerTags] => [
        id,
        { role: t.role, big: t.role === "front" && t.big, position: t.role === "guard" ? t.position : null },
      ]),
  );
  const values = {
    halfMinutes: body.halfMinutes,
    shiftMinutes: body.shiftMinutes,
    guardSpots: body.guardSpots,
    frontSpots: body.frontSpots,
    flexShifts: body.flexShifts,
    playerTags,
    gameDay: {
      absentIds: keep(body.gameDay.absentIds),
      order: keep(body.gameDay.order ?? [...(body.gameDay.guardOrder ?? []), ...(body.gameDay.frontOrder ?? [])]),
      guardOrder: [],
      frontOrder: [],
    },
    updatedAt: new Date(),
  };
  await db
    .insert(basketballRotationSettingsTable)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: basketballRotationSettingsTable.userId, set: values });
  res.json({ ok: true });
});

// ── Per-game starters and playing time (court display) ───────────────────

const LogEventZ = z.union([
  z.object({ kind: z.literal("lineup"), at: z.number().min(0).max(4 * 60 * 60), on: z.array(z.string().regex(/^\d+$/)).max(5) }),
  z.object({
    kind: z.literal("score").optional(),
    team: z.enum(["us", "them"]),
    pts: z.number().int().min(-10).max(10),
    half: z.number().int().min(1).max(8).optional(),
    at: z.number().min(0).max(4 * 60 * 60),
    on: z.array(z.string().regex(/^\d+$/)).max(5),
  }),
]);
const GameStatsZ = z.object({
  starterIds: z.array(z.number().int().positive()).max(15),
  playedSec: z.record(z.string().regex(/^\d+$/), z.number().min(0).max(4 * 60 * 60)),
  /** Lineup changes and scoring, for plus/minus by lineup. */
  log: z.array(LogEventZ).max(2000).optional(),
});

function gameIdParam(raw: string | string[] | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Total seconds in a playedSec map. */
const totalSec = (played: Record<string, number> | null | undefined) =>
  Object.values(played ?? {}).reduce((sum, sec) => sum + (Number(sec) || 0), 0);

// The court display saves as it goes. Two guards keep a stray run from wiping
// real numbers (it happened when an old game's court display was reopened
// and its clock started again from zero):
//   - once a game has its final score, its playing time is kept as it is;
//   - a save that would cut the stored total by more than half is a new run
//     starting over, not a correction, so it waits until it catches up.
router.put("/basketball-games/:gameId/stats", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const gameId = gameIdParam(req.params.gameId);
  const game = gameId ? await getOwnedGame(userId, gameId) : null;
  if (!gameId || !game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const parsed = GameStatsZ.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid game stats" });
    return;
  }
  if (game.status === "completed") {
    res.json({ ok: false, kept: "final" });
    return;
  }
  const [existing] = await db
    .select({ playedSec: basketballGameStatsTable.playedSec })
    .from(basketballGameStatsTable)
    .where(and(eq(basketballGameStatsTable.gameId, gameId), eq(basketballGameStatsTable.userId, userId)));
  if (existing && totalSec(parsed.data.playedSec) < totalSec(existing.playedSec) / 2) {
    res.json({ ok: false, kept: "larger" });
    return;
  }
  const mentioned = [...new Set([...parsed.data.starterIds, ...Object.keys(parsed.data.playedSec).map(Number)])];
  const owned = new Set(await filterOwnedPlayerIds(userId, mentioned));
  const values = {
    userId,
    starterIds: parsed.data.starterIds.filter((id) => owned.has(id)),
    playedSec: Object.fromEntries(
      Object.entries(parsed.data.playedSec)
        .filter(([id]) => owned.has(Number(id)))
        .map(([id, sec]) => [id, Math.round(sec)]),
    ),
    ...(parsed.data.log
      ? {
          scoreLog: parsed.data.log.map((e) => ({ ...e, on: e.on.filter((id) => owned.has(Number(id))) })) as unknown as (typeof basketballGameStatsTable.$inferInsert)["scoreLog"],
        }
      : {}),
    updatedAt: new Date(),
  };
  await db
    .insert(basketballGameStatsTable)
    .values({ gameId, ...values })
    .onConflictDoUpdate({ target: basketballGameStatsTable.gameId, set: values });
  res.json({ ok: true });
});

router.get("/basketball-games/:gameId/stats", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const gameId = gameIdParam(req.params.gameId);
  if (!gameId || !(await getOwnedGame(userId, gameId))) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const [[row], roster] = await Promise.all([
    db
      .select()
      .from(basketballGameStatsTable)
      .where(and(eq(basketballGameStatsTable.gameId, gameId), eq(basketballGameStatsTable.userId, userId))),
    rosterFor(userId),
  ]);
  if (!row) {
    res.json({ tracked: false, players: [] });
    return;
  }
  const players = roster
    .map((p) => ({
      playerId: p.id,
      name: p.name,
      number: p.number,
      started: row.starterIds.includes(p.id),
      seconds: row.playedSec[String(p.id)] ?? 0,
    }))
    .filter((p) => p.started || p.seconds > 0);
  res.json({ tracked: true, players });
});

router.delete("/basketball-games/:gameId/stats", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const gameId = gameIdParam(req.params.gameId);
  // A game with its final score keeps its playing time (resetting the court display doesn't clear it).
  const game = gameId ? await getOwnedGame(userId, gameId) : null;
  if (game && game.status !== "completed") {
    await db
      .delete(basketballGameStatsTable)
      .where(and(eq(basketballGameStatsTable.gameId, game.id), eq(basketballGameStatsTable.userId, userId)));
  }
  res.status(204).send();
});

/** Season totals per player: games played, starts, and seconds on court. */
// ── Per-game lineup (game page → Set Lineup) ───────────────────────────────

const GameLineupZ = z.object({
  absentIds: z.array(z.number().int().positive()).max(100),
  /** Starting order across all position groups. */
  order: z.array(z.number().int().positive()).max(100).optional(),
  guardOrder: z.array(z.number().int().positive()).max(100).optional(),
  frontOrder: z.array(z.number().int().positive()).max(100).optional(),
  subSize: z.number().int().min(1).max(5),
  /** This game only; null/absent = the team's Bench Sheet setting. */
  shiftMinutes: z.number().min(0.5).max(60).nullable().optional(),
  flexShifts: z.number().int().min(0).max(20).nullable().optional(),
  /** A custom plan: per planned shift, the player ids at spots 1–5. */
  customShifts: z.array(z.array(z.number().int().positive()).min(1).max(5)).max(120).nullable().optional(),
});

router.get("/basketball-games/:gameId/lineup", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const gameId = gameIdParam(req.params.gameId);
  if (!gameId || !(await getOwnedGame(userId, gameId))) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const [row] = await db
    .select()
    .from(basketballGameLineupsTable)
    .where(and(eq(basketballGameLineupsTable.gameId, gameId), eq(basketballGameLineupsTable.userId, userId)));
  res.json({
    lineup: row
      ? {
          absentIds: row.absentIds,
          order: row.startOrder.length ? row.startOrder : [...row.guardOrder, ...row.frontOrder],
          subSize: row.subSize,
          shiftMinutes: row.shiftMinutes,
          flexShifts: row.flexShifts,
          customShifts: row.customShifts ?? null,
          updatedAt: row.updatedAt,
        }
      : null,
  });
});

router.put("/basketball-games/:gameId/lineup", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const gameId = gameIdParam(req.params.gameId);
  if (!gameId || !(await getOwnedGame(userId, gameId))) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const parsed = GameLineupZ.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid lineup" });
    return;
  }
  const known = new Set((await rosterFor(userId)).map((p) => p.id));
  const keep = (ids: number[]) => [...new Set(ids.filter((id) => known.has(id)))];
  const values = {
    userId,
    absentIds: keep(parsed.data.absentIds),
    startOrder: keep(parsed.data.order ?? [...(parsed.data.guardOrder ?? []), ...(parsed.data.frontOrder ?? [])]),
    guardOrder: [],
    frontOrder: [],
    subSize: parsed.data.subSize,
    shiftMinutes: parsed.data.shiftMinutes ?? null,
    flexShifts: parsed.data.flexShifts ?? null,
    // Only this team's players; a shift can't list someone twice.
    customShifts: parsed.data.customShifts
      ? parsed.data.customShifts.map((shift) => [...new Set(shift.filter((id) => known.has(id)))])
      : null,
    updatedAt: new Date(),
  };
  await db
    .insert(basketballGameLineupsTable)
    .values({ gameId, ...values })
    .onConflictDoUpdate({ target: basketballGameLineupsTable.gameId, set: values });
  res.json({ ok: true });
});

router.delete("/basketball-games/:gameId/lineup", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const gameId = gameIdParam(req.params.gameId);
  if (gameId) {
    await db
      .delete(basketballGameLineupsTable)
      .where(and(eq(basketballGameLineupsTable.gameId, gameId), eq(basketballGameLineupsTable.userId, userId)));
  }
  res.status(204).send();
});

// ── Second-coach mode: one live game shared between devices ────────────────
// Every change to the court display's state is saved here with a version
// number; other devices poll GET ?since=<version> about once a second and
// take the newer state. Last write wins: a save made without seeing the
// latest version still goes through, and the response hands back what it
// replaced so that device can offer Undo. One device runs the clock.

const LiveSaveZ = z.object({
  /** The version this device last saw (null = it never saw one). */
  baseVersion: z.number().int().min(0).nullable(),
  state: z.record(z.string(), z.unknown()),
  deviceId: z.string().min(4).max(64),
  /** Short description of the change, for the "who did this" line. */
  change: z.string().max(160),
  name: z.string().trim().max(60).nullable().optional(),
  /** Claim the clock for this device (start/stop, timeouts). */
  takeClock: z.boolean().optional(),
});

function presentLive(row: typeof basketballLiveGamesTable.$inferSelect) {
  return {
    version: row.version,
    state: row.state,
    clockDevice: row.clockDevice,
    updatedBy: row.updatedBy,
    updatedByName: row.updatedByName,
    lastChange: row.lastChange,
    updatedAt: row.updatedAt,
  };
}

router.get("/basketball-games/:gameId/live", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const gameId = gameIdParam(req.params.gameId);
  if (!gameId || !(await getOwnedGame(userId, gameId))) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const [row] = await db
    .select()
    .from(basketballLiveGamesTable)
    .where(and(eq(basketballLiveGamesTable.gameId, gameId), eq(basketballLiveGamesTable.userId, userId)));
  const since = Number(req.query.since);
  if (row && Number.isInteger(since) && since === row.version) {
    res.status(204).send();
    return;
  }
  res.json({ live: row ? presentLive(row) : null });
});

router.put("/basketball-games/:gameId/live", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const gameId = gameIdParam(req.params.gameId);
  if (!gameId || !(await getOwnedGame(userId, gameId))) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const parsed = LiveSaveZ.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid live game" });
    return;
  }
  const { baseVersion, state, deviceId, change, name, takeClock } = parsed.data;
  if (JSON.stringify(state).length > 400_000) {
    res.status(413).json({ error: "Live game state is too large" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(basketballLiveGamesTable)
      .where(and(eq(basketballLiveGamesTable.gameId, gameId), eq(basketballLiveGamesTable.userId, userId)))
      .for("update");
    const replaced = row && baseVersion !== row.version ? presentLive(row) : null;
    const version = (row?.version ?? 0) + 1;
    const clockDevice = takeClock || !row?.clockDevice ? deviceId : row.clockDevice;
    const values = {
      gameId,
      userId,
      version,
      state,
      clockDevice,
      updatedBy: deviceId,
      updatedByName: name ?? null,
      lastChange: change,
      updatedAt: new Date(),
    };
    const [saved] = await tx
      .insert(basketballLiveGamesTable)
      .values(values)
      .onConflictDoUpdate({ target: basketballLiveGamesTable.gameId, set: values })
      .returning();
    return { live: presentLive(saved), replaced };
  });
  res.json(result);
});

// Reset on the court display clears the shared copy too.
router.delete("/basketball-games/:gameId/live", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const gameId = gameIdParam(req.params.gameId);
  if (gameId) {
    await db.delete(basketballLiveGamesTable).where(and(eq(basketballLiveGamesTable.gameId, gameId), eq(basketballLiveGamesTable.userId, userId)));
  }
  res.status(204).send();
});

// Statistics → Lineups (coach-only): each tracked game's lineup and scoring
// log, for plus/minus by five-player group and by player.
router.get("/basketball-lineups", assertPermission("partial"), async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const rows = await db
    .select({
      gameId: basketballGameStatsTable.gameId,
      playedSec: basketballGameStatsTable.playedSec,
      log: basketballGameStatsTable.scoreLog,
      date: gamesTable.gameDate,
      opponent: gamesTable.opponent,
    })
    .from(basketballGameStatsTable)
    .innerJoin(gamesTable, and(eq(gamesTable.id, basketballGameStatsTable.gameId), eq(gamesTable.userId, userId), isNull(gamesTable.deletedAt)))
    .where(eq(basketballGameStatsTable.userId, userId));
  const roster = await rosterFor(userId);
  res.json({
    games: rows
      .filter((r) => Array.isArray(r.log) && r.log.length > 0)
      .map((r) => ({
        gameId: r.gameId,
        date: new Date(r.date).toISOString(),
        opponent: r.opponent,
        gameSec: Math.round(Object.values(r.playedSec).reduce((a, b) => a + (Number(b) || 0), 0) / 5),
        events: r.log,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    players: roster.map((p) => ({ id: String(p.id), name: p.name })),
  });
});

router.get("/basketball-season", async (req, res): Promise<void> => {
  // ?gameIds=1,2,3 limits it to those games (a tournament's).
  const raw = typeof req.query.gameIds === "string" ? req.query.gameIds : null;
  const gameIds = raw === null ? null : raw.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
  res.json(await basketballSeason(req.ownerUserId!, gameIds));
});

export default router;
