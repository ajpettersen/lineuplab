import ical from "node-ical";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  gamesTable,
  teamSettingsTable,
} from "@workspace/db";
import { logger } from "./logger";

/**
 * Shared iCal fetcher used by the calendar routes (routes/calendar.ts)
 * and the recurring sync scheduler. Fetches the URL with a
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
  | {
      ok: true;
      /** The calendar feed actually read — differs from the pasted URL when it was a web page. */
      resolvedUrl: string;
      events: IcalEventCandidate[];
      skippedNonGames: number;
    }
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
  feedOwnName?: string | null,
): string {
  const cleanSummary = stripGameNumber(summary);
  if (!cleanSummary) return cleanSummary;
  const parts = splitMatchup(cleanSummary);
  if (parts.length < 2) return cleanSummary;

  // The feed's own spelling of our team (see detectFeedOwnName) is exact,
  // so it beats token matching — and still works when two teams from the
  // same club meet ("MTKA-Keene @ MTKA-Pettersen").
  if (feedOwnName && parts.includes(feedOwnName)) {
    return parts.find((p) => p !== feedOwnName) ?? cleanSummary;
  }

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

// League feeds often prefix a game number: "#177557 Tonka @ Victoria".
function stripGameNumber(summary: string): string {
  return summary.trim().replace(/^#\d+\s+/, "");
}

function splitMatchup(summary: string): string[] {
  return summary
    .split(MATCHUP_SEPARATOR_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * League feeds name our team their way ("MTKA-11AA/AAA-Pettersen"),
 * which rarely shares a word with the name the coach typed into the app
 * ("Tonka Fall"). But a team feed is by definition that team's games, so
 * the side that shows up in (nearly) every matchup is us.
 */
export function detectFeedOwnName(summaries: string[]): string | null {
  const counts = new Map<string, number>();
  let matchups = 0;
  for (const s of summaries) {
    const parts = splitMatchup(stripGameNumber(s));
    if (parts.length < 2) continue;
    matchups++;
    for (const p of new Set(parts)) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  if (matchups < 2) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, n] of counts) {
    if (n > bestCount) {
      best = name;
      bestCount = n;
    }
  }
  return bestCount >= Math.ceil(matchups * 0.75) ? best : null;
}

/**
 * Drop age/level codes from a league team name so it fits on the Field
 * Display: "Wayzata-11AA/AAA-Caris" → "Wayzata - Caris",
 * "Orono 11AA/AAA Red - Cole" → "Orono Red - Cole", "Plymouth 10U" →
 * "Plymouth". Leaves the coach suffix — it's what tells two teams from
 * the same town apart.
 */
export function tidyTeamName(name: string): string {
  const tidied = name
    .replace(/\b\d{1,2}U?\s?(?:AAA|AA|A|Rec)(?:\s?\/\s?(?:AAA|AA|A|Rec))*\b/gi, " ")
    .replace(/\b\d{1,2}U\b/gi, " ")
    .replace(/\s*-[\s-]*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s-]+|[\s-]+$/g, "");
  return tidied.length > 0 ? tidied : name.trim();
}

/**
 * Feeds that write "floating" times (no Z, no TZID — e.g. MBL's
 * `DTSTART:20260913T130000`) mean local time at the field. node-ical
 * reads those in the server's zone, which is UTC on Railway, so a 1:00 PM
 * game came in as 8:00 AM Central. Pin them to the zone the feed names
 * (a per-event TZID line, then X-WR-TIMEZONE), else Central — every team
 * on the app today plays in Minnesota.
 */
const FALLBACK_TZ = "America/Chicago";

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function pinFloatingTimes(body: string): string {
  const calTz = /^X-WR-TIMEZONE:(.+?)\r?$/m.exec(body)?.[1]?.trim();
  return body.replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g, (block) => {
    const eventTz = /^TZID:(.+?)\r?$/m.exec(block)?.[1]?.trim();
    const tz = [eventTz, calTz].find((z): z is string => !!z && isValidTz(z)) ?? FALLBACK_TZ;
    return block.replace(
      /^(DTSTART|DTEND):(\d{8}T\d{6})(\r?)$/gm,
      (_m, prop: string, stamp: string, cr: string) => `${prop};TZID=${tz}:${stamp}${cr}`,
    );
  });
}

/**
 * When a coach pastes their team's web page instead of the calendar link
 * (e.g. mbl.bz/teams/30133), look for a calendar link on that page —
 * most league sites have an "iCal" / "Subscribe" link somewhere.
 */
function findCalendarLink(html: string, pageUrl: string): string | null {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!.replace(/&amp;/g, "&"));
  const pick =
    hrefs.find((h) => /^webcals?:\/\//i.test(h)) ??
    hrefs.find((h) => /\.ics(?:[?#]|$)/i.test(h)) ??
    hrefs.find((h) => /[/=]i?cal(?:endar)?[-_.]?(?:feed|export|subscribe)\b/i.test(h));
  if (!pick) return null;
  try {
    return normalizeIcalUrl(new URL(pick, pageUrl).toString());
  } catch {
    return null;
  }
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
  // Coaches often paste a bare "mbl.bz/teams/123".
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(url)) url = "https://" + url;
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
  const first = await fetchText(url);
  if (!first.ok) return first;
  let body = first.body;
  let resolvedUrl = url;
  if (!body.includes("BEGIN:VCALENDAR")) {
    const linked = findCalendarLink(body, url);
    const second = linked ? await fetchText(linked) : null;
    if (!linked || !second?.ok || !second.body.includes("BEGIN:VCALENDAR")) {
      return {
        ok: false,
        error: "That link opened a web page, and we couldn't find a calendar link on it. Look for a \"Subscribe\", \"Sync\", or \"iCal\" link on your team's schedule and paste that instead.",
      };
    }
    body = second.body;
    resolvedUrl = linked;
  }
  let parsedObj: ical.CalendarResponse;
  try {
    parsedObj = ical.sync.parseICS(pinFloatingTimes(body));
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to parse calendar",
    };
  }
  const vevents = Object.entries(parsedObj).filter(
    (entry): entry is [string, ical.VEvent] => entry[1]?.type === "VEVENT" && !!(entry[1] as ical.VEvent).start,
  );
  const feedOwnName = detectFeedOwnName(vevents.map(([, e]) => toStr(e.summary)));
  const all: IcalEventCandidate[] = [];
  for (const [uid, e] of vevents) {
    const summary = toStr(e.summary) || "vs. TBD";
    const description = toStr(e.description);
    const locationStr = toStr(e.location);
    const type = classify(summary + " " + description);
    all.push({
      uid,
      summary,
      opponent: tidyTeamName(extractOpponentFromSummary(summary, ownTeamName, feedOwnName)),
      gameDate: new Date(e.start).toISOString(),
      location: locationStr.length > 0 ? locationStr : null,
      type,
    });
  }
  all.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
  const onlyGames = all.filter((g) => g.type === "game");
  return {
    ok: true,
    resolvedUrl,
    events: onlyGames,
    skippedNonGames: all.length - onlyGames.length,
  };
}

async function fetchText(url: string): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
    if (!r.ok) {
      return {
        ok: false,
        error: `The calendar site refused the request (HTTP ${r.status}). Make sure you copied the calendar's public "subscribe" or "sync" link.`,
      };
    }
    return { ok: true, body: await r.text() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to fetch calendar" };
  }
}

export type IcalSyncResult = {
  /** Games in the feed (after filtering out practices/meetings). */
  found: number;
  /** New games created from the feed. */
  added: number;
  /** Already-linked games whose date/opponent/location were refreshed. */
  updated: number;
  /** Hand-entered games matched to a feed event and linked to it. */
  linked: number;
  /** Feed URL actually read (see IcalFetchResult); null when the fetch failed. */
  resolvedUrl: string | null;
  error: string | null;
};

// How far apart a hand-entered game and a feed event can be and still be
// treated as the same game. Wide enough to absorb a coach typing "1:00"
// for a 12:30 start; narrow enough that a doubleheader's second game
// (typically 2+ hours later) isn't mistaken for the first.
const LINK_WINDOW_MS = 90 * 60 * 1000;

/**
 * Run one sync cycle for a single team: fetch the feed, then for each
 * game event either
 *   1. refresh the game already linked to it (by `sourceUid`),
 *   2. link it to a matching hand-entered game (no `sourceUid`, within
 *      LINK_WINDOW_MS of the same start time) so connecting a calendar
 *      after entering a few games by hand doesn't duplicate them, or
 *   3. create a new upcoming game.
 * Only schedule fields (opponent/date/location) are ever written to an
 * existing game — scores, status, lineups are never touched. A linked
 * game the coach deleted stays deleted (we find it by `sourceUid`
 * regardless of `deletedAt` and skip it rather than re-creating it).
 *
 * Deliberately select-then-write rather than INSERT … ON CONFLICT: the
 * (userId, sourceUid) unique index is PARTIAL (`WHERE source_uid IS NOT
 * NULL`), and Postgres rejects ON CONFLICT against a partial index
 * unless the predicate is repeated — the original upsert here never ran
 * in production because no team had ever enabled sync. The unique index
 * still guards the one real race (scheduler + "Sync now" at once): a
 * duplicate insert is skipped via onConflictDoNothing.
 */
export async function syncIcalForUser(
  userId: string,
  icalUrl: string,
  ownTeamName: string,
): Promise<IcalSyncResult> {
  const empty = { found: 0, added: 0, updated: 0, linked: 0, resolvedUrl: null };
  let result: IcalFetchResult;
  try {
    result = await fetchAndParseIcal(icalUrl, ownTeamName);
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : "Unknown fetch error" };
  }
  if (!result.ok) return { ...empty, error: result.error };

  const counts = { ...empty, found: result.events.length };
  for (const ev of result.events) {
    const gameDate = new Date(ev.gameDate);
    const schedule = {
      opponent: ev.opponent || "TBD",
      gameDate,
      location: ev.location,
    };

    const [linked] = await db
      .select({ id: gamesTable.id, deletedAt: gamesTable.deletedAt, opponent: gamesTable.opponent })
      .from(gamesTable)
      .where(and(eq(gamesTable.userId, userId), eq(gamesTable.sourceUid, ev.uid)));
    if (linked) {
      if (linked.deletedAt) continue;
      await db
        .update(gamesTable)
        .set({
          ...schedule,
          opponent: keepCoachOpponent(linked.opponent, schedule.opponent),
          rowVersion: sql`${gamesTable.rowVersion} + 1`,
        })
        .where(eq(gamesTable.id, linked.id));
      counts.updated++;
      continue;
    }

    const [manual] = await db
      .select({ id: gamesTable.id, opponent: gamesTable.opponent })
      .from(gamesTable)
      .where(
        and(
          eq(gamesTable.userId, userId),
          eq(gamesTable.type, "game"),
          isNull(gamesTable.sourceUid),
          isNull(gamesTable.deletedAt),
          sql`abs(extract(epoch from (${gamesTable.gameDate} - ${gameDate.toISOString()}::timestamptz))) * 1000 <= ${LINK_WINDOW_MS}`,
        ),
      )
      .orderBy(sql`abs(extract(epoch from (${gamesTable.gameDate} - ${gameDate.toISOString()}::timestamptz)))`)
      .limit(1);
    if (manual) {
      await db
        .update(gamesTable)
        .set({
          ...schedule,
          opponent: keepCoachOpponent(manual.opponent, schedule.opponent),
          sourceUid: ev.uid,
          rowVersion: sql`${gamesTable.rowVersion} + 1`,
        })
        .where(eq(gamesTable.id, manual.id));
      counts.linked++;
      continue;
    }

    const inserted = await db
      .insert(gamesTable)
      .values({
        userId,
        ...schedule,
        innings: 6,
        status: "upcoming",
        type: "game",
        sourceUid: ev.uid,
      })
      .onConflictDoNothing()
      .returning({ id: gamesTable.id });
    if (inserted.length > 0) counts.added++;
  }
  return { ...counts, resolvedUrl: result.resolvedUrl, error: null };
}

