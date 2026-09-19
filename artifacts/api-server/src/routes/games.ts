import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import {
  parseIfMatch,
  rejectBadIfMatch,
  sendConflict,
  versionedUpdate,
} from "../lib/concurrency";
import { idempotent } from "../middlewares/idempotency";
import { and, eq, gt, isNull, sql, desc } from "drizzle-orm";
import {
  db,
  gamesTable,
  lineupEntriesTable,
  lineupLocksTable,
  aiPinnedAssignmentsTable,
  playersTable,
  tournamentsTable,
} from "@workspace/db";
import type { PlanSnapshotEntry } from "@workspace/db";
import {
  CreateGameBody,
  GetGameParams,
  UpdateGameParams,
  UpdateGameBody,
  DeleteGameParams,
} from "@workspace/api-zod";

const router: IRouter = Router();
router.use("/games", gateWrites("partial"));

router.get("/games", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const games = await db
    .select()
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, userId), isNull(gamesTable.deletedAt)))
    .orderBy(gamesTable.gameDate);
  res.json(games);
});

// Games that have at least one saved lineup entry. Used by the
// "Copy from previous" picker on the game-detail page so a coach can start
// a new lineup from a past game's positions. Must be defined BEFORE
// "/games/:id" so it is not shadowed by the parametric route.
router.get("/games/with-lineups", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const rows = await db
    .select({
      id: gamesTable.id,
      opponent: gamesTable.opponent,
      gameDate: gamesTable.gameDate,
      innings: gamesTable.innings,
      status: gamesTable.status,
      entryCount: sql<number>`count(${lineupEntriesTable.id})::int`,
    })
    .from(gamesTable)
    .innerJoin(lineupEntriesTable, eq(lineupEntriesTable.gameId, gamesTable.id))
    .where(and(eq(gamesTable.userId, userId), isNull(gamesTable.deletedAt)))
    .groupBy(gamesTable.id)
    .orderBy(desc(gamesTable.gameDate));
  res.json(rows);
});

router.post("/games", idempotent("createGame"), async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = CreateGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;

  const [game] = await db
    .insert(gamesTable)
    .values({
      userId,
      opponent: d.opponent,
      gameDate: d.gameDate,
      location: d.location ?? null,
      innings: d.innings,
      status: "upcoming",
      notes: d.notes ?? null,
      gameType: d.gameType ?? null,
      competitiveness: d.competitiveness ?? null,
      tournamentId: d.tournamentId ?? null,
      // Tournament games default to pool play; coach switches to bracket
      // from the game-edit dialog once bracket play begins. Non-tournament
      // games stay null.
      bracketStage:
        d.tournamentId != null && d.gameType === "tournament" ? "pool" : null,
    })
    .returning();
  res.status(201).json(game);
});

router.get("/games/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = GetGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [game] = await db
    .select()
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.id, params.data.id),
        eq(gamesTable.userId, userId),
        isNull(gamesTable.deletedAt),
      ),
    );
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  // Resolve effective time-limit rules from the parent tournament (if any).
  // Field Display reads `effectiveTimeLimits` directly so it doesn't have to
  // re-fetch the tournament on every poll. Stage defaults to "pool" when not
  // yet set so legacy tournament games still get pool-play rules.
  let effectiveTimeLimits:
    | { noNewInningMinutes: number | null; hardStopMinutes: number | null }
    | null = null;
  if (game.tournamentId != null) {
    const [tournament] = await db
      .select({
        poolPlayNoNewInningMinutes: tournamentsTable.poolPlayNoNewInningMinutes,
        poolPlayHardStopMinutes: tournamentsTable.poolPlayHardStopMinutes,
        bracketNoNewInningMinutes: tournamentsTable.bracketNoNewInningMinutes,
        bracketHardStopMinutes: tournamentsTable.bracketHardStopMinutes,
      })
      .from(tournamentsTable)
      .where(
        and(
          eq(tournamentsTable.id, game.tournamentId),
          eq(tournamentsTable.userId, userId),
          isNull(tournamentsTable.deletedAt),
        ),
      );
    if (tournament) {
      const stage = game.bracketStage === "bracket" ? "bracket" : "pool";
      const noNew =
        stage === "bracket"
          ? tournament.bracketNoNewInningMinutes
          : tournament.poolPlayNoNewInningMinutes;
      const hard =
        stage === "bracket"
          ? tournament.bracketHardStopMinutes
          : tournament.poolPlayHardStopMinutes;
      // Only emit the object when at least one rule is set — otherwise null
      // signals "no enforcement" to the client and keeps the timer chip in
      // its neutral state.
      if (noNew != null || hard != null) {
        effectiveTimeLimits = {
          noNewInningMinutes: noNew ?? null,
          hardStopMinutes: hard ?? null,
        };
      }
    }
  }
  res.json({ ...game, effectiveTimeLimits });
});

