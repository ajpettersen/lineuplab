import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  pitchCountsTable,
  gamesTable,
  playersTable,
} from "@workspace/db";
import {
  GetGamePitchCountsParams,
  UpsertGamePitchCountParams,
  UpsertGamePitchCountBody,
  DeleteGamePitchCountParams,
} from "@workspace/api-zod";

const router: IRouter = Router();
router.use("/games", gateWrites("partial"));

/**
 * Verify a game belongs to the calling coach. Returns the gameId on
 * success, or sends a 404 and returns null on failure. Centralized
 * because every route below needs the same ownership gate.
 */
async function ensureGameOwned(
  userId: string,
  gameId: number,
): Promise<number | null> {
  const [game] = await db
    .select({ id: gamesTable.id })
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.id, gameId),
        eq(gamesTable.userId, userId),
        isNull(gamesTable.deletedAt),
      ),
    );
  return game?.id ?? null;
}

router.get("/games/:id/pitch-counts", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = GetGamePitchCountsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ownedId = await ensureGameOwned(userId, params.data.id);
  if (ownedId === null) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const rows = await db
    .select()
    .from(pitchCountsTable)
    .where(
      and(
        eq(pitchCountsTable.userId, userId),
        eq(pitchCountsTable.gameId, ownedId),
      ),
    );
  res.json(rows);
});

router.post("/games/:id/pitch-counts", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = UpsertGamePitchCountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpsertGamePitchCountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownedId = await ensureGameOwned(userId, params.data.id);
  if (ownedId === null) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  // Verify the player belongs to the coach too — no cross-tenant writes.
  const [player] = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(
      and(
        eq(playersTable.id, parsed.data.playerId),
        eq(playersTable.userId, userId),
        isNull(playersTable.deletedAt),
      ),
    );
  if (!player) {
    res.status(400).json({ error: "Player not on this team" });
    return;
  }

  const [row] = await db
    .insert(pitchCountsTable)
    .values({
      userId,
      gameId: ownedId,
      playerId: parsed.data.playerId,
      pitches: parsed.data.pitches,
      notes: parsed.data.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [pitchCountsTable.gameId, pitchCountsTable.playerId],
      set: {
        pitches: parsed.data.pitches,
        notes: parsed.data.notes ?? null,
        recordedAt: new Date(),
      },
    })
    .returning();
  res.json(row);
});

router.delete(
  "/games/:gameId/pitch-counts/:playerId",
  async (req, res): Promise<void> => {
    const userId = req.ownerUserId!;
    const params = DeleteGamePitchCountParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const ownedId = await ensureGameOwned(userId, params.data.gameId);
    if (ownedId === null) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    const result = await db
      .delete(pitchCountsTable)
      .where(
        and(
          eq(pitchCountsTable.userId, userId),
          eq(pitchCountsTable.gameId, ownedId),
          eq(pitchCountsTable.playerId, params.data.playerId),
        ),
      )
      .returning({ id: pitchCountsTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Pitch count not found" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
