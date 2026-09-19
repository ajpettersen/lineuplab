import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, teamSettingsTable } from "@workspace/db";
import { assertPermission } from "../lib/permissions";
import { fetchAndParseIcal, syncTeamCalendar } from "../lib/ical-sync";
import { listMblAssociations, listMblSeasons, listMblTeams, mblTeamFeedUrl } from "../lib/mbl";
import { logger } from "../lib/logger";
import { getOrCreateForUser } from "./team-settings";

/**
 * Team calendar connection. A coach pastes the "subscribe"/"sync" link
 * from GameChanger, TeamSnap, SportsEngine, Google Calendar, etc.; we
 * save it and keep the schedule in sync from it (on connect, on "Sync
 * now", and hourly via the scheduler in lib/ical-sync.ts). Status is
 * read back through GET /team-settings (icalUrl / icalLastSync*).
 *
 * Connect/disconnect change team settings, so they need 'full'.
 * Preview and Sync now only read the feed / refresh schedule fields
 * already agreed to by the head coach, so 'partial' is enough.
 */
const router: IRouter = Router();

const UrlBody = z.object({ icalUrl: z.string().trim().min(1).max(2000) });

router.post("/calendar/preview", assertPermission("partial"), async (req, res): Promise<void> => {
  const parsed = UrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Paste a calendar link first." });
    return;
  }
  const settings = await getOrCreateForUser(req.ownerUserId!);
  const result = await fetchAndParseIcal(parsed.data.icalUrl, settings.teamName);
  if (!result.ok) {
    res.status(422).json({ error: result.error });
    return;
  }
  res.json({ games: result.events, skipped: result.skippedNonGames });
});

router.post("/calendar/connect", assertPermission("full"), async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = UrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Paste a calendar link first." });
    return;
  }
  await getOrCreateForUser(userId);
  await db
    .update(teamSettingsTable)
    .set({
      icalUrl: parsed.data.icalUrl,
      icalAutoSync: true,
      rowVersion: sql`${teamSettingsTable.rowVersion} + 1`,
    })
    .where(eq(teamSettingsTable.userId, userId));

  const result = await syncTeamCalendar(userId);
  if (!result || result.error) {
    // Don't leave a broken link saved — the hourly job would just keep
    // failing on it and the Schedule page would show a stale "connected".
    await db
      .update(teamSettingsTable)
      .set({
        icalUrl: null,
        icalAutoSync: false,
        icalLastSyncAt: null,
        icalLastSyncError: null,
        icalLastSyncCount: null,
        rowVersion: sql`${teamSettingsTable.rowVersion} + 1`,
      })
      .where(eq(teamSettingsTable.userId, userId));
    res.status(422).json({ error: result?.error ?? "Couldn't read that calendar." });
    return;
  }
  res.json(result);
});

router.post("/calendar/sync", assertPermission("partial"), async (req, res): Promise<void> => {
  const result = await syncTeamCalendar(req.ownerUserId!);
  if (!result) {
    res.status(404).json({ error: "No calendar is connected." });
    return;
  }
  res.json(result);
});

// MBL team finder (see lib/mbl.ts). Read-only lookups against mbl.bz.
const idParam = z.coerce.number().int().positive();

async function mblLookup<T>(res: import("express").Response, load: () => Promise<T>): Promise<void> {
  try {
    res.json(await load());
  } catch (err) {
    logger.warn({ err }, "mbl lookup failed");
    res.status(502).json({ error: "Couldn't reach mbl.bz right now. Try again in a minute." });
  }
}

router.get("/calendar/mbl/seasons", assertPermission("partial"), (_req, res) =>
  mblLookup(res, listMblSeasons),
);

router.get("/calendar/mbl/seasons/:seasonId/associations", assertPermission("partial"), (req, res) => {
  const seasonId = idParam.safeParse(req.params.seasonId);
  if (!seasonId.success) return void res.status(400).json({ error: "Bad season" });
  return mblLookup(res, () => listMblAssociations(seasonId.data));
});

router.get("/calendar/mbl/seasons/:seasonId/teams", assertPermission("partial"), (req, res) => {
  const seasonId = idParam.safeParse(req.params.seasonId);
  const associationId = idParam.safeParse(req.query.associationId);
  if (!seasonId.success || !associationId.success) return void res.status(400).json({ error: "Pick an association" });
  return mblLookup(res, async () =>
    (await listMblTeams(seasonId.data, associationId.data)).map((t) => ({ ...t, feedUrl: mblTeamFeedUrl(t.id) })),
  );
});

// Games already pulled in stay on the schedule; they just stop updating.
router.delete("/calendar", assertPermission("full"), async (req, res): Promise<void> => {
  await db
    .update(teamSettingsTable)
    .set({
      icalUrl: null,
      icalAutoSync: false,
      icalLastSyncAt: null,
      icalLastSyncError: null,
      icalLastSyncCount: null,
      rowVersion: sql`${teamSettingsTable.rowVersion} + 1`,
    })
    .where(eq(teamSettingsTable.userId, req.ownerUserId!));
  res.status(204).send();
});

export default router;