router.patch("/games/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = UpdateGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ifm = parseIfMatch(req);
  if (!ifm.ok) {
    rejectBadIfMatch(res);
    return;
  }
  const parsed = UpdateGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.opponent !== undefined) updates.opponent = d.opponent;
  if (d.gameDate !== undefined) updates.gameDate = d.gameDate;
  if (d.location !== undefined) updates.location = d.location;
  if (d.innings !== undefined) updates.innings = d.innings;
  if (d.status !== undefined) updates.status = d.status;
  if (d.ourScore !== undefined) updates.ourScore = d.ourScore;
  if (d.opponentScore !== undefined) updates.opponentScore = d.opponentScore;
  if (d.startedAt !== undefined) {
    // Convert ISO string → Date for Drizzle's timestamp column (avoid
    // any driver-level surprises around string-vs-Date coercion). Null
    // is a valid value too — used by the field-display "Reset timer"
    // affordance to clear a mistaken first-pitch timestamp.
    updates.startedAt = d.startedAt === null ? null : new Date(d.startedAt);
  }
  if (d.notes !== undefined) updates.notes = d.notes;
  if (d.gameType !== undefined) updates.gameType = d.gameType;
  if (d.competitiveness !== undefined) updates.competitiveness = d.competitiveness;
  if (d.tournamentId !== undefined) updates.tournamentId = d.tournamentId;
  if (d.bracketStage !== undefined) updates.bracketStage = d.bracketStage;
  if (d.isChampionship !== undefined) updates.isChampionship = d.isChampionship;
  // Semantic guard: bracketStage is only meaningful on tournament-linked
  // games (tournamentId != null AND gameType="tournament"). The Edit Game
  // dialog already hides the selector outside that combo, but the API
  // could still receive an out-of-band PATCH (stale client, scripted
  // request) that leaves the row in an inconsistent state. Reject early.
  // Tournament POST handles this implicitly by computing the default
  // server-side, so this guard only needs to cover PATCH.

  // If the coach is shrinking the game's innings (e.g. they hit the 10-run
  // rule and ended early), drop any lineup data that would now point past the
  // new last inning so it doesn't ghost in tallies / reappear if they grow
  // the game later. We do the read-then-update-then-cleanup in a transaction
  // so a partial failure can't leave entries pointing to a non-existent
  // inning. Ownership is enforced inside the same transaction.
  const game = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(gamesTable)
      .where(
        and(
          eq(gamesTable.id, params.data.id),
          eq(gamesTable.userId, userId),
          isNull(gamesTable.deletedAt),
        ),
      );
    if (!existing) return null;

    // Resolve POST-update tournamentId + gameType to enforce the
    // bracketStage semantic guard (see comment above the updates map).
    const nextTournamentId =
      d.tournamentId !== undefined ? d.tournamentId : existing.tournamentId;
    const nextGameType =
      d.gameType !== undefined ? d.gameType : existing.gameType;
    const nextBracketStage =
      d.bracketStage !== undefined ? d.bracketStage : existing.bracketStage;
    if (
      nextBracketStage != null &&
      !(nextTournamentId != null && nextGameType === "tournament")
    ) {
      return "INVALID_BRACKET_STAGE" as const;
    }

    // Semantic guard: a game can only be flagged as the championship when
    // it's a tournament game — Championship Mode on the Field Display is
    // gated on gameType="tournament", so flagging a league/unspecified
    // game would be a no-op that confuses later reads. Reject so the row
    // stays consistent even if an out-of-band PATCH tries it.
    const nextIsChampionship =
      d.isChampionship !== undefined
        ? d.isChampionship
        : existing.isChampionship;
    if (nextIsChampionship && nextGameType !== "tournament") {
      return "INVALID_CHAMPIONSHIP" as const;
    }

    // Optimistic-concurrency check: when the client pinned a version
    // (offline-queued edit), refuse to clobber a row another device
    // changed in the meantime. `existing` was read inside this same
    // transaction, so the compare-then-update is race-free.
    if (ifm.version != null && existing.rowVersion !== ifm.version) {
      return { conflict: existing } as const;
    }

    const [updated] = await tx
      .update(gamesTable)
      .set({ ...updates, rowVersion: sql`${gamesTable.rowVersion} + 1` })
      .where(
        and(
          eq(gamesTable.id, params.data.id),
          eq(gamesTable.userId, userId),
          isNull(gamesTable.deletedAt),
        ),
      )
      .returning();
    if (!updated) return null;

    if (d.innings !== undefined && d.innings < existing.innings) {
      await tx
        .delete(lineupEntriesTable)
        .where(
          and(
            eq(lineupEntriesTable.gameId, params.data.id),
            gt(lineupEntriesTable.inning, d.innings),
          ),
        );
      await tx
        .delete(lineupLocksTable)
        .where(
          and(
            eq(lineupLocksTable.gameId, params.data.id),
            gt(lineupLocksTable.inning, d.innings),
          ),
        );
      await tx
        .delete(aiPinnedAssignmentsTable)
        .where(
          and(
            eq(aiPinnedAssignmentsTable.gameId, params.data.id),
            gt(aiPinnedAssignmentsTable.inning, d.innings),
          ),
        );
    }
    return updated;
  });

  if (game === "INVALID_BRACKET_STAGE") {
    res.status(400).json({
      error: "bracketStage can only be set on tournament-linked games",
    });
    return;
  }
  if (game === "INVALID_CHAMPIONSHIP") {
    res.status(400).json({
      error: "isChampionship can only be set on tournament games",
    });
    return;
  }
  if (game != null && typeof game === "object" && "conflict" in game) {
    sendConflict(res, game.conflict);
    return;
  }
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(game);
});

