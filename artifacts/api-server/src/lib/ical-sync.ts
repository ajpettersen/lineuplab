import ical from "node-ical";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  gamesTable,
  teamSettingsTable,
} from "@workspace/db";
import { extractOpponentFromSummary } from "../routes/games";
import { logger } from "./logger";

/**
 * Shared iCal fetcher used by both the manual preview route (in
 * games.ts) and the recurring sync scheduler. Fetches the URL with a
 * browser-like User-Agent (many calendar hosts 403 on default
 * `node-fetch`), validates the body looks like an iCalendar payload,
 * and returns parsed VEVENTs as normalized game candidates.
 *
 * Returns a discriminated union — caller decides whether to surface
 * the error to the coach (manual path) or just log it (scheduler).
 */
export type IcalEventCandidate = {
  uid: string;
  summary: string;
  opponent: string;
  gameDate: string;
  location: string | null;
  type: "game" | "practice" | "other";
};

export type IcalFetchResult =
  | { ok: true; events: IcalEventCandidate[]; skippedNonGames: number }
  | { ok: false; error: string };

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; LineupManager-iCal/1.0)",
  Accept: "text/calendar, text/plain, */*",
};

/**
 * Classify a VEVENT summary into game vs practice vs other. Same
 * logic as the original preview route — extracted here so the
 * scheduler classifies identically (a feed-side rename like "Game" →
 * "Match" mustn't flip a game's classification between the two
 * paths, or auto-sync would import duplicates).
 */
function classify(text: string): "game" | "practice" | "other" {
  const t = text.toLowerCase();
  if (
    /\b(practice|prac|workout|training|skills?|drill|drills|batting cage|cages|bullpen|infield work)\b/.test(t)
  ) {
    return "practice";
  }
  if (
    /\b(meeting|mtg|clinic|tryout|tryouts|parent|coach(?:es)? meeting|banquet|fundraiser|registration|orientation|picture day|photo day|photos|pictures|team dinner|team social|volunteer)\b/.test(t)
  ) {
    return "other";
  }
  const hasGameKeyword = /\b(game|games|match|matchup|tournament|tourney|scrimmage|playoffs?|championship|league|doubleheader|dh|vs)\b/.test(t);
  const hasAtSymbol = /(^|\s)@\s*\S/.test(t);
  const hasAwayPattern = /\b[A-Z0-9][\w-]*(?:\s+\S+)*\s+at\s+[A-Z0-9][\w-]*/.test(text);
  if (hasGameKeyword || hasAtSymbol || hasAwayPattern) return "game";
  return "other";
}

/** node-ical occasionally returns { val, params } objects instead of strings. */
function toStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "val" in v && typeof (v as { val: unknown }).val === "string") {
    return (v as { val: string }).val;
  }
  return String(v);
}

/**
 * Normalize webcal:// → https:// (RFC says both schemes resolve to
 * the same calendar; node's fetch only speaks http/https).
 */
export function normalizeIcalUrl(input: string): string {
  let url = input.trim();
  if (url.startsWith("webcal://")) url = "https://" + url.slice("webcal://".length);
  if (url.startsWith("webcals://")) url = "https://" + url.slice("webcals://".length);
  return url;
}

export async function fetchAndParseIcal(
  rawUrl: string,
  ownTeamName: string,
): Promise<IcalFetchResult> {
  const url = normalizeIcalUrl(rawUrl);
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { ok: false, error: "URL must start with http://, https://, or webcal://" };
  }
  let body: string;
  try {
    const r = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
    if (!r.ok) {
      return { ok: false, error: `Calendar host returned HTTP ${r.status}` };
    }
    body = await r.text();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to fetch calendar",
    };
  }
  if (!body.includes("BEGIN:VCALENDAR")) {
    return { ok: false, error: "URL did not return a valid iCalendar file" };
  }
  let parsedObj: ical.CalendarResponse;
  try {
    parsedObj = ical.sync.parseICS(body);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to parse calendar",
    };
  }
  const all: IcalEventCandidate[] = [];
  for (const [uid, event] of Object.entries(parsedObj)) {
    if (!event || event.type !== "VEVENT") continue;
    const e = event as ical.VEvent;
    if (!e.start) continue;
    const summary = toStr(e.summary) || "vs. TBD";
    const description = toStr(e.description);
    const locationStr = toStr(e.location);
    const type = classify(summary + " " + description);
    all.push({
      uid,
      summary,
      opponent: extractOpponentFromSummary(summary, ownTeamName),
      gameDate: new Date(e.start).toISOString(),
      location: locationStr.length > 0 ? locationStr : null,
      type,
    });
  }
  all.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
  const onlyGames = all.filter((g) => g.type === "game");
  return {
    ok: true,
    events: onlyGames,
    skippedNonGames: all.length - onlyGames.length,
  };
}

