import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import { and, eq, sql } from "drizzle-orm";
import { db, pitchCountsTable, playersTable, gamesTable } from "@workspace/db";

const router: IRouter = Router();
router.use("/pitching", gateWrites("partial"));

/**
 * Per-player pitching totals for the season. Aggregated from
 * `pitch_counts` (one row per game+player). Mirrors the read pattern
 * of `getBattingTotals()`: filter to the calling coach's userId,
 * group by player, return rolled-up counts plus identifying info so
 * the UI can render a single-table view without an extra player join.
 *
 * Includes inactive players too — historical pitching shows up even
 * if a kid has been deactivated mid-season.
 */
router.get("/pitching", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;

  const rows = await db
    .select({
      playerId: playersTable.id,
      playerName: playersTable.name,
      playerNumber: playersTable.number,
      totalPitches: sql<number>`coalesce(sum(${pitchCountsTable.pitches}), 0)::int`,
      outings: sql<number>`count(${pitchCountsTable.id})::int`,
      maxOutingPitches: sql<number>`coalesce(max(${pitchCountsTable.pitches}), 0)::int`,
      lastOutingDate: sql<string | null>`max(${gamesTable.gameDate})`,
    })
    .from(playersTable)
    .leftJoin(
      pitchCountsTable,
      and(
        eq(pitchCountsTable.playerId, playersTable.id),
        eq(pitchCountsTable.userId, userId),
      ),
    )
    .leftJoin(gamesTable, eq(gamesTable.id, pitchCountsTable.gameId))
    .where(and(eq(playersTable.userId, userId), eq(playersTable.canPitch, true)))
    .groupBy(playersTable.id, playersTable.name, playersTable.number)
    .orderBy(sql`coalesce(sum(${pitchCountsTable.pitches}), 0) desc`);

  res.json(
    rows.map((r) => ({
      playerId: r.playerId,
      playerName: r.playerName,
      playerNumber: r.playerNumber,
      totalPitches: r.totalPitches,
      outings: r.outings,
      avgPerOuting: r.outings > 0 ? Math.round(r.totalPitches / r.outings) : 0,
      maxOutingPitches: r.maxOutingPitches,
      lastOutingDate: r.lastOutingDate,
    })),
  );
});

export default router;
