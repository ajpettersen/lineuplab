import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db, gamesTable, lineupEntriesTable } from "@workspace/db";
import {
  CreateGameBody,
  GetGameParams,
  UpdateGameParams,
  UpdateGameBody,
  DeleteGameParams,
} from "@workspace/api-zod";

const ConfirmICalBodySchema = z.object({
  innings: z.number().int().min(1).max(15).default(6),
  games: z
    .array(
      z.object({
        opponent: z.string(),
        gameDate: z.string().datetime({ offset: true }).or(z.string().datetime()),
        location: z.string().nullable().optional(),
        type: z.enum(["game", "practice", "other"]).default("game"),
        summary: z.string().optional(),
      }),
    )
    .min(1, "games array required"),
});
import ical from "node-ical";

const router: IRouter = Router();

router.get("/games", async (_req, res): Promise<void> => {
  const games = await db.select().from(gamesTable).orderBy(gamesTable.gameDate);
  res.json(games);
});

// Games that have at least one saved lineup entry. Used by the
// "Copy from previous" picker on the game-detail page so a coach can start
// a new lineup from a past game's positions. Must be defined BEFORE
// "/games/:id" so it is not shadowed by the parametric route.
router.get("/games/with-lineups", async (_req, res): Promise<void> => {
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
    .groupBy(gamesTable.id)
    .orderBy(desc(gamesTable.gameDate));
  res.json(rows);
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
  // Normalize: webcal:// → https://, trim whitespace
  let url = icalUrl.trim();
  if (url.startsWith("webcal://")) url = "https://" + url.slice("webcal://".length);
  if (url.startsWith("webcals://")) url = "https://" + url.slice("webcals://".length);
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    res.status(400).json({ error: "URL must start with http://, https://, or webcal://" });
    return;
  }
  try {
    // Manual fetch with browser-like UA — many calendar hosts block default node user agents
    const fetchRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DugoutManager-iCal/1.0)",
        Accept: "text/calendar, text/plain, */*",
      },
      redirect: "follow",
    });
    if (!fetchRes.ok) {
      req.log.warn({ url, status: fetchRes.status }, "iCal fetch failed");
      res.status(422).json({
        error: `Calendar host returned HTTP ${fetchRes.status}. Check the URL is publicly accessible.`,
      });
      return;
    }
    const body = await fetchRes.text();
    if (!body.includes("BEGIN:VCALENDAR")) {
      req.log.warn({ url, bodyStart: body.slice(0, 100) }, "iCal response not a valid calendar");
      res.status(422).json({
        error: "URL did not return a valid iCalendar file. Make sure it's the .ics export link, not the calendar's web page.",
      });
      return;
    }
    const events = ical.sync.parseICS(body);
    const games: {
      uid: string;
      summary: string;
      opponent: string;
      gameDate: string;
      location: string | null;
      type: "game" | "practice" | "other";
    }[] = [];

    const classify = (text: string): "game" | "practice" | "other" => {
      const t = text.toLowerCase();
      // Practice indicators (word-bounded)
      if (/\b(practice|prac|workout|training|skills?|drill|drills|batting cage|cages|bullpen|infield work)\b/.test(t)) {
        return "practice";
      }
      // Other: meetings, clinics, parent-stuff, fundraisers, banquets, etc.
      if (/\b(meeting|mtg|clinic|tryout|tryouts|parent|coach(?:es)? meeting|banquet|fundraiser|registration|orientation|picture day|photo day|photos|pictures|team dinner|team social|volunteer)\b/.test(t)) {
        return "other";
      }
      // Game indicators (case-insensitive word-bounded list)
      const hasGameKeyword = /\b(game|games|match|matchup|tournament|tourney|scrimmage|playoffs?|championship|league|doubleheader|dh|vs)\b/.test(t);
      // "@" anywhere followed by something
      const hasAtSymbol = /(^|\s)@\s*\S/.test(t);
      // Standard ICS away-game format: "TeamA at TeamB" — require capitalized team-like tokens
      // on both sides (use the original text, not the lowercased one) to avoid generic phrases
      // like "Team event at park".
      // Allow team names that start with a digit (e.g. "10AA Blue") or capital letter.
      const hasAwayPattern = /\b[A-Z0-9][\w-]*(?:\s+\S+)*\s+at\s+[A-Z0-9][\w-]*/.test(text);
      if (hasGameKeyword || hasAtSymbol || hasAwayPattern) {
        return "game";
      }
      // Unknown — default to "other" so the user must consciously include it
      return "other";
    };

    for (const [uid, event] of Object.entries(events)) {
      if (!event || event.type !== "VEVENT") continue;
      const e = event as ical.VEvent;
      const start = e.start;
      if (!start) continue;
      // node-ical sometimes returns properties as { val, params } objects instead of strings
      const toStr = (v: unknown): string => {
        if (v == null) return "";
        if (typeof v === "string") return v;
        if (typeof v === "object" && "val" in v && typeof (v as { val: unknown }).val === "string") {
          return (v as { val: string }).val;
        }
        return String(v);
      };
      const summary = toStr(e.summary) || "vs. TBD";
      const description = toStr(e.description);
      const locationStr = toStr(e.location);
      const location = locationStr.length > 0 ? locationStr : null;
      const type = classify(summary + " " + description);
      // Try to extract opponent from summary: "vs X" / "@ X" / "v X" / just use full summary
      const opponentMatch = summary.match(/(?:vs\.?\s*|@\s*|v\.?\s*)(.+)/i);
      const opponent = opponentMatch ? opponentMatch[1]!.trim() : summary;
      games.push({
        uid,
        summary,
        opponent,
        gameDate: new Date(start).toISOString(),
        location,
        type,
      });
    }

    games.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
    res.json(games);
  } catch (err) {
    req.log.error({ err, url }, "iCal preview failed");
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(422).json({ error: `Failed to fetch calendar: ${msg}` });
  }
});

// Bulk create games from iCal import (confirmed selection)
router.post("/games/import-ical/confirm", async (req, res): Promise<void> => {
  const parsed = ConfirmICalBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  const { games, innings } = parsed.data;
  const inserted = await db
    .insert(gamesTable)
    .values(
      games.map((g) => {
        const type = g.type;
        // For practice/other, the "opponent" field doesn't apply — use a friendly label
        const opponent =
          type === "practice"
            ? (g.summary?.trim() || "Practice")
            : type === "other"
              ? (g.summary?.trim() || "Team Event")
              : g.opponent;
        return {
          opponent,
          gameDate: new Date(g.gameDate),
          location: g.location ?? null,
          innings,
          status: "upcoming" as const,
          type,
          notes: null,
        };
      })
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
