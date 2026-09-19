import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { db, gamesTable } from "@workspace/db";
import { logger } from "./logger";
import { listMblSeasons } from "./mbl";

/**
 * Umpire info for synced games, refreshed alongside the calendar sync.
 *
 *  1. MBL (mbl.bz) publishes which umpire association covers each game.
 *     For a team connected through its MBL feed we read that per game.
 *  2. North Metro Umpire Association (nmua.net) publishes who is actually
 *     assigned, as big Excel-exported HTML tables (one page per half
 *     month, plus "Fall Ball"). For North Metro games we match rows by
 *     date + start time + field and store the umpire's name.
 *
 * Names only: the NMUA tables also carry umpires' phone numbers, and many
 * umpires are 13–17, so we never copy those.
 */

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; LineupManager/1.0)" };
const TZ = "America/Chicago";
const NOT_ASSIGNED = "Not assigned yet";

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.text();
}

// ---------------------------------------------------------------------------
// MBL: umpire association per game
// ---------------------------------------------------------------------------

const MBL_FEED_RE = /mbl\.bz\/teams\/(\d+)\/schedule\.ics/i;

/** Map of feed UID ("mbl_game_<id>") → umpire association name. */
async function mblUmpireOrgs(teamId: number): Promise<Map<string, string>> {
  return cached(`mbl-orgs:${teamId}`, 30 * 60 * 1000, async () => {
    // Team ids are per season, so find the active season that has it.
    for (const season of await listMblSeasons()) {
      const r = await fetch(
        `https://www.mbl.bz/api/seasons/${season.id}/games?teamId=${teamId}&includePractices=false`,
        { headers: HEADERS, signal: AbortSignal.timeout(20_000) },
      );
      if (!r.ok) continue;
      const games = (await r.json()) as Array<{ id: number; umpireOrganization?: { name?: string } | null }>;
      if (!Array.isArray(games) || games.length === 0) continue;
      const map = new Map<string, string>();
      for (const g of games) {
        const name = g.umpireOrganization?.name?.replace(/\s+/g, " ").trim();
        if (name) map.set(`mbl_game_${g.id}`, name);
      }
      return map;
    }
    return new Map<string, string>();
  });
}

// ---------------------------------------------------------------------------
// NMUA: assigned umpire names
// ---------------------------------------------------------------------------

type NmuaRow = { date: string; time: string; fieldTokens: string[]; name: string | null };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// "Bennett Park, Field #2" and "Minnetonka Bennett #2" → field tokens that
// can be compared: ["bennett", "2"] ⊆ ["minnetonka", "bennett", "2"].
const FIELD_NOISE = new Set(["park", "field", "fields", "complex", "the", "at", "diamond", "ballpark", "no"]);
function fieldTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !FIELD_NOISE.has(t));
}

