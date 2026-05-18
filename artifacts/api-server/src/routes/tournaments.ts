import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import { simulatePoolPlay } from "../lib/pool-play-simulator";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  tournamentsTable,
  gamesTable,
  pitchCountsTable,
  playersTable,
  teamSettingsTable,
  computePitcherAvailability,
  normalizePoolPlay,
  type Game,
  type PoolPlayJson,
  type PoolPlayGameJson,
  type Tournament,
  type RestTier,
} from "@workspace/db";
import {
  CreateTournamentBody,
  GetTournamentParams,
  UpdateTournamentParams,
  UpdateTournamentBody,
  DeleteTournamentParams,
} from "@workspace/api-zod";
import { computeTournamentFingerprint } from "../lib/tournament-fingerprint";
import { mergeNetworkGamesIntoPool } from "../lib/tournament-network-merge";

const router: IRouter = Router();
router.use("/tournaments", gateWrites("full"));

/**
 * Merge real `games` rows for a tournament into the saved pool-play
 * games list as synthetic `real-<gameId>` entries.
 *
 *  - Idempotent: every existing `real-*` entry is dropped first, then
 *    the current schedule is re-projected. Coach-entered (non-real)
 *    games are untouched.
 *  - Match by exact opponent name against pool team names — we do NOT
 *    fuzz-match. If the schedule calls them "Sluggers" but the pool
 *    says "Plymouth Sluggers", the game is silently skipped (the
 *    coach can rename either side to bring them into agreement).
 *  - "Our" team is always the home team in the synthetic entry, so
 *    homeScore = our score and awayScore = opponent score.
 *  - `final` is set when BOTH scores are recorded — that's the gate
 *    for a game to count toward standings/tiebreakers.
 */
function mergeRealGamesIntoPool(
  pool: PoolPlayJson,
  games: Game[],
  teamName: string | null,
): PoolPlayJson {
  if (!teamName) return pool;
  const poolTeams = new Set(pool.teams.map((t) => t.name));
  if (!poolTeams.has(teamName)) return pool;
  // Strip prior real-* entries; manualGames represent the coach's
  // intended pool schedule (one row per pool game).
  const manualGames = pool.games.filter((g) => !g.id.startsWith("real-"));

  // Pool play is typically a single round-robin against each pool
  // opponent (sometimes a double-RR). Bracket / playoff games against
  // a former pool opponent must NOT count toward pool standings.
  // Heuristic: per opponent, the QUOTA is `max(manualPoolGamesVsOpponent, 1)`.
  // We merge up to that many real games per opponent, earliest by
  // gameDate first (the pool round happens before the bracket).
  const quotaByOpp = new Map<string, number>();
  for (const g of manualGames) {
    const opp = g.home === teamName ? g.away : g.away === teamName ? g.home : null;
    if (!opp || !poolTeams.has(opp)) continue;
    quotaByOpp.set(opp, (quotaByOpp.get(opp) ?? 0) + 1);
  }

  // Group real games by opponent, sort each group ascending by date.
  const realByOpp = new Map<string, Game[]>();
  for (const g of games) {
    if (!g.opponent || !poolTeams.has(g.opponent)) continue;
    const list = realByOpp.get(g.opponent) ?? [];
    list.push(g);
    realByOpp.set(g.opponent, list);
  }
  for (const list of realByOpp.values()) {
    list.sort((a, b) => {
      const da = a.gameDate ? new Date(a.gameDate).getTime() : 0;
      const db = b.gameDate ? new Date(b.gameDate).getTime() : 0;
      return da - db;
    });
  }

  const syntheticGames: PoolPlayGameJson[] = [];
  for (const [opp, list] of realByOpp) {
    const quota = quotaByOpp.get(opp) ?? 1;
    for (const g of list.slice(0, quota)) {
      const ourScore = g.ourScore;
      const oppScore = g.opponentScore;
      const bothSet = ourScore != null && oppScore != null;
      syntheticGames.push({
        id: `real-${g.id}`,
        home: teamName,
        away: g.opponent!,
        homeScore: ourScore ?? null,
        awayScore: oppScore ?? null,
        final: bothSet,
        // Copy the real schedule timestamp so the "awaiting score"
        // surface knows when this game was supposed to start.
        scheduledAt: g.gameDate ? new Date(g.gameDate).toISOString() : null,
      });
    }
  }
  return { ...pool, games: [...manualGames, ...syntheticGames] };
}

