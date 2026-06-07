import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import { and, eq, gt, isNull, sql, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  gamesTable,
  lineupEntriesTable,
  lineupLocksTable,
  aiPinnedAssignmentsTable,
  playersTable,
  teamSettingsTable,
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

// Tokens that should never count as a team-name match (separators, articles).
const STOPWORDS = new Set(["the", "a", "an", "of", "vs", "v", "at"]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

// Splits an iCal SUMMARY on the common "vs"/"v"/"@"/"at" separators
// leagues use to express matchups. Returns the parts in order.
const MATCHUP_SEPARATOR_RE = /\s+(?:vs\.?|v\.?|@|at)\s+/i;

/**
 * Extract the opponent's name from an iCal event SUMMARY by figuring out
 * which side of the matchup is the user's OWN team.
 *
 * Real-world summaries we have to handle:
 *   "Minnetonka Blue vs Plymouth Pilots"        → "Plymouth Pilots"
 *   "Plymouth @ Minnetonka Blue"                → "Plymouth"
 *   "Plymouth Pilots vs Blue"                   → "Plymouth Pilots"
 *       (league shortened user's team to color)
 *   "Edina vs Minnetonka Blue at Field 5"       → "Edina"
 *       (location after a SECOND separator)
 *   "Orono Spartans (Orono) at Northwood Park"  → "Orono Spartans (Orono)"
 *       (no own-team in summary at all)
 *
 * Strategy: split the summary on vs/v/@/at, then return the FIRST part
 * whose meaningful tokens don't overlap the user's team-name tokens.
 * Token-level overlap matches "Blue" against "Minnetonka Blue 10AA" —
 * which is exactly the symptom the user reported.
 */
export function extractOpponentFromSummary(
  summary: string,
  teamName: string | null | undefined,
): string {
  const cleanSummary = summary.trim();
  if (!cleanSummary) return cleanSummary;
  const parts = cleanSummary
    .split(MATCHUP_SEPARATOR_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 2) return cleanSummary;

  const ownTokens = new Set(tokenize(teamName ?? ""));
  if (ownTokens.size === 0) {
    // No team name to match against — fall back to the legacy behavior of
    // taking whatever follows the first separator.
    return parts[1] ?? cleanSummary;
  }

  const isOwnTeam = (part: string): boolean => {
    const tks = tokenize(part);
    if (tks.length === 0) return false;
    return tks.some((t) => ownTokens.has(t));
  };

  // First part that doesn't look like our own team. Naturally drops any
  // trailing " at <Field>" location cruft because location parts also
  // won't match our team-name tokens — but the FIRST non-own part wins,
  // so the real opponent is preferred over the location string.
  for (const part of parts) {
    if (!isOwnTeam(part)) return part;
  }

  // Both sides matched our team (rare — both are color-only?). Fall back
  // to the second part so we don't return our own team verbatim.
  return parts[1] ?? cleanSummary;
}

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
    // Pull the user's team name so we can match it against each side of
    // the matchup (so road games like "Plymouth @ Minnetonka Blue" don't
    // store the user's own team as the opponent — see
    // extractOpponentFromSummary).
    const userId = req.ownerUserId!;
    const [settings] = await db
      .select({ teamName: teamSettingsTable.teamName })
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.userId, userId));
    const ownTeamName = settings?.teamName ?? "";

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
      // Extract opponent by matching each side of the matchup against the
      // user's own team name, so road games where the league shortened our
      // team to just a color (e.g. "Plymouth @ Blue") don't end up with
      // "Blue" stored as the opponent.
      const opponent = extractOpponentFromSummary(summary, ownTeamName);
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
  if (d.tournamentId !== undefined) updates.tournamentId = d.tournamentId;
  if (d.bracketStage !== undefined) updates.bracketStage = d.bracketStage;
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

    const [updated] = await tx
      .update(gamesTable)
      .set(updates)
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
  const [game] = await db
    .update(gamesTable)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(gamesTable.id, params.data.id),
        eq(gamesTable.userId, userId),
        isNull(gamesTable.deletedAt),
      ),
    )
    .returning();
  if (!game) {
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
    .set({ deletedAt: null })
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
