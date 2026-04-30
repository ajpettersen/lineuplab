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
import ical from "node-ical";

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

// Parse iCal URL and return events as game candidates (no DB write)
router.post("/games/import-ical/preview", async (req, res): Promise<void> => {
  const { icalUrl } = req.body;
  if (!icalUrl || typeof icalUrl !== "string") {
    res.status(400).json({ error: "icalUrl required" });
    return;
  }
  try {
    const events = await ical.async.fromURL(icalUrl);
    const games: {
      uid: string;
      summary: string;
      opponent: string;
      gameDate: string;
      location: string | null;
    }[] = [];

    for (const [uid, event] of Object.entries(events)) {
      if (!event || event.type !== "VEVENT") continue;
      const e = event as ical.VEvent;
      const start = e.start;
      if (!start) continue;
      const summary = String(e.summary ?? "vs. TBD");
      const locationRaw = e.location;
      const location = locationRaw == null ? null : String(locationRaw);
      // Try to extract opponent from summary: "vs X" / "@ X" / "v X" / just use full summary
      const opponentMatch = summary.match(/(?:vs\.?\s*|@\s*|v\.?\s*)(.+)/i);
      const opponent = opponentMatch ? opponentMatch[1]!.trim() : summary;
      games.push({
        uid,
        summary,
        opponent,
        gameDate: new Date(start).toISOString(),
        location,
      });
    }

    games.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
    res.json(games);
  } catch (err) {
    res.status(422).json({ error: "Failed to fetch or parse calendar. Check the URL and try again." });
  }
});

// Bulk create games from iCal import (confirmed selection)
router.post("/games/import-ical/confirm", async (req, res): Promise<void> => {
  const { games, innings = 6 } = req.body;
  if (!Array.isArray(games) || games.length === 0) {
    res.status(400).json({ error: "games array required" });
    return;
  }
  const inserted = await db
    .insert(gamesTable)
    .values(
      games.map((g: { opponent: string; gameDate: string; location?: string | null }) => ({
        opponent: g.opponent,
        gameDate: new Date(g.gameDate),
        location: g.location ?? null,
        innings,
        status: "upcoming" as const,
        notes: null,
      }))
    )
    .returning();
  res.status(201).json(inserted);
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
