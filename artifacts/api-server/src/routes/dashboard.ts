import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  gamesTable,
  pitchCountsTable,
  taskDismissalsTable,
  teamSettingsTable,
  tournamentsTable,
  tournamentNetworkMembersTable,
} from "@workspace/db";
import { DismissDashboardTaskBody } from "@workspace/api-zod";

const router: IRouter = Router();
router.use("/dashboard", gateWrites("partial"));

const MAX_TASKS = 20;

/**
 * Derived dashboard task list. Two task kinds today, both surfaced as
 * "you forgot to log X for game Y":
 *
 *   - "score": a game whose scheduled date is in the past but the coach
 *     never recorded a final score (status != "cancelled" + scores null).
 *     Past-dated upcoming games count, plus completed games that
 *     somehow ended up with null scores.
 *   - "pitch_counts": a tournament-linked game in the past with zero
 *     pitch_counts rows. We don't nag for non-tournament games because
 *     pitch counts are optional unless they roll up across a tournament.
 *   - "box_score": a past, non-cancelled game with no GameChanger box
 *     score imported (`boxScoreImportedAt IS NULL`). Only surfaced when
 *     the team has flipped `team_settings.usesGameChanger=true` so
 *     coaches who don't use GameChanger aren't nagged.
 *
 * Sorted by gameDate DESC and capped at MAX_TASKS so the card stays
 * scannable even after a long season.
 */
