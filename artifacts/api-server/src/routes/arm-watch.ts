import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import { and, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import {
  db,
  gamesTable,
  pitchCountsTable,
  playersTable,
  tournamentsTable,
  teamSettingsTable,
  computePitcherAvailability,
  type RestTier,
} from "@workspace/db";

const router: IRouter = Router();
router.use("/arm-watch", gateWrites("partial"));

/**
 * Arm Watch — a single roster-wide view of pitcher availability across
 * the next two weeks of games (league + tournament mixed). For each
 * scheduled game we resolve the *effective* rule set (per-tournament
 * overrides → team defaults → no enforcement), then for every pitcher
 * we evaluate `computePitcherAvailability` as if today were that game's
 * date. The frontend renders the result as a matrix with per-day team
 * totals at the bottom of each column.
 *
 * This endpoint is hand-rolled (not in the OpenAPI spec) — same
 * convention as `/api/batting` and `/api/pitching`. Saves a codegen
 * cycle and keeps the response shape colocated with consumers.
 */
const LOOKAHEAD_DAYS = 14;

type Status = "fresh" | "available" | "limited" | "blocked";

function statusFor(
  pitchesAvailable: number | null,
  hasRecentOuting: boolean,
): Status {
  if (pitchesAvailable === 0) return "blocked";
  if (pitchesAvailable !== null && pitchesAvailable < 25) return "limited";
  if (!hasRecentOuting) return "fresh";
  return "available";
}

router.get("/arm-watch", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + LOOKAHEAD_DAYS);

  const [settings] = await db
    .select()
    .from(teamSettingsTable)
    .where(eq(teamSettingsTable.userId, userId));

  const defaultDailyMax = settings?.defaultDailyPitchMax ?? null;
  const defaultRestTiers: RestTier[] = settings?.defaultRestTiers ?? [];

  // Fetch every upcoming non-cancelled game in the lookahead window,
  // plus every past game in the last 7 days (so rest windows from
  // recent outings carry into upcoming-game projections).
  const recentBack = new Date(now);
  recentBack.setDate(recentBack.getDate() - 7);

  // Bound the window on both ends + filter to actual games (not
  // practices) and exclude cancelled rows so projections are clean.
  const allRelevantGames = await db
    .select()
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.userId, userId),
        isNull(gamesTable.deletedAt),
        eq(gamesTable.type, "game"),
        ne(gamesTable.status, "cancelled"),
        gte(gamesTable.gameDate, recentBack),
        lte(gamesTable.gameDate, horizon),
      ),
    )
    .orderBy(gamesTable.gameDate);

  const upcomingGames = allRelevantGames.filter(
    (g) => new Date(g.gameDate) >= now,
  );

  // Resolve effective rules per upcoming game. Tournament games inherit
  // their tournament's overrides (which themselves fall back to team
  // defaults); league games use team defaults straight.
  const tournamentIds = Array.from(
    new Set(
      upcomingGames
        .map((g) => g.tournamentId)
        .filter((id): id is number => id != null),
    ),
  );
  const tournaments =
    tournamentIds.length === 0
      ? []
      : await db
          .select()
          .from(tournamentsTable)
          .where(
            and(
              eq(tournamentsTable.userId, userId),
              isNull(tournamentsTable.deletedAt),
              inArray(tournamentsTable.id, tournamentIds),
            ),
          );
  const tourById = new Map(tournaments.map((t) => [t.id, t]));

  // Pull every pitch count touching either upcoming games (already-
  // logged pitches for those games — most relevant to "team pitches
  // at this game" + "pitches already recorded for this pitcher") or
  // recent past games (drives rest-tier blocking on upcoming games).
  const allRelevantGameIds = allRelevantGames.map((g) => g.id);
  const counts =
    allRelevantGameIds.length === 0
      ? []
      : await db
          .select()
          .from(pitchCountsTable)
          .where(
            and(
              eq(pitchCountsTable.userId, userId),
              inArray(pitchCountsTable.gameId, allRelevantGameIds),
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
    )
    .orderBy(playersTable.name);

  const gameById = new Map(allRelevantGames.map((g) => [g.id, g]));
  const outingsByPlayer = new Map<
    number,
    { gameId: number; date: Date; pitches: number }[]
  >();
  for (const c of counts) {
    const g = gameById.get(c.gameId);
    if (!g) continue;
    const list = outingsByPlayer.get(c.playerId) ?? [];
    list.push({ gameId: c.gameId, date: g.gameDate, pitches: c.pitches });
    outingsByPlayer.set(c.playerId, list);
  }

  // Per-game team-wide pitch totals (sum of every pitcher's recorded
  // pitches for that game). Renders as the column footer so the coach
  // can see at a glance which games are already planned/logged vs
  // which still need pitchers assigned.
  const teamPitchesByGame = new Map<number, number>();
  for (const c of counts) {
    teamPitchesByGame.set(
      c.gameId,
      (teamPitchesByGame.get(c.gameId) ?? 0) + c.pitches,
    );
  }

  const upcomingGameSummaries = upcomingGames.map((g) => {
    const tour = g.tournamentId != null ? tourById.get(g.tournamentId) : null;
    const effectiveDailyMax =
      tour?.dailyPitchMax ?? defaultDailyMax;
    const effectiveRestTiers: RestTier[] =
      tour?.restTiers ?? defaultRestTiers;
    return {
      id: g.id,
      gameDate: g.gameDate,
      opponent: g.opponent,
      location: g.location,
      gameType: g.gameType,
      tournamentId: g.tournamentId,
      tournamentName: tour?.name ?? null,
      effectiveDailyMax,
      effectiveRestTiers,
      teamPitchesPlanned: teamPitchesByGame.get(g.id) ?? 0,
    };
  });

  const pitcherRows = pitchers.map((p) => {
    const allOutings = outingsByPlayer.get(p.id) ?? [];

    // Recent outings = anything in the last 7 days. Drives the "fresh"
    // badge on the row header.
    const recentOutings = allOutings
      .filter((o) => new Date(o.date) >= recentBack)
      .map((o) => ({
        gameId: o.gameId,
        gameDate: o.date,
        pitches: o.pitches,
      }));

    // Today's status: evaluate availability with `now`. Exclude any
    // future-dated outings so they can't leak into rest windows for
    // dates earlier than them (would be nonsensical: a Friday outing
    // shouldn't block "today is Wednesday").
    const outingsThroughToday = allOutings.filter(
      (o) => new Date(o.date).getTime() <= now.getTime(),
    );
    const todayAvail = computePitcherAvailability({
      dailyMax: defaultDailyMax,
      restTiers: defaultRestTiers.length > 0 ? defaultRestTiers : null,
      outings: outingsThroughToday,
      now,
    });
    const todayPitchesAvailable =
      todayAvail.pitchesAvailableToday === Infinity
        ? null
        : todayAvail.pitchesAvailableToday;
    const todayStatus = statusFor(
      todayPitchesAvailable,
      recentOutings.length > 0,
    );

    // Per-upcoming-game projection: if today were that game's date,
    // what would be available? Outings already logged for THAT same
    // game count toward the daily total (so a partially-pitched game
    // shows reduced remaining capacity).
    const perGame = upcomingGameSummaries.map((g) => {
      // Only outings ON OR BEFORE the projected game's date count toward
      // its rest math — future outings can't retroactively block a past
      // or earlier game. (Same-day outings are still relevant for the
      // daily-cap math, which `computePitcherAvailability` handles.)
      const projectedAt = new Date(g.gameDate);
      const outingsThroughThisGame = allOutings.filter(
        (o) => new Date(o.date).getTime() <= projectedAt.getTime(),
      );
      const avail = computePitcherAvailability({
        dailyMax: g.effectiveDailyMax,
        restTiers:
          g.effectiveRestTiers.length > 0 ? g.effectiveRestTiers : null,
        outings: outingsThroughThisGame,
        now: projectedAt,
      });
      const pitchesAvailable =
        avail.pitchesAvailableToday === Infinity
          ? null
          : avail.pitchesAvailableToday;
      const pitchesAlreadyForThisGame = allOutings
        .filter((o) => o.gameId === g.id)
        .reduce((s, o) => s + o.pitches, 0);
      return {
        gameId: g.id,
        pitchesAlreadyForThisGame,
        pitchesAvailable,
        restingUntil: avail.restingUntil,
        status: statusFor(pitchesAvailable, recentOutings.length > 0),
      };
    });

    return {
      playerId: p.id,
      playerName: p.name,
      playerNumber: p.number,
      recentOutings,
      perGame,
      todayStatus,
      todayPitchesAvailable,
      restingUntilToday: todayAvail.restingUntil,
    };
  });

  res.json({
    defaultDailyMax,
    defaultRestTiers,
    upcomingGames: upcomingGameSummaries,
    pitchers: pitcherRows,
    generatedAt: now.toISOString(),
  });
});

export default router;
