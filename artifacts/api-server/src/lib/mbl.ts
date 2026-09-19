/**
 * Metro Baseball League (mbl.bz) team finder, so a coach can connect their
 * schedule by picking season → association → team instead of hunting for
 * a calendar link. Uses the same public endpoints mbl.bz's own schedule
 * pages call. Only names/ids are passed through — MBL's payloads also
 * carry coach and admin contact details, which we deliberately drop.
 *
 * Once a team is picked, the client connects its iCal feed
 * (mblTeamFeedUrl) through the normal /calendar/connect flow.
 */

const ORIGIN = "https://www.mbl.bz";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; LineupManager/1.0)", Accept: "application/json, text/html" };

export type MblSeason = { id: number; name: string; fall: boolean };
export type MblAssociation = { id: number; name: string };
export type MblTeam = { id: number; name: string; division: string | null };

export function mblTeamFeedUrl(teamId: number): string {
  return `${ORIGIN}/teams/${teamId}/schedule.ics`;
}

// MBL's team list is slow (1s per association, 20s+ for a whole season)
// and changes rarely, so cache everything in memory.
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function get(path: string): Promise<Response> {
  const r = await fetch(`${ORIGIN}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`mbl.bz returned ${r.status}`);
  return r;
}

const HOUR = 60 * 60 * 1000;

export function listMblSeasons(): Promise<MblSeason[]> {
  return cached("seasons", 6 * HOUR, async () => {
    const body = (await (await get("/api/seasons?page=0&size=50")).json()) as {
      content?: Array<{ id: number; name: string; seasonType?: string; active?: boolean; canSeeSchedules?: boolean }>;
    };
    return (body.content ?? [])
      .filter((s) => s.active && s.canSeeSchedules)
      .map((s) => ({ id: s.id, name: s.name, fall: s.seasonType === "FALL" }));
  });
}

/** Associations with teams in the season — read from the schedule page's filter dropdown. */
export function listMblAssociations(seasonId: number): Promise<MblAssociation[]> {
  return cached(`assoc:${seasonId}`, 6 * HOUR, async () => {
    const html = await (await get(`/seasons/${seasonId}/schedules`)).text();
    const select = /<select[^>]*id="associationId"[\s\S]*?<\/select>/.exec(html)?.[0] ?? "";
    return [...select.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)].map((m) => ({
      id: Number(m[1]),
      name: decodeEntities(m[2]!.trim()),
    }));
  });
}

export function listMblTeams(seasonId: number, associationId: number): Promise<MblTeam[]> {
  return cached(`teams:${seasonId}:${associationId}`, HOUR, async () => {
    const body = (await (
      await get(`/api/seasons/${seasonId}/teams?associationId=${associationId}&divisionId=&page=0&size=1000`)
    ).json()) as { content?: Array<{ id: number; name: string; division?: { display?: string } | null }> };
    return (body.content ?? [])
      .map((t) => ({ id: t.id, name: t.name, division: t.division?.display ?? null }))
      .sort((a, b) => (a.division ?? "").localeCompare(b.division ?? "", undefined, { numeric: true }) || a.name.localeCompare(b.name));
  });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
