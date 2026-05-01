import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, gamesTable, playersTable, lineupLocksTable } from "@workspace/db";
import { FIELD_POSITIONS } from "../lib/lineup-generator";

const router: IRouter = Router();

const VALID_POSITIONS = [...FIELD_POSITIONS, "Bench"] as const;
const PositionEnum = z.enum(VALID_POSITIONS);

const ListParams = z.object({ id: z.coerce.number().int().positive() });
const DeleteParams = z.object({
  id: z.coerce.number().int().positive(),
  lockId: z.coerce.number().int().positive(),
});

// `inning` may be a single number or null (= apply to every inning of the game).
const CreateBody = z.object({
  playerId: z.number().int().positive(),
  position: PositionEnum,
  inning: z.number().int().min(1).max(20).nullable(),
});

router.get("/games/:id/locks", async (req, res): Promise<void> => {
  const params = ListParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }
  const rows = await db
    .select({
      id: lineupLocksTable.id,
      gameId: lineupLocksTable.gameId,
      playerId: lineupLocksTable.playerId,
      playerName: playersTable.name,
      inning: lineupLocksTable.inning,
      position: lineupLocksTable.position,
      createdAt: lineupLocksTable.createdAt,
    })
    .from(lineupLocksTable)
    .innerJoin(playersTable, eq(lineupLocksTable.playerId, playersTable.id))
    .where(eq(lineupLocksTable.gameId, params.data.id))
    .orderBy(lineupLocksTable.inning, lineupLocksTable.id);
  res.json(rows);
});

router.post("/games/:id/locks", async (req, res): Promise<void> => {
  const params = ListParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }
  const body = CreateBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.errors[0]?.message ?? "Invalid body" });
    return;
  }

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, params.data.id));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, body.data.playerId));
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  if (!player.active) {
    res.status(400).json({ error: `${player.name} is not on the active roster.` });
    return;
  }

  // Validate position eligibility for the player (Bench is always allowed).
  if (body.data.position !== "Bench") {
    const eligible = (player.eligiblePositions ?? []) as string[];
    if (!eligible.includes(body.data.position)) {
      res.status(400).json({
        error: `${player.name} isn't eligible at ${body.data.position}. Adjust eligible positions on the Roster page first.`,
      });
      return;
    }
  }

  // Determine which innings to lock. `inning: null` expands to every inning
  // of the game; a specific inning must be in range.
  const innings: number[] = body.data.inning == null
    ? Array.from({ length: game.innings }, (_, i) => i + 1)
    : (() => {
        if (body.data.inning! < 1 || body.data.inning! > game.innings) return [];
        return [body.data.inning!];
      })();

  if (innings.length === 0) {
    res.status(400).json({ error: `Inning must be between 1 and ${game.innings}.` });
    return;
  }

  // Conflicts we want to surface with friendly messages:
  //   1. Same player already locked in this inning (any position).
  //   2. Same non-Bench field position already locked to a different player.
  // We do the check in a transaction along with the insert so a concurrent
  // writer can't slip in between, AND we keep DB unique indexes
  // (lineup_locks_game_player_inning_unique +
  //  lineup_locks_game_inning_position_unique) as a hard backstop. If a
  // race wins the index race, we map the Postgres unique-violation error
  // (SQLSTATE 23505) to the same 409 response.
  try {
    const { inserted, locks } = await db.transaction(async (tx) => {
      const existing = await tx
        .select({
          id: lineupLocksTable.id,
          playerId: lineupLocksTable.playerId,
          playerName: playersTable.name,
          inning: lineupLocksTable.inning,
          position: lineupLocksTable.position,
        })
        .from(lineupLocksTable)
        .innerJoin(playersTable, eq(lineupLocksTable.playerId, playersTable.id))
        .where(eq(lineupLocksTable.gameId, params.data.id));

      const conflicts: string[] = [];
      for (const inn of innings) {
        for (const e of existing) {
          if (e.inning !== inn) continue;
          if (e.playerId === body.data.playerId) {
            conflicts.push(
              `${player.name} is already locked at ${e.position} in inning ${inn}. Remove that lock first.`,
            );
          } else if (e.position === body.data.position && body.data.position !== "Bench") {
            conflicts.push(
              `${e.playerName} is already locked at ${body.data.position} in inning ${inn}. Only one player can hold a field position per inning.`,
            );
          }
        }
      }
      if (conflicts.length > 0) {
        // Throw a typed marker so the outer catch can return 409 cleanly.
        throw new LockConflictError(conflicts);
      }

      const insertedRows = await tx
        .insert(lineupLocksTable)
        .values(
          innings.map((inn) => ({
            gameId: params.data.id,
            playerId: body.data.playerId,
            position: body.data.position,
            inning: inn,
          })),
        )
        .returning();

      const outRows = await tx
        .select({
          id: lineupLocksTable.id,
          gameId: lineupLocksTable.gameId,
          playerId: lineupLocksTable.playerId,
          playerName: playersTable.name,
          inning: lineupLocksTable.inning,
          position: lineupLocksTable.position,
          createdAt: lineupLocksTable.createdAt,
        })
        .from(lineupLocksTable)
        .innerJoin(playersTable, eq(lineupLocksTable.playerId, playersTable.id))
        .where(
          and(
            eq(lineupLocksTable.gameId, params.data.id),
            eq(lineupLocksTable.playerId, body.data.playerId),
          ),
        );

      return { inserted: insertedRows, locks: outRows };
    });

    res.status(201).json({ created: inserted.length, locks });
  } catch (e: unknown) {
    if (e instanceof LockConflictError) {
      res.status(409).json({ error: e.conflicts[0], conflicts: e.conflicts });
      return;
    }
    // Postgres unique violation from the race-protection indexes.
    const code = (e as { code?: string } | null)?.code;
    if (code === "23505") {
      res.status(409).json({
        error: "Another lock for the same player or position was just created. Refresh and try again.",
      });
      return;
    }
    throw e;
  }
});

class LockConflictError extends Error {
  constructor(public conflicts: string[]) {
    super(conflicts[0]);
    this.name = "LockConflictError";
  }
}

router.delete("/games/:id/locks/:lockId", async (req, res): Promise<void> => {
  const params = DeleteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const result = await db
    .delete(lineupLocksTable)
    .where(
      and(
        eq(lineupLocksTable.id, params.data.lockId),
        eq(lineupLocksTable.gameId, params.data.id),
      ),
    )
    .returning();
  if (result.length === 0) {
    res.status(404).json({ error: "Lock not found" });
    return;
  }
  res.status(204).end();
});

// Convenience: bulk delete all locks for a game.
router.delete("/games/:id/locks", async (req, res): Promise<void> => {
  const params = ListParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }
  const result = await db
    .delete(lineupLocksTable)
    .where(eq(lineupLocksTable.gameId, params.data.id))
    .returning();
  res.json({ deleted: result.length });
});

export default router;