router.get("/tournaments", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const tournaments = await db
    .select()
    .from(tournamentsTable)
    .where(
      and(
        eq(tournamentsTable.userId, userId),
        isNull(tournamentsTable.deletedAt),
      ),
    )
    .orderBy(desc(tournamentsTable.startDate));

  if (tournaments.length === 0) {
    res.json([]);
    return;
  }

  const tournamentIds = tournaments.map((t) => t.id);

  const gameCountRows = await db
    .select({
      tournamentId: gamesTable.tournamentId,
      count: sql<number>`count(*)::int`,
    })
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.userId, userId),
        isNull(gamesTable.deletedAt),
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
        isNull(gamesTable.deletedAt),
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
  // Fingerprint for cross-coach network discovery. Computed from
  // (normalized name, start, end) — empty string when any of those
  // are missing, in which case we store NULL so the suggestion query
  // doesn't collide everyone with blank metadata.
  const fp = computeTournamentFingerprint(d.name, d.startDate, d.endDate);
  const [inserted] = await db
    .insert(tournamentsTable)
    .values({
      userId,
      name: d.name,
      startDate: new Date(d.startDate),
      endDate: new Date(d.endDate),
      location: d.location ?? null,
      notes: d.notes ?? null,
      dailyPitchMax: d.dailyPitchMax ?? null,
      tournamentPitchMax: d.tournamentPitchMax ?? null,
      restTiers: (d.restTiers ?? null) as RestTier[] | null,
      poolPlayNoNewInningMinutes: d.poolPlayNoNewInningMinutes ?? null,
      poolPlayHardStopMinutes: d.poolPlayHardStopMinutes ?? null,
      bracketNoNewInningMinutes: d.bracketNoNewInningMinutes ?? null,
      bracketHardStopMinutes: d.bracketHardStopMinutes ?? null,
      networkFingerprint: fp || null,
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
        isNull(tournamentsTable.deletedAt),
      ),
    );
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }

  // Resolve effective rules: per-tournament value wins, falls back to
  // team default, falls back to null/empty (no enforcement).
  const [settings] = await db
    .select()
    .from(teamSettingsTable)
    .where(eq(teamSettingsTable.userId, userId));
  const effectiveDailyMax =
    tournament.dailyPitchMax ?? settings?.defaultDailyPitchMax ?? null;
  const effectiveTournamentMax =
    tournament.tournamentPitchMax ?? settings?.defaultTournamentPitchMax ?? null;
  const effectiveRestTiers: RestTier[] =
    tournament.restTiers ?? settings?.defaultRestTiers ?? [];

  const games = await db
    .select()
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.userId, userId),
        isNull(gamesTable.deletedAt),
        eq(gamesTable.tournamentId, tournament.id),
      ),
    )
    .orderBy(gamesTable.gameDate);

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

  const pitchers = await db
    .select()
    .from(playersTable)
    .where(
      and(
        eq(playersTable.userId, userId),
        eq(playersTable.canPitch, true),
        isNull(playersTable.deletedAt),
      ),
    );

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
      dailyMax: effectiveDailyMax,
      tournamentMax: effectiveTournamentMax,
      restTiers: effectiveRestTiers.length > 0 ? effectiveRestTiers : null,
      outings,
      now,
    });
    return {
      playerId: p.id,
      playerName: p.name,
      playerNumber: p.number,
      totalPitchesInTournament: total,
      pitchesToday: avail.pitchesToday,
      // Coerce Infinity → null in the wire payload (JSON can't carry it,
      // and `0` would lie — "no cap" must NOT read as "no pitches left").
      // Clients render this as "—" when null.
      pitchesAvailableToday:
        avail.pitchesAvailableToday === Infinity
          ? null
          : avail.pitchesAvailableToday,
      pitchesAvailableInTournament:
        avail.pitchesAvailableInTournament === Infinity
          ? null
          : avail.pitchesAvailableInTournament,
      dailyMax: avail.dailyMax,
      restingUntil: avail.restingUntil,
      outings,
    };
  });

  // ---- Per-game pitcher suggestions ----
  // Walks the team's "P" depth chart (auto-seeded with canPitch players
  // not yet in the saved order, sorted by name) and for each FUTURE game
  // with no outings logged yet emits up to 3 candidates: starter +
  // 2 backups. Availability is projected AT the game's date using only
  // outings on/before that date — so logging pitches for game 1 today
  // automatically reshuffles suggestions for tomorrow's game 2.
  // Games already in progress (any outings logged) or already past are
  // skipped — the existing per-game pitcher chips show what actually
  // happened.
  const savedOrder: number[] = Array.isArray(settings?.depthChart?.P)
    ? (settings!.depthChart!.P as number[])
    : [];
  const pitcherById = new Map(pitchers.map((p) => [p.id, p]));
  const orderedIds: number[] = [];
  const seen = new Set<number>();
  for (const id of savedOrder) {
    if (pitcherById.has(id) && !seen.has(id)) {
      orderedIds.push(id);
      seen.add(id);
    }
  }
  // Append any canPitch players not in the saved order (alphabetical),
  // mirroring how /depth-chart auto-seeds new pitchers.
  const remaining = pitchers
    .filter((p) => !seen.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const p of remaining) orderedIds.push(p.id);

  const pitchesByGameByPlayer = new Map<number, number>();
  for (const c of counts) {
    pitchesByGameByPlayer.set(c.gameId, (pitchesByGameByPlayer.get(c.gameId) ?? 0) + c.pitches);
  }

  // Simulated outings: when we suggest a starter for game N, we credit
  // them with an estimated outing at that game's date so the projection
  // for game N+1 reflects "if you actually start them, they'll be
  // tired/resting for the next one". Backups get a smaller estimate
  // (they may or may not enter). Without this, the depth-chart-#1 arm
  // would be re-suggested as starter for every game until pitches are
  // logged.
  const ASSUMED_STARTER_PITCHES = 50;
  const ASSUMED_BACKUP_PITCHES = 15;
  const simulatedOutings = new Map<number, { date: Date; pitches: number }[]>();

  // Walk games chronologically so simulated outings from earlier games
  // shape availability for later ones. `games` is already ordered by
  // gameDate from the query above.
  const gameSuggestions = games.map((g) => {
    const gameDate = new Date(g.gameDate);
    const alreadyHasPitches = (pitchesByGameByPlayer.get(g.id) ?? 0) > 0;
    // Suggest only for upcoming games that haven't started logging
    // outings. Once a coach starts logging, the suggestion is stale and
    // the actual chips below tell the real story.
    if (alreadyHasPitches || gameDate.getTime() < now.getTime()) {
      return { gameId: g.id, pitchers: [] };
    }
    const candidates: Array<{
      playerId: number;
      playerName: string;
      playerNumber: number | null;
      depthRank: number;
      role: "starter" | "backup";
      pitchesAvailableToday: number | null;
      pitchesAvailableInTournament: number | null;
      restingUntil: ReturnType<typeof computePitcherAvailability>["restingUntil"];
    }> = [];
    for (let i = 0; i < orderedIds.length; i++) {
      const pid = orderedIds[i];
      const p = pitcherById.get(pid)!;
      const realOutings = outingsByPlayer.get(pid) ?? [];
      const simOutings = simulatedOutings.get(pid) ?? [];
      // Project using real outings + any simulated outings from earlier
      // suggestions in this same response. Only count things on/before
      // the projected game's date.
      const outingsThroughGame = [...realOutings, ...simOutings].filter(
        (o) => new Date(o.date).getTime() <= gameDate.getTime(),
      );
      const avail = computePitcherAvailability({
        dailyMax: effectiveDailyMax,
        tournamentMax: effectiveTournamentMax,
        restTiers: effectiveRestTiers.length > 0 ? effectiveRestTiers : null,
        outings: outingsThroughGame,
        now: gameDate,
      });
      // Skip resting pitchers + anyone with zero capacity (either daily
      // or tournament). A null cap means "no limit" so it passes.
      if (avail.restingUntil) continue;
      if (avail.pitchesAvailableToday !== Infinity && avail.pitchesAvailableToday <= 0) continue;
      if (avail.pitchesAvailableInTournament !== Infinity && avail.pitchesAvailableInTournament <= 0) continue;
      candidates.push({
        playerId: pid,
        playerName: p.name,
        playerNumber: p.number,
        depthRank: i + 1,
        role: candidates.length === 0 ? "starter" : "backup",
        pitchesAvailableToday:
          avail.pitchesAvailableToday === Infinity ? null : avail.pitchesAvailableToday,
        pitchesAvailableInTournament:
          avail.pitchesAvailableInTournament === Infinity ? null : avail.pitchesAvailableInTournament,
        restingUntil: avail.restingUntil,
      });
      if (candidates.length >= 3) break;
    }
    // Record simulated outings so they shape projections for later
    // games in this same response. Cap the simulated pitch count by
    // what the pitcher actually has available (so we don't double-count
    // past their daily/tournament limit).
    for (const c of candidates) {
      const estimate = c.role === "starter" ? ASSUMED_STARTER_PITCHES : ASSUMED_BACKUP_PITCHES;
      const capped =
        c.pitchesAvailableToday != null
          ? Math.min(estimate, c.pitchesAvailableToday)
          : estimate;
      if (capped <= 0) continue;
      const list = simulatedOutings.get(c.playerId) ?? [];
      list.push({ date: gameDate, pitches: capped });
      simulatedOutings.set(c.playerId, list);
    }
    return { gameId: g.id, pitchers: candidates };
  });

  // Pool play: data is stored on the tournament row; the scenario
  // analysis is fully derived, so we recompute it on every GET. Cheap
  // (≤16k scenarios, microseconds) and keeps edits feeling instant —
  // saving the games re-projects on the next refetch with no extra
  // round-trip.
  //
  // Live games sync: we merge any REAL `games` rows whose tournamentId
  // matches and whose opponent name appears in the pool. They become
  // synthetic `real-<gameId>` entries (idempotent — we strip any
  // existing real-* entries first). Coach scores entered for a real
  // game thus drive pool standings without a separate import step.
  // Saved manual pool entries with non-real ids are untouched.
  const normalizedPool = normalizePoolPlay(tournament.poolPlay);
  const localMerged = normalizedPool
    ? mergeRealGamesIntoPool(normalizedPool, games, settings?.teamName ?? null)
    : null;
  // Layer network games on top of local games. If this tournament is
  // in a network, every other member's scored real game vs a pool
  // team becomes a `network-<userId>-<gameId>` synthetic entry. Same
  // idempotency rules as real-* — replaced on every read.
  const livePool = localMerged
    ? await mergeNetworkGamesIntoPool(localMerged, tournament.id)
    : null;
  const poolPlayAnalysis = livePool
    ? simulatePoolPlay(livePool)
    : null;

  res.json({
    ...tournament,
    games,
    pitcherAvailability,
    gameSuggestions,
    effectiveDailyMax,
    effectiveTournamentMax,
    effectiveRestTiers,
    // Send the live-merged pool back so the client's games table
    // reflects rows synced from the real schedule. The saved DB row
    // only contains coach-entered games; real-* rows are re-derived
    // on every GET.
    poolPlay: livePool ?? tournament.poolPlay ?? null,
    poolPlayAnalysis,
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
  if (d.dailyPitchMax !== undefined) updates.dailyPitchMax = d.dailyPitchMax;
  if (d.tournamentPitchMax !== undefined)
    updates.tournamentPitchMax = d.tournamentPitchMax;
  if (d.restTiers !== undefined) updates.restTiers = d.restTiers;
  if (d.poolPlayNoNewInningMinutes !== undefined)
    updates.poolPlayNoNewInningMinutes = d.poolPlayNoNewInningMinutes;
  if (d.poolPlayHardStopMinutes !== undefined)
    updates.poolPlayHardStopMinutes = d.poolPlayHardStopMinutes;
  if (d.bracketNoNewInningMinutes !== undefined)
    updates.bracketNoNewInningMinutes = d.bracketNoNewInningMinutes;
  if (d.bracketHardStopMinutes !== undefined)
    updates.bracketHardStopMinutes = d.bracketHardStopMinutes;

  // If name or dates changed, recompute the network fingerprint.
  // We need the current row to fill in the unchanged side of the
  // (name, start, end) triple. Cheap one-row lookup.
  if (d.name !== undefined || d.startDate !== undefined || d.endDate !== undefined) {
    const [current] = await db
      .select({
        name: tournamentsTable.name,
        startDate: tournamentsTable.startDate,
        endDate: tournamentsTable.endDate,
      })
      .from(tournamentsTable)
      .where(
        and(
          eq(tournamentsTable.id, params.data.id),
          eq(tournamentsTable.userId, userId),
        ),
      );
    if (current) {
      const nextName = d.name ?? current.name;
      const nextStart = d.startDate ? new Date(d.startDate) : current.startDate;
      const nextEnd = d.endDate ? new Date(d.endDate) : current.endDate;
      const fp = computeTournamentFingerprint(nextName, nextStart, nextEnd);
      updates.networkFingerprint = fp || null;
    }
  }

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

// Soft delete — sets `deletedAt`. Unlike the previous hard delete, we
// LEAVE `games.tournamentId` pointing at the tournament so a restore
// brings the linkage back automatically. The read sites that surface
// tournament-linked games already filter `deletedAt IS NULL` on the
// tournament side, so the linked games don't render as part of a
// trashed tournament.
router.delete("/tournaments/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = DeleteTournamentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [tournament] = await db
    .update(tournamentsTable)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(tournamentsTable.id, params.data.id),
        eq(tournamentsTable.userId, userId),
        isNull(tournamentsTable.deletedAt),
      ),
    )
    .returning();
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  res.status(204).end();
});

// Restore — clears `deletedAt`. The original tournament linkage on
// games is preserved through the soft-delete cycle.
router.post("/tournaments/:id/restore", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = DeleteTournamentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [tournament] = await db
    .update(tournamentsTable)
    .set({ deletedAt: null })
    .where(
      and(
        eq(tournamentsTable.id, params.data.id),
        eq(tournamentsTable.userId, userId),
      ),
    )
    .returning();
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  res.json(tournament);
});

export default router;