/**
 * A coach who typed "Victoria" shouldn't have it replaced by the league's
 * "Victoria Hornets" every hour. Keep their name while it still shares a
 * word with the feed's; take the feed's when the opponent really changed.
 */
function keepCoachOpponent(current: string, fromFeed: string): string {
  const feedTokens = new Set(tokenize(fromFeed));
  return tokenize(current).some((t) => feedTokens.has(t)) ? current : fromFeed;
}

/**
 * Sync the team's saved calendar (if any) and record the outcome on
 * team_settings so the Schedule page can show "last synced / N games /
 * error". Shared by the hourly scheduler and the "Sync now" / "Connect"
 * routes so every path reports status the same way.
 */
export async function syncTeamCalendar(userId: string): Promise<IcalSyncResult | null> {
  const [settings] = await db
    .select({ teamName: teamSettingsTable.teamName, icalUrl: teamSettingsTable.icalUrl })
    .from(teamSettingsTable)
    .where(eq(teamSettingsTable.userId, userId));
  if (!settings?.icalUrl) return null;

  const result = await syncIcalForUser(userId, settings.icalUrl, settings.teamName);
  await db
    .update(teamSettingsTable)
    .set({
      // Save the feed we found on a pasted web page so later syncs read
      // the calendar directly instead of re-scraping the page.
      ...(result.resolvedUrl && result.resolvedUrl !== normalizeIcalUrl(settings.icalUrl)
        ? { icalUrl: result.resolvedUrl }
        : {}),
      icalLastSyncAt: new Date(),
      icalLastSyncError: result.error,
      icalLastSyncCount: result.error ? null : result.found,
      rowVersion: sql`${teamSettingsTable.rowVersion} + 1`,
    })
    .where(eq(teamSettingsTable.userId, userId));
  return result;
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
      .select({ userId: teamSettingsTable.userId })
      .from(teamSettingsTable)
      .where(
        and(
          eq(teamSettingsTable.icalAutoSync, true),
          isNotNull(teamSettingsTable.icalUrl),
          isNull(teamSettingsTable.archivedAt),
        ),
      );
    if (rows.length === 0) return;
    logger.info({ count: rows.length }, "ical-sync: candidates");
    for (const { userId } of rows) {
      const result = await syncTeamCalendar(userId);
      logger.info({ userId, ...result }, "ical-sync: team result");
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
