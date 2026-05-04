import { Router, type IRouter } from "express";
import { and, eq, gt, sql, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  gamesTable,
  lineupEntriesTable,
  lineupLocksTable,
  aiPinnedAssignmentsTable,
  playersTable,
} from "@workspace/db";
import type { PlanSnapshotEntry } from "@workspace/db";
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

router.get("/games", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const games = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.userId, userId))
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
    .where(eq(gamesTable.userId, userId))
    .groupBy(gamesTable.id)
    .orderBy(desc(gamesTable.gameDate));
  res.json(rows);
});

router.post("/games", async (req, res): Promise<void> => {
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
        "User-Agent": "Mozilla/5.0 (compatible; LineupManager-iCal/1.0)",
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
    const onlyGames = games.filter((g) => g.type === "game");
    const skipped = games.length - onlyGames.length;
    res.json({ games: onlyGames, skipped });
  } catch (err) {
    req.log.error({ err, url }, "iCal preview failed");
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(422).json({ error: `Failed to fetch calendar: ${msg}` });
  }
});

// Bulk create games from iCal import (confirmed selection)
router.post("/games/import-ical/confirm", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
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
          userId,
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
  const userId = req.ownerUserId!;
  const params = GetGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [game] = await db
    .select()
    .from(gamesTable)
    .where(and(eq(gamesTable.id, params.data.id), eq(gamesTable.userId, userId)));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(game);
});

router.patch("/games/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
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
  if (d.startedAt !== undefined) {
    // Convert ISO string → Date for Drizzle's timestamp column (avoid
    // any driver-level surprises around string-vs-Date coercion). Null
    // is a valid value too — used by the field-display "Reset timer"
    // affordance to clear a mistaken first-pitch timestamp.
    updates.startedAt = d.startedAt === null ? null : new Date(d.startedAt);
  }
  if (d.notes !== undefined) updates.notes = d.notes;
  if (d.gameType !== undefined) updates.gameType = d.gameType;

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
      .where(and(eq(gamesTable.id, params.data.id), eq(gamesTable.userId, userId)));
    if (!existing) return null;

    const [updated] = await tx
      .update(gamesTable)
      .set(updates)
      .where(and(eq(gamesTable.id, params.data.id), eq(gamesTable.userId, userId)))
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

  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(game);
});

// Snapshot the currently-saved lineup into games.plan_snapshot. Used by the
// mobile photo-override flow when the coach picks "Keep original as plan"
// before replacing the lineup with what actually happened in the game.
router.post("/games/:id/snapshot-plan", async (req, res): Promise<void> => {
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
    .where(and(eq(gamesTable.id, params.data.id), eq(gamesTable.userId, userId)));
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
    .set({ planSnapshot: snapshot })
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
    .set({ planSnapshot: null })
    .where(and(eq(gamesTable.id, params.data.id), eq(gamesTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(updated);
});

router.delete("/games/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = DeleteGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [game] = await db
    .delete(gamesTable)
    .where(and(eq(gamesTable.id, params.data.id), eq(gamesTable.userId, userId)))
    .returning();
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
