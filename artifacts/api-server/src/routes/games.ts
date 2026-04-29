import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, gamesTable } from "@workspace/db";
import {
  CreateGameBody,
  GetGameParams,
  UpdateGameParams,
  UpdateGameBody,
  DeleteGameParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/games", async (_req, res): Promise<void> => {
  const games = await db.select().from(gamesTable).orderBy(gamesTable.gameDate);
  res.json(games);
});

router.post("/games", async (req, res): Promise<void> => {
  const parsed = CreateGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const [game] = await db
    .insert(gamesTable)
    .values({
      opponent: d.opponent,
      gameDate: d.gameDate,
      location: d.location ?? null,
      innings: d.innings,
      status: "upcoming",
      notes: d.notes ?? null,
    })
    .returning();
  res.status(201).json(game);
});

router.get("/games/:id", async (req, res): Promise<void> => {
  const params = GetGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [game] = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.id, params.data.id));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(game);
});

router.patch("/games/:id", async (req, res): Promise<void> => {
  const params = UpdateGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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
  if (d.notes !== undefined) updates.notes = d.notes;

  const [game] = await db
    .update(gamesTable)
    .set(updates)
    .where(eq(gamesTable.id, params.data.id))
    .returning();
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(game);
});

router.delete("/games/:id", async (req, res): Promise<void> => {
  const params = DeleteGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [game] = await db
    .delete(gamesTable)
    .where(eq(gamesTable.id, params.data.id))
    .returning();
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