router.get("/dashboard/tasks", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const now = new Date();

  // Past-dated games of type "game" that aren't cancelled. The two
  // task derivations both filter from this set.
  const pastGames = await db
    .select({
      id: gamesTable.id,
      opponent: gamesTable.opponent,
      gameDate: gamesTable.gameDate,
      status: gamesTable.status,
      ourScore: gamesTable.ourScore,
      opponentScore: gamesTable.opponentScore,
      tournamentId: gamesTable.tournamentId,
      boxScoreImportedAt: gamesTable.boxScoreImportedAt,
    })
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.userId, userId),
        isNull(gamesTable.deletedAt),
        eq(gamesTable.type, "game"),
        lt(gamesTable.gameDate, now),
      ),
    )
    .orderBy(desc(gamesTable.gameDate));

  if (pastGames.length === 0) {
    res.json([]);
    return;
  }

  const gameIds = pastGames.map((g) => g.id);

  // Pitch counts grouped by gameId. A game with zero rows produces a
  // pitch_counts task (only for tournament-linked games).
  const pitchRows = await db
    .select({
      gameId: pitchCountsTable.gameId,
      n: sql<number>`count(*)::int`,
    })
    .from(pitchCountsTable)
    .where(
      and(
        eq(pitchCountsTable.userId, userId),
        inArray(pitchCountsTable.gameId, gameIds),
      ),
    )
    .groupBy(pitchCountsTable.gameId);
  const pitchCountByGame = new Map(pitchRows.map((r) => [r.gameId, r.n]));

  // Whether this team has opted-in to GameChanger box-score reminders.
  // Lazy team_settings rows mean missing row = false (default).
  //
  // Smart auto-detect: even if the explicit toggle is off, if the team has
  // EVER imported a box score for any game, we treat the feature as
  // implicitly enabled and keep nudging them on the games they haven't
  // gotten to yet. Coaches who try it once but don't want to be nagged
  // can flip the explicit toggle off in Settings → Defaults to suppress.
  // Conversely, brand-new teams that flip the toggle ON in Settings see
  // the reminders right away (no past imports needed).
  const [settings] = await db
    .select({ usesGameChanger: teamSettingsTable.usesGameChanger })
    .from(teamSettingsTable)
    .where(eq(teamSettingsTable.userId, userId));
  // The column is a non-nullable boolean defaulting to false, so we can't
  // distinguish "explicitly turned off" from "never touched the toggle".
  // We treat the feature as on whenever EITHER the toggle is on OR the
  // team has ever imported a box score. Coaches who decide to stop using
  // GameChanger after importing a few games can dismiss the outstanding
  // tasks one-by-one — the dismissals are permanent, so no new nags.
  const explicitlyOn = settings?.usesGameChanger ?? false;
  const hasEverImportedBoxScore = pastGames.some(
    (g) => g.boxScoreImportedAt != null,
  );
  const usesGameChanger = explicitlyOn || hasEverImportedBoxScore;

  // Existing dismissals — keyed by `${gameId}:${taskType}` for cheap lookup.
  const dismissed = await db
    .select({
      gameId: taskDismissalsTable.gameId,
      taskType: taskDismissalsTable.taskType,
    })
    .from(taskDismissalsTable)
    .where(
      and(
        eq(taskDismissalsTable.userId, userId),
        inArray(taskDismissalsTable.gameId, gameIds),
      ),
    );
  const dismissedSet = new Set(dismissed.map((d) => `${d.gameId}:${d.taskType}`));

  type Task = {
    id: string;
    type: "score" | "pitch_counts" | "box_score" | "tournament_network";
    // Game tasks set gameId; tournament tasks set tournamentId. Exactly
    // one is populated per row (the client renders + dismisses based on
    // `type`, so the foreign-key column is purely informational).
    gameId: number | null;
    tournamentId: number | null;
    gameDate: string;
    opponent: string;
    link: string;
  };
  const tasks: Task[] = [];

  for (const g of pastGames) {
    if (g.status === "cancelled") continue;

    // Score task: any past game where at least one side's score is null.
    // Treat both nulls as the canonical "didn't bother to score it" case;
    // a single-side null is also worth flagging (probably a typo).
    if (g.ourScore == null || g.opponentScore == null) {
      const key = `${g.id}:score`;
      if (!dismissedSet.has(key)) {
        tasks.push({
          id: key,
          type: "score",
          gameId: g.id,
          tournamentId: null,
          gameDate: g.gameDate.toISOString(),
          opponent: g.opponent,
          link: `/games/${g.id}`,
        });
      }
    }

    // Box-score task: only surface when the team has GameChanger
    // import enabled. Use boxScoreImportedAt as the canonical "this
    // game has been imported" flag — DELETE box-score clears it.
    if (usesGameChanger && g.boxScoreImportedAt == null) {
      const key = `${g.id}:box_score`;
      if (!dismissedSet.has(key)) {
        tasks.push({
          id: key,
          type: "box_score",
          gameId: g.id,
          tournamentId: null,
          gameDate: g.gameDate.toISOString(),
          opponent: g.opponent,
          link: `/games/${g.id}#box-score-card`,
        });
      }
    }

    // Pitch-counts task: tournament-linked game with zero recorded counts.
    if (g.tournamentId != null && (pitchCountByGame.get(g.id) ?? 0) === 0) {
      const key = `${g.id}:pitch_counts`;
      if (!dismissedSet.has(key)) {
        tasks.push({
          id: key,
          type: "pitch_counts",
          gameId: g.id,
          tournamentId: null,
          gameDate: g.gameDate.toISOString(),
          opponent: g.opponent,
          // Anchor takes the coach straight to the pitch-counts card on
          // the game detail page so they don't have to hunt for it.
          link: `/games/${g.id}#pitch-counts-card`,
        });
      }
    }

    if (tasks.length >= MAX_TASKS) break;
  }

  // Tournament-network suggestion tasks. We surface ONE task per
  // tournament owned by this coach that:
  //   - has a fingerprint
  //   - hasn't been dismissed (`networkPromptDismissedAt IS NULL`)
  //   - isn't already in a network (no membership row)
  //   - has at least one OTHER coach's tournament with the same
  //     fingerprint to actually join
  // Dismissal lives on the tournament row itself (the network card's
  // X button), so we don't go through `task_dismissals` here. The
  // client routes "Ignore" through POST /tournaments/:id/network/dismiss.
  if (tasks.length < MAX_TASKS) {
    const myCandidates = await db
      .select({
        id: tournamentsTable.id,
        name: tournamentsTable.name,
        startDate: tournamentsTable.startDate,
        fingerprint: tournamentsTable.networkFingerprint,
      })
      .from(tournamentsTable)
      .leftJoin(
        tournamentNetworkMembersTable,
        eq(tournamentNetworkMembersTable.tournamentId, tournamentsTable.id),
      )
      .where(
        and(
          eq(tournamentsTable.userId, userId),
          isNull(tournamentsTable.deletedAt),
          isNull(tournamentsTable.networkPromptDismissedAt),
          isNull(tournamentNetworkMembersTable.id),
          sql`${tournamentsTable.networkFingerprint} is not null`,
        ),
      )
      .orderBy(desc(tournamentsTable.startDate));

    if (myCandidates.length > 0) {
      // Find which fingerprints have at least one matching tournament
      // owned by a DIFFERENT coach. Do it in one query and bucket by
      // fingerprint client-side so we avoid an N+1.
      const fps = myCandidates
        .map((t) => t.fingerprint)
        .filter((f): f is string => !!f);
      const matchRows = await db
        .select({ fingerprint: tournamentsTable.networkFingerprint })
        .from(tournamentsTable)
        .where(
          and(
            inArray(tournamentsTable.networkFingerprint, fps),
            isNull(tournamentsTable.deletedAt),
            // Only count OTHER coaches' tournaments — joining our own
            // wouldn't be a network.
            sql`${tournamentsTable.userId} <> ${userId}`,
          ),
        );
      const fpsWithPeers = new Set(
        matchRows.map((r) => r.fingerprint).filter((f): f is string => !!f),
      );

      for (const t of myCandidates) {
        if (!t.fingerprint || !fpsWithPeers.has(t.fingerprint)) continue;
        const key = `${t.id}:tournament_network`;
        tasks.push({
          id: key,
          type: "tournament_network",
          gameId: null,
          tournamentId: t.id,
          gameDate: t.startDate.toISOString(),
          // Re-use `opponent` as the display label so the existing
          // task row layout works without a schema fork — the client
          // renders this as the tournament name (it's not actually an
          // opponent).
          opponent: t.name,
          link: `/tournaments/${t.id}`,
        });
        if (tasks.length >= MAX_TASKS) break;
      }
    }
  }

  res.json(tasks.slice(0, MAX_TASKS));
});

router.post("/dashboard/tasks/dismiss", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = DismissDashboardTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Ownership check — never let a coach dismiss tasks against games
  // they don't own (the FK is the only guard otherwise).
  const [game] = await db
    .select({ id: gamesTable.id })
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.id, parsed.data.gameId),
        eq(gamesTable.userId, userId),
        isNull(gamesTable.deletedAt),
      ),
    );
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  await db
    .insert(taskDismissalsTable)
    .values({
      userId,
      gameId: parsed.data.gameId,
      taskType: parsed.data.taskType,
    })
    .onConflictDoNothing({
      target: [
        taskDismissalsTable.userId,
        taskDismissalsTable.gameId,
        taskDismissalsTable.taskType,
      ],
    });
  res.status(204).end();
});

export default router;

// Silence linter — `or` and `isNull` are imported for completeness but
// the current task derivations don't need them. Keeping the import
// stable as the task list grows.
void or;
void isNull;
