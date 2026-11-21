import { Router, type IRouter } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  basketballGameLineupsTable,
  basketballGameStatsTable,
  basketballRotationSettingsTable,
  playersTable,
  type BasketballGameDay,
  type BasketballPlayerTags,
} from "@workspace/db";
import { gateWrites } from "../lib/permissions";
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

const TagsZ = z.object({
  role: z.enum(["guard", "front"]),
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
    guardOrder: z.array(z.number().int().positive()).max(100),
    frontOrder: z.array(z.number().int().positive()).max(100),
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
        }
      : DEFAULTS,
    players: roster.map((p) => ({
      id: p.id,
      name: p.name,
      number: p.number,
      ...(tags[String(p.id)] ?? defaultTags(p.preferredPositions)),
      tagged: tags[String(p.id)] !== undefined,
    })),
    gameDay: {
      absentIds: keep(gameDay.absentIds),
      guardOrder: keep(gameDay.guardOrder),
      frontOrder: keep(gameDay.frontOrder),
    },
    // Subs at a time for new game lineups; null = ask each time.
    defaultSubSize: saved ? saved.defaultSubSize : 2,
    saved: !!saved,
  });
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
    gameDay: { absentIds: keep(body.gameDay.absentIds), guardOrder: keep(body.gameDay.guardOrder), frontOrder: keep(body.gameDay.frontOrder) },
    updatedAt: new Date(),
  };
  await db
    .insert(basketballRotationSettingsTable)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: basketballRotationSettingsTable.userId, set: values });
  res.json({ ok: true });
});

// ── Per-game starters and playing time (court display) ───────────────────

const GameStatsZ = z.object({
  starterIds: z.array(z.number().int().positive()).max(15),
  playedSec: z.record(z.string().regex(/^\d+$/), z.number().min(0).max(4 * 60 * 60)),
});

function gameIdParam(raw: string | string[] | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.put("/basketball-games/:gameId/stats", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const gameId = gameIdParam(req.params.gameId);
  if (!gameId || !(await getOwnedGame(userId, gameId))) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const parsed = GameStatsZ.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid game stats" });
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
  if (gameId) {
    await db
      .delete(basketballGameStatsTable)
      .where(and(eq(basketballGameStatsTable.gameId, gameId), eq(basketballGameStatsTable.userId, userId)));
  }
  res.status(204).send();
});

/** Season totals per player: games played, starts, and seconds on court. */
// ── Per-game lineup (game page → Set Lineup) ───────────────────────────────

const GameLineupZ = z.object({
  absentIds: z.array(z.number().int().positive()).max(100),
  guardOrder: z.array(z.number().int().positive()).max(100),
  frontOrder: z.array(z.number().int().positive()).max(100),
  subSize: z.number().int().min(1).max(5),
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
      ? { absentIds: row.absentIds, guardOrder: row.guardOrder, frontOrder: row.frontOrder, subSize: row.subSize, updatedAt: row.updatedAt }
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
    guardOrder: keep(parsed.data.guardOrder),
    frontOrder: keep(parsed.data.frontOrder),
    subSize: parsed.data.subSize,
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

router.get("/basketball-season", async (req, res): Promise<void> => {
  res.json(await basketballSeason(req.ownerUserId!));
});

export default router;
