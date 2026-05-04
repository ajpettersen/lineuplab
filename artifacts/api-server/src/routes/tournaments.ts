import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  tournamentsTable,
  gamesTable,
  pitchCountsTable,
  playersTable,
  teamSettingsTable,
  computePitcherAvailability,
  getRulesetOrDefault,
  type Tournament,
} from "@workspace/db";
import {
  CreateTournamentBody,
  GetTournamentParams,
  UpdateTournamentParams,
  UpdateTournamentBody,
  DeleteTournamentParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tournaments", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const tournaments = await db
    .select()
    .from(tournamentsTable)
    .where(eq(tournamentsTable.userId, userId))
    .orderBy(desc(tournamentsTable.startDate));

  if (tournaments.length === 0) {
    res.json([]);
    return;
  }

  const tournamentIds = tournaments.map((t) => t.id);

  // Per-tournament rollup: game count + pitchers used + total pitches.
  const gameCountRows = await db
    .select({
      tournamentId: gamesTable.tournamentId,
      count: sql<number>`count(*)::int`,
    })
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.userId, userId),
        inArray(gamesTable.tournamentId, tournamentIds),
      ),
    )
    .groupBy(gamesTable.tournamentId);

  const pitchAggRows = await db
    .select({
      tournamentId: gamesTable.tournamentId,
      pitchersUsed: sql<number>`count(distinct ${pitchCountsTable.playerId})::int`,
      totalPitches: sql<number>`coalesce(sum(${pitchCountsTable.pitches}), 0)::int`,
    })
    .from(pitchCountsTable)
    .innerJoin(gamesTable, eq(pitchCountsTable.gameId, gamesTable.id))
    .where(
      and(
        eq(gamesTable.userId, userId),
        inArray(gamesTable.tournamentId, tournamentIds),
      ),
    )
    .groupBy(gamesTable.tournamentId);

  const countsByTid = new Map(gameCountRows.map((r) => [r.tournamentId, r.count]));
  const pitchByTid = new Map(
    pitchAggRows.map((r) => [
      r.tournamentId,
      { pitchersUsed: r.pitchersUsed, totalPitches: r.totalPitches },
    ]),
  );

  res.json(
    tournaments.map((t) => ({
      ...t,
      gameCount: countsByTid.get(t.id) ?? 0,
      pitchersUsed: pitchByTid.get(t.id)?.pitchersUsed ?? 0,
      totalPitches: pitchByTid.get(t.id)?.totalPitches ?? 0,
    })),
  );
});

router.post("/tournaments", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = CreateTournamentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const [inserted] = await db
    .insert(tournamentsTable)
    .values({
      userId,
      name: d.name,
      startDate: new Date(d.startDate),
      endDate: new Date(d.endDate),
      location: d.location ?? null,
      notes: d.notes ?? null,
      pitchCountRuleset: d.pitchCountRuleset ?? null,
      dailyPitchMax: d.dailyPitchMax ?? null,
    })
    .returning();
  res.status(201).json(inserted);
});

router.get("/tournaments/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = GetTournamentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [tournament] = await db
    .select()
    .from(tournamentsTable)
    .where(
      and(
        eq(tournamentsTable.id, params.data.id),
        eq(tournamentsTable.userId, userId),
      ),
    );
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }

  // Resolve effective ruleset: tournament override > team default > app default.
  const [settings] = await db
    .select()
    .from(teamSettingsTable)
    .where(eq(teamSettingsTable.userId, userId));
  const rulesetKey =
    tournament.pitchCountRuleset ?? settings?.defaultPitchRuleset ?? null;
  const ruleset = getRulesetOrDefault(rulesetKey);
  const effectiveDailyMax = tournament.dailyPitchMax ?? ruleset.dailyMax;

  // Games in this tournament.
  const games = await db
    .select()
    .from(gamesTable)
    .where(
      and(eq(gamesTable.userId, userId), eq(gamesTable.tournamentId, tournament.id)),
    )
    .orderBy(gamesTable.gameDate);

  // Pitch counts for those games.
  const gameIds = games.map((g) => g.id);
  const counts =
    gameIds.length === 0
      ? []
      : await db
          .select()
          .from(pitchCountsTable)
          .where(
            and(
              eq(pitchCountsTable.userId, userId),
              inArray(pitchCountsTable.gameId, gameIds),
            ),
          );

  // All pitchers on the team — surface availability for everyone the
  // coach might play, not just those with recorded outings, so the
  // tournament view doubles as a "who can pitch tomorrow" reference.
  const pitchers = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.userId, userId), eq(playersTable.canPitch, true)));

  // Index counts by player.
  const gameById = new Map(games.map((g) => [g.id, g]));
  const outingsByPlayer = new Map<
    number,
    { gameId: number; date: Date; pitches: number }[]
  >();
  for (const c of counts) {
    const game = gameById.get(c.gameId);
    if (!game) continue;
    const list = outingsByPlayer.get(c.playerId) ?? [];
    list.push({ gameId: c.gameId, date: game.gameDate, pitches: c.pitches });
    outingsByPlayer.set(c.playerId, list);
  }

  const now = new Date();
  const pitcherAvailability = pitchers.map((p) => {
    const outings = outingsByPlayer.get(p.id) ?? [];
    const total = outings.reduce((s, o) => s + o.pitches, 0);
    const avail = computePitcherAvailability({
      ruleset,
      dailyMaxOverride: tournament.dailyPitchMax ?? null,
      outings,
      now,
    });
    return {
      playerId: p.id,
      playerName: p.name,
      playerNumber: p.number,
      totalPitchesInTournament: total,
      pitchesToday: avail.pitchesToday,
      pitchesAvailableToday: avail.pitchesAvailableToday,
      dailyMax: avail.dailyMax,
      restingUntil: avail.restingUntil,
      outings,
    };
  });

  res.json({
    ...tournament,
    games,
    pitcherAvailability,
    effectiveRuleset: ruleset.key,
    effectiveDailyMax,
  });
});

router.patch("/tournaments/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = UpdateTournamentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTournamentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.name !== undefined) updates.name = d.name;
  if (d.startDate !== undefined) updates.startDate = new Date(d.startDate);
  if (d.endDate !== undefined) updates.endDate = new Date(d.endDate);
  if (d.location !== undefined) updates.location = d.location;
  if (d.notes !== undefined) updates.notes = d.notes;
  if (d.pitchCountRuleset !== undefined)
    updates.pitchCountRuleset = d.pitchCountRuleset;
  if (d.dailyPitchMax !== undefined) updates.dailyPitchMax = d.dailyPitchMax;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields provided" });
    return;
  }

  const [updated] = await db
    .update(tournamentsTable)
    .set(updates)
    .where(
      and(
        eq(tournamentsTable.id, params.data.id),
        eq(tournamentsTable.userId, userId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  res.json(updated as Tournament);
});

router.delete("/tournaments/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = DeleteTournamentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Detach games first (don't cascade-delete a coach's games when they
  // delete a tournament container — the games are still meaningful).
  await db.transaction(async (tx) => {
    await tx
      .update(gamesTable)
      .set({ tournamentId: null })
      .where(
        and(eq(gamesTable.userId, userId), eq(gamesTable.tournamentId, params.data.id)),
      );
    await tx
      .delete(tournamentsTable)
      .where(
        and(
          eq(tournamentsTable.id, params.data.id),
          eq(tournamentsTable.userId, userId),
        ),
      );
  });
  res.status(204).end();
});

export default router;