/** Parse one NMUA schedule page into rows. Column positions come from the header row. */
export function parseNmuaPage(html: string, year: number): NmuaRow[] {
  const rows: NmuaRow[] = [];
  let col: Record<string, number> | null = null;
  for (const tr of html.split(/<tr[\s>]/i).slice(1)) {
    const cells: string[] = [];
    for (const m of tr.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)) {
      const span = Number(/colspan="?(\d+)/i.exec(m[1]!)?.[1] ?? 1);
      cells.push(decode(m[2]!));
      for (let i = 1; i < span; i++) cells.push("");
    }
    if (!col) {
      const lower = cells.map((c) => c.toLowerCase());
      if (lower.includes("date") && lower.includes("time") && lower.includes("first")) {
        col = {
          date: lower.indexOf("date"),
          time: lower.indexOf("time"),
          field: lower.indexOf("field"),
          first: lower.indexOf("first"),
          last: lower.indexOf("last"),
        };
      }
      continue;
    }
    const dm = /^(\d{1,2})-([A-Za-z]{3})/.exec(cells[col.date!] ?? "");
    const time = (cells[col.time!] ?? "").toUpperCase().replace(/\s+/g, " ");
    if (!dm || !/^\d{1,2}:\d{2} [AP]M$/.test(time)) continue;
    const month = MONTHS.indexOf(dm[2]!.toLowerCase());
    if (month < 0) continue;
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${dm[1]!.padStart(2, "0")}`;
    const unassigned = /no umpire/i.test(cells.join(" "));
    const name = unassigned ? null : `${cells[col.first!] ?? ""} ${cells[col.last!] ?? ""}`.trim() || null;
    rows.push({ date, time, fieldTokens: fieldTokens(cells[col.field!] ?? ""), name });
  }
  return rows;
}

/** Schedule pages for the given year whose title covers the given month. */
async function nmuaPagesFor(year: number, month: number): Promise<string[]> {
  const links = await cached("nmua-index", 6 * 60 * 60 * 1000, async () => {
    const html = await fetchText("https://www.nmua.net/Schedules.htm");
    return [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
      href: new URL(m[1]!, "https://www.nmua.net/").toString(),
      text: decode(m[2]!),
    }));
  });
  const monthName = new Date(Date.UTC(year, month, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return links
    .filter((l) => l.text.startsWith(String(year)))
    .filter((l) => new RegExp(`\\b${monthName}\\b`, "i").test(l.text) || (month >= 7 && /fall/i.test(l.text)))
    .map((l) => l.href);
}

async function nmuaRows(pageUrl: string, year: number): Promise<NmuaRow[]> {
  return cached(`nmua:${pageUrl}`, 30 * 60 * 1000, async () => parseNmuaPage(await fetchText(pageUrl), year));
}

function localParts(d: Date): { date: string; time: string; year: number; month: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()}`,
    year: Number(p.year),
    month: Number(p.month) - 1,
  };
}

/** Umpire name(s) for a North Metro game, "Not assigned yet", or null if NMUA doesn't list it. */
export async function findNmuaUmpire(gameDate: Date, location: string | null): Promise<string | null> {
  if (!location) return null;
  const want = fieldTokens(location);
  if (want.length === 0) return null;
  const local = localParts(gameDate);
  const matches: NmuaRow[] = [];
  for (const page of await nmuaPagesFor(local.year, local.month)) {
    for (const row of await nmuaRows(page, local.year)) {
      if (row.date === local.date && row.time === local.time && want.every((t) => row.fieldTokens.includes(t))) {
        matches.push(row);
      }
    }
  }
  if (matches.length === 0) return null;
  const names = [...new Set(matches.map((m) => m.name).filter((n): n is string => !!n))];
  return names.length > 0 ? names.join(" & ") : NOT_ASSIGNED;
}

// ---------------------------------------------------------------------------
// Refresh for one team (called after each calendar sync)
// ---------------------------------------------------------------------------

export async function refreshUmpires(userId: string, feedUrl: string): Promise<void> {
  const teamId = MBL_FEED_RE.exec(feedUrl)?.[1];
  if (!teamId) return; // only MBL feeds say which association covers a game
  const orgs = await mblUmpireOrgs(Number(teamId));
  if (orgs.size === 0) return;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const games = await db
    .select({
      id: gamesTable.id,
      sourceUid: gamesTable.sourceUid,
      gameDate: gamesTable.gameDate,
      location: gamesTable.location,
      umpireOrg: gamesTable.umpireOrg,
      umpireName: gamesTable.umpireName,
    })
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.userId, userId),
        isNotNull(gamesTable.sourceUid),
        isNull(gamesTable.deletedAt),
        gte(gamesTable.gameDate, since),
      ),
    );

  for (const g of games) {
    const org = orgs.get(g.sourceUid!) ?? null;
    let name: string | null = null;
    if (org && /north metro/i.test(org)) {
      try {
        name = await findNmuaUmpire(g.gameDate, g.location);
      } catch (err) {
        logger.warn({ err, gameId: g.id }, "nmua lookup failed");
        name = g.umpireName; // keep what we had
      }
    }
    if (org !== g.umpireOrg || name !== g.umpireName) {
      await db.update(gamesTable).set({ umpireOrg: org, umpireName: name }).where(eq(gamesTable.id, g.id));
    }
  }
}