/**
 * Run one sync cycle for a single team. Fetches the saved icalUrl,
 * upserts each event into `games` keyed on `(userId, sourceUid)`. New
 * events are created with status="upcoming"; existing ones get their
 * date/opponent/location refreshed in place. We never touch games
 * with `sourceUid IS NULL` (manual entries) and never override
 * `ourScore`/`opponentScore`/`status` so a completed game doesn't
 * regress when the league cleans up old SUMMARY text.
 *
 * Returns `{ upserted, error }` so the caller can record the result.
 * Throws are caught and converted to `error`.
 */
export async function syncIcalForUser(
  userId: string,
  icalUrl: string,
  ownTeamName: string,
): Promise<{ upserted: number; error: string | null }> {
  let result: IcalFetchResult;
  try {
    result = await fetchAndParseIcal(icalUrl, ownTeamName);
  } catch (err) {
    return {
      upserted: 0,
      error: err instanceof Error ? err.message : "Unknown fetch error",
    };
  }
  if (!result.ok) return { upserted: 0, error: result.error };

  let count = 0;
  for (const ev of result.events) {
    // Upsert on (userId, sourceUid) — partial-unique index on the
    // games table. We don't touch scores or status on conflict so a
    // game that was already played stays played.
    await db
      .insert(gamesTable)
      .values({
        userId,
        opponent: ev.opponent || "TBD",
        gameDate: new Date(ev.gameDate),
        location: ev.location,
        innings: 6,
        status: "upcoming",
        type: "game",
        sourceUid: ev.uid,
      })
      .onConflictDoUpdate({
        target: [gamesTable.userId, gamesTable.sourceUid],
        // Only refresh schedule fields — opponent + date + location can
        // legitimately move; scores and status must NOT regress.
        set: {
          opponent: ev.opponent || "TBD",
          gameDate: new Date(ev.gameDate),
          location: ev.location,
          rowVersion: sql`${gamesTable.rowVersion} + 1`,
        },
        // Don't resurrect soft-deleted games — if the coach trashed an
        // event we should not re-create it on the next sync just because
        // it's still in the league feed.
        setWhere: isNull(gamesTable.deletedAt),
      });
    count++;
  }
  return { upserted: count, error: null };
}

// ---------------------------------------------------------------------------
// Scheduler — runs every hour, processes every team that opted in.
// Single-flight guard; survives errors per-team so one broken feed
// doesn't stall everyone else.
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runIcalSyncTickOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const rows = await db
      .select({
        userId: teamSettingsTable.userId,
        teamName: teamSettingsTable.teamName,
        icalUrl: teamSettingsTable.icalUrl,
      })
      .from(teamSettingsTable)
      .where(
        and(
          eq(teamSettingsTable.icalAutoSync, true),
          // SQL-level null check via the column ref → reuses index when added.
        ),
      );
    const candidates = rows.filter(
      (r): r is typeof r & { icalUrl: string } =>
        typeof r.icalUrl === "string" && r.icalUrl.length > 0,
    );
    if (candidates.length === 0) return;
    logger.info({ count: candidates.length }, "ical-sync: candidates");
    for (const c of candidates) {
      const { upserted, error } = await syncIcalForUser(
        c.userId,
        c.icalUrl,
        c.teamName,
      );
      await db
        .update(teamSettingsTable)
        .set({
          icalLastSyncAt: new Date(),
          icalLastSyncError: error,
          icalLastSyncCount: error ? null : upserted,
          rowVersion: sql`${teamSettingsTable.rowVersion} + 1`,
        })
        .where(eq(teamSettingsTable.userId, c.userId));
      logger.info(
        { userId: c.userId, upserted, error },
        "ical-sync: team result",
      );
    }
  } catch (err) {
    logger.error({ err }, "ical-sync tick failed");
  } finally {
    running = false;
  }
}

export function startIcalSyncScheduler(): void {
  if (timer) return;
  // Fire once 60s after boot so a coach who just enabled it sees a
  // quick first sync, then settle into hourly.
  setTimeout(() => {
    void runIcalSyncTickOnce();
  }, 60 * 1000);
  timer = setInterval(() => {
    void runIcalSyncTickOnce();
  }, ONE_HOUR_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ intervalMs: ONE_HOUR_MS }, "ical-sync scheduler started");
}