// Snapshot the currently-saved lineup into games.plan_snapshot. Used by the
// mobile photo-override flow when the coach picks "Keep original as plan"
// before replacing the lineup with what actually happened in the game.
router.post("/games/:id/snapshot-plan", idempotent("snapshotPlan"), async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = GetGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Verify ownership before reading lineup_entries.
  const [game] = await db
    .select()
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.id, params.data.id),
        eq(gamesTable.userId, userId),
        isNull(gamesTable.deletedAt),
      ),
    );
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  // Pull the saved lineup with player names, in a stable order so the snapshot
  // round-trips deterministically.
  const rows = await db
    .select({
      playerId: lineupEntriesTable.playerId,
      playerName: playersTable.name,
      inning: lineupEntriesTable.inning,
      position: lineupEntriesTable.position,
      battingOrder: lineupEntriesTable.battingOrder,
    })
    .from(lineupEntriesTable)
    .innerJoin(playersTable, eq(playersTable.id, lineupEntriesTable.playerId))
    .where(eq(lineupEntriesTable.gameId, params.data.id))
    .orderBy(lineupEntriesTable.inning, lineupEntriesTable.position);
  const snapshot: PlanSnapshotEntry[] = rows.map((r) => ({
    playerId: r.playerId,
    playerName: r.playerName,
    inning: r.inning,
    position: r.position,
    battingOrder: r.battingOrder,
  }));
  if (snapshot.length === 0) {
    res.status(409).json({ error: "No lineup to snapshot" });
    return;
  }
  const [updated] = await db
    .update(gamesTable)
    .set({ planSnapshot: snapshot, rowVersion: sql`${gamesTable.rowVersion} + 1` })
    .where(and(eq(gamesTable.id, params.data.id), eq(gamesTable.userId, userId)))
    .returning();
  res.json(updated);
});

// Clear the snapshot — used if the coach decides they don't want to keep the
// plan after all (e.g. they accidentally chose "Keep both").
router.delete("/games/:id/snapshot-plan", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = GetGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [updated] = await db
    .update(gamesTable)
    .set({ planSnapshot: null, rowVersion: sql`${gamesTable.rowVersion} + 1` })
    .where(and(eq(gamesTable.id, params.data.id), eq(gamesTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(updated);
});

// Soft delete — sets `deletedAt` so the coach can hit Undo from the
// toast. Cascaded children (lineup_entries, locks, pitch_counts,
// game_batting_lines, ai_pinned_assignments) stay intact and reappear
// on restore. 204 response shape preserved for backwards compat.
router.delete("/games/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = DeleteGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ifm = parseIfMatch(req);
  if (!ifm.ok) {
    rejectBadIfMatch(res);
    return;
  }
  const result = await versionedUpdate(db, gamesTable, {
    set: { deletedAt: new Date() },
    where: and(
      eq(gamesTable.id, params.data.id),
      eq(gamesTable.userId, userId),
      isNull(gamesTable.deletedAt),
    ),
    ifMatch: ifm.version,
  });
  if (result.kind === "conflict") {
    sendConflict(res, result.current);
    return;
  }
  if (result.kind === "missing") {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.sendStatus(204);
});

// Restore — clears `deletedAt`. Looks up without the deletedAt filter
// so we can find the row we just trashed.
router.post("/games/:id/restore", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = DeleteGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [game] = await db
    .update(gamesTable)
    .set({ deletedAt: null, rowVersion: sql`${gamesTable.rowVersion} + 1` })
    .where(
      and(eq(gamesTable.id, params.data.id), eq(gamesTable.userId, userId)),
    )
    .returning();
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(game);
});

export default router;
