import { Router, type IRouter } from "express";
import { and, count, countDistinct, desc, eq, gte, inArray, isNull, max } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
  teamMembershipsTable,
  teamSettingsTable,
  playersTable,
  gamesTable,
  aiUsageLogTable,
  coachActivityPingsTable,
  DEFAULT_TEAM_NAME,
  DEFAULT_TEAM_SHORT_NAME,
} from "@workspace/db";
import { requireMasterAdmin } from "../middlewares/requireMasterAdmin";
import { isMasterAdmin } from "../lib/permissions";
import { AI_DAILY_TEAM_BUDGET } from "../lib/ai-usage";

const router: IRouter = Router();

/**
 * GET /api/admin/me — any signed-in user can call this; returns whether
 * they're in the master-admin allow-list. The web UI uses this to
 * decide whether to render the "Admin" nav item.
 */
router.get("/admin/me", (req, res): void => {
  res.json({ isMasterAdmin: isMasterAdmin(req.userId) });
});

interface ClerkLite {
  email: string | null;
  name: string | null;
}

async function fetchClerkLite(userId: string): Promise<ClerkLite> {
  try {
    const u = await clerkClient.users.getUser(userId);
    const email =
      u.primaryEmailAddress?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      null;
    const name =
      [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || null;
    return { email, name };
  } catch {
    return { email: null, name: null };
  }
}

/**
 * Batched Clerk profile lookup. Returns a Map keyed by userId so the
 * caller can do `map.get(id) ?? { email:null, name:null }` instead of
 * issuing one HTTP request per row. Clerk's `getUserList` accepts up
 * to 500 ids per call but we chunk at 100 to stay well under any
 * future tightening and keep individual responses small. Unknown ids
 * (deleted Clerk accounts) silently fall through — the caller's
 * default kicks in.
 */
async function fetchClerkLiteMany(
  userIds: readonly string[],
): Promise<Map<string, ClerkLite>> {
  const out = new Map<string, ClerkLite>();
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return out;
  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      const resp = await clerkClient.users.getUserList({
        userId: chunk,
        limit: chunk.length,
      });
      const data = Array.isArray(resp) ? resp : resp.data;
      for (const u of data) {
        const email =
          u.primaryEmailAddress?.emailAddress ??
          u.emailAddresses[0]?.emailAddress ??
          null;
        const name =
          [u.firstName, u.lastName].filter(Boolean).join(" ") ||
          u.username ||
          null;
        out.set(u.id, { email, name });
      }
    } catch {
      // Whole chunk failed (rate limit, network) — leave entries
      // unset and let callers fall back to {email:null,name:null}.
    }
  }
  return out;
}

// Everything below requires master admin.
router.use("/admin", requireMasterAdmin);

/**
 * GET /api/admin/teams — list every team (one per distinct owner). For
 * each team include team name + member/game/player counts + a Clerk
 * profile snippet for the owner.
 */
router.get("/admin/teams", async (_req, res): Promise<void> => {
  // Distinct owners — union of two sources:
  //   (a) users with an `isOwner = true` row in team_memberships
  //       (the modern signup path always writes one of these), and
  //   (b) users who have at least one active (non-soft-deleted) player
  //       on their roster. This second source brings back accounts
  //       created before the `isOwner` row was being seeded — they
  //       still own a team and have real data, but were getting hidden
  //       from the admin list because their membership row was never
  //       written. A coach who only JOINED someone else's team via
  //       invite never owns players under their own user_id, so they
  //       still won't show up here.
  // Three sources, unioned:
  //   (a) `isOwner=true` rows in team_memberships (modern signup path)
  //   (b) users with at least one active player (legacy accounts whose
  //       owner-row was never seeded, but still have real roster data)
  //   (c) users with a team_settings row (covers the in-between case
  //       where an account customized team identity / branding but
  //       hasn't built a roster yet AND somehow has no isOwner row —
  //       e.g. settings written via a code path that bypassed
  //       ensureOwnerMembership). These show up as zero-member teams
  //       under "Show empty teams".
  const [ownersFromMemberships, ownersFromPlayers, ownersFromSettings] =
    await Promise.all([
      db
        .selectDistinct({ ownerUserId: teamMembershipsTable.ownerUserId })
        .from(teamMembershipsTable)
        .where(eq(teamMembershipsTable.isOwner, true)),
      db
        .selectDistinct({ userId: playersTable.userId })
        .from(playersTable)
        .where(isNull(playersTable.deletedAt)),
      db.selectDistinct({ userId: teamSettingsTable.userId }).from(teamSettingsTable),
    ]);
  const owners = Array.from(
    new Set([
      ...ownersFromMemberships.map((r) => r.ownerUserId),
      ...ownersFromPlayers.map((r) => r.userId),
      ...ownersFromSettings.map((r) => r.userId),
    ]),
  );

  if (owners.length === 0) {
    res.json([]);
    return;
  }

  // Pull team labels in one go.
  const settingsRows = await db
    .select()
    .from(teamSettingsTable)
    .where(inArray(teamSettingsTable.userId, owners));
  const settingsMap = new Map(settingsRows.map((r) => [r.userId, r] as const));

  // Member counts per team (count rows in team_memberships).
  const memberCountRows = await db
    .select({
      ownerUserId: teamMembershipsTable.ownerUserId,
      memberCount: count(teamMembershipsTable.id),
    })
    .from(teamMembershipsTable)
    .where(inArray(teamMembershipsTable.ownerUserId, owners))
    .groupBy(teamMembershipsTable.ownerUserId);
  const memberCountMap = new Map(
    memberCountRows.map((r) => [r.ownerUserId, Number(r.memberCount)] as const),
  );

  // Game counts + last-activity per team.
  const gameStatsRows = await db
    .select({
      userId: gamesTable.userId,
      gameCount: count(gamesTable.id),
      lastActivityAt: max(gamesTable.gameDate),
    })
    .from(gamesTable)
    .where(inArray(gamesTable.userId, owners))
    .groupBy(gamesTable.userId);
  const gameStatsMap = new Map(gameStatsRows.map((r) => [r.userId, r] as const));

  // Player counts per team.
  const playerCountRows = await db
    .select({
      userId: playersTable.userId,
      playerCount: count(playersTable.id),
    })
    .from(playersTable)
    .where(inArray(playersTable.userId, owners))
    .groupBy(playersTable.userId);
  const playerCountMap = new Map(
    playerCountRows.map((r) => [r.userId, Number(r.playerCount)] as const),
  );

  const clerkMap = await fetchClerkLiteMany(owners);
  const enriched = owners.map((oid) => {
    const settings = settingsMap.get(oid);
    const lite = clerkMap.get(oid) ?? { email: null, name: null };
    const stats = gameStatsMap.get(oid);
    return {
      ownerUserId: oid,
      ownerEmail: lite.email,
      ownerName: lite.name,
      teamName: settings?.teamName ?? DEFAULT_TEAM_NAME,
      teamShortName: settings?.teamShortName ?? DEFAULT_TEAM_SHORT_NAME,
      memberCount: memberCountMap.get(oid) ?? 0,
      gameCount: stats ? Number(stats.gameCount) : 0,
      playerCount: playerCountMap.get(oid) ?? 0,
      lastActivityAt: stats?.lastActivityAt ?? null,
    };
  });

  // Sort by activity desc — most active teams first.
  enriched.sort((a, b) => {
    const aT = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
    const bT = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
    return bT - aT;
  });

  res.json(enriched);
});

/**
 * GET /api/admin/teams/:ownerUserId — drill into one team. Returns
 * coaches (with profile info) + recent games + settings snapshot.
 */
router.get("/admin/teams/:ownerUserId", async (req, res): Promise<void> => {
  const ownerUserId = req.params.ownerUserId;
  if (!ownerUserId) {
    res.status(400).json({ error: "ownerUserId required" });
    return;
  }

  const [settings] = await db
    .select()
    .from(teamSettingsTable)
    .where(eq(teamSettingsTable.userId, ownerUserId));

  const memberRows = await db
    .select()
    .from(teamMembershipsTable)
    .where(eq(teamMembershipsTable.ownerUserId, ownerUserId))
    .orderBy(desc(teamMembershipsTable.isOwner), desc(teamMembershipsTable.joinedAt));

  // Single batched Clerk lookup for everyone we'll render: owner +
  // all members. Falls back to {null,null} per id if Clerk is down.
  const memberClerkMap = await fetchClerkLiteMany([
    ownerUserId,
    ...memberRows.map((m) => m.memberUserId),
  ]);
  const members = memberRows.map((m) => {
    const lite = memberClerkMap.get(m.memberUserId) ?? { email: null, name: null };
    return {
      memberUserId: m.memberUserId,
      memberEmail: m.memberEmail ?? lite.email,
      memberName: lite.name,
      displayName: m.displayName,
      role: m.role,
      permission: m.permission,
      isOwner: m.isOwner,
      joinedAt: m.joinedAt,
    };
  });

  const recentGames = await db
    .select({
      id: gamesTable.id,
      opponent: gamesTable.opponent,
      gameDate: gamesTable.gameDate,
      status: gamesTable.status,
    })
    .from(gamesTable)
    .where(eq(gamesTable.userId, ownerUserId))
    .orderBy(desc(gamesTable.gameDate))
    .limit(20);

  const ownerLite =
    memberClerkMap.get(ownerUserId) ?? { email: null, name: null };

  res.json({
    ownerUserId,
    ownerEmail: ownerLite.email,
    ownerName: ownerLite.name,
    teamName: settings?.teamName ?? DEFAULT_TEAM_NAME,
    teamShortName: settings?.teamShortName ?? DEFAULT_TEAM_SHORT_NAME,
    members,
    recentGames,
  });
});

/**
 * GET /api/admin/users — every distinct Clerk user that appears as
 * either an owner or a member, with the teams they belong to. Also
 * decorated with activity rollups from coach_activity_pings (1-min
 * heartbeat granularity, written by the web client while a tab is
 * open).
 */
router.get("/admin/users", async (_req, res): Promise<void> => {
  const allRows = await db
    .select({
      userId: teamMembershipsTable.memberUserId,
      ownerUserId: teamMembershipsTable.ownerUserId,
      isOwner: teamMembershipsTable.isOwner,
      displayName: teamMembershipsTable.displayName,
      role: teamMembershipsTable.role,
      permission: teamMembershipsTable.permission,
    })
    .from(teamMembershipsTable);

  // Activity rollups — one query per window (last24h / 7d / 30d) plus
  // a single MAX query for last-seen. At expected scale (a few dozen
  // coaches × ~60 pings/hour while open) the table stays small enough
  // that the indexed (member_user_id, bucket_minute) PK keeps these
  // GROUP BYs cheap. Each bucket_minute counted = 1 active minute.
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const [m24Rows, m7Rows, m30Rows, lastSeenRows] = await Promise.all([
    db
      .select({
        userId: coachActivityPingsTable.memberUserId,
        n: countDistinct(coachActivityPingsTable.bucketMinute),
      })
      .from(coachActivityPingsTable)
      .where(gte(coachActivityPingsTable.bucketMinute, since24h))
      .groupBy(coachActivityPingsTable.memberUserId),
    db
      .select({
        userId: coachActivityPingsTable.memberUserId,
        n: countDistinct(coachActivityPingsTable.bucketMinute),
      })
      .from(coachActivityPingsTable)
      .where(gte(coachActivityPingsTable.bucketMinute, since7d))
      .groupBy(coachActivityPingsTable.memberUserId),
    db
      .select({
        userId: coachActivityPingsTable.memberUserId,
        n: countDistinct(coachActivityPingsTable.bucketMinute),
      })
      .from(coachActivityPingsTable)
      .where(gte(coachActivityPingsTable.bucketMinute, since30d))
      .groupBy(coachActivityPingsTable.memberUserId),
    db
      .select({
        userId: coachActivityPingsTable.memberUserId,
        lastSeenAt: max(coachActivityPingsTable.bucketMinute),
      })
      .from(coachActivityPingsTable)
      .groupBy(coachActivityPingsTable.memberUserId),
  ]);
  const m24Map = new Map(m24Rows.map((r) => [r.userId, Number(r.n)] as const));
  const m7Map = new Map(m7Rows.map((r) => [r.userId, Number(r.n)] as const));
  const m30Map = new Map(m30Rows.map((r) => [r.userId, Number(r.n)] as const));
  const lastSeenMap = new Map(
    lastSeenRows.map((r) => [r.userId, r.lastSeenAt] as const),
  );

  // Group by user.
  const byUser = new Map<
    string,
    {
      userId: string;
      teams: Array<{
        ownerUserId: string;
        isOwner: boolean;
        displayName: string | null;
        role: string | null;
        permission: string;
      }>;
    }
  >();
  for (const r of allRows) {
    if (!byUser.has(r.userId)) {
      byUser.set(r.userId, { userId: r.userId, teams: [] });
    }
    byUser.get(r.userId)!.teams.push({
      ownerUserId: r.ownerUserId,
      isOwner: r.isOwner,
      displayName: r.displayName,
      role: r.role,
      permission: r.permission,
    });
  }

  // Surface users that have activity pings but no team_memberships
  // row (rare — would only happen if someone pinged before the
  // ensureOwnerMembership upsert ran). Empty teams list, but they
  // still get last-seen + minutes so they aren't invisible.
  for (const userId of lastSeenMap.keys()) {
    if (!byUser.has(userId)) {
      byUser.set(userId, { userId, teams: [] });
    }
  }

  const usersClerkMap = await fetchClerkLiteMany(
    Array.from(byUser.keys()),
  );
  const users = Array.from(byUser.values()).map((u) => {
    const lite = usersClerkMap.get(u.userId) ?? { email: null, name: null };
    const lastSeen = lastSeenMap.get(u.userId) ?? null;
    return {
        userId: u.userId,
        email: lite.email,
        name: lite.name,
        teams: u.teams,
        lastSeenAt: lastSeen
          ? lastSeen instanceof Date
            ? lastSeen.toISOString()
            : new Date(lastSeen).toISOString()
          : null,
        minutesActive24h: m24Map.get(u.userId) ?? 0,
        minutesActive7d: m7Map.get(u.userId) ?? 0,
        minutesActive30d: m30Map.get(u.userId) ?? 0,
    };
  });

  // Sort by most-recently-active first; users without any activity
  // sink to the bottom and there sort by name/email for predictable
  // output.
  users.sort((a, b) => {
    const aT = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
    const bT = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
    if (bT !== aT) return bT - aT;
    const aKey = (a.name ?? a.email ?? a.userId).toLowerCase();
    const bKey = (b.name ?? b.email ?? b.userId).toLowerCase();
    return aKey.localeCompare(bKey);
  });

  res.json(users);
});

/**
 * GET /api/admin/ai-usage — per-team OpenAI usage rollups + grand
 * totals for the master-admin dashboard. Master admins are excluded
 * from the log entirely (their calls are exempt and unrecorded), so
 * these numbers reflect real customer usage. Sorted by last-24h
 * volume descending so hot teams float to the top.
 */
router.get("/admin/ai-usage", async (_req, res): Promise<void> => {
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000);

  // Pull every row from the last 30 days in one query and aggregate in
  // memory — at expected scale (10s of teams × dozens of calls/day)
  // the table is tiny and a single scan keeps the endpoint simple +
  // round-trip-cheap. If this ever gets large, replace with three
  // GROUP BY (ownerUserId) queries against the indexed (owner, created)
  // pair, one per window.
  const rows = await db
    .select({
      ownerUserId: aiUsageLogTable.ownerUserId,
      feature: aiUsageLogTable.feature,
      createdAt: aiUsageLogTable.createdAt,
    })
    .from(aiUsageLogTable)
    .where(gte(aiUsageLogTable.createdAt, since30d));

  type PerTeam = {
    ownerUserId: string;
    last24h: number;
    last7d: number;
    last30d: number;
    lastCallAt: Date | null;
    featureCounts: Record<string, number>;
  };
  const byTeam = new Map<string, PerTeam>();
  let total24h = 0;
  let total7d = 0;
  let total30d = 0;

  for (const r of rows) {
    const created = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
    let bucket = byTeam.get(r.ownerUserId);
    if (!bucket) {
      bucket = {
        ownerUserId: r.ownerUserId,
        last24h: 0,
        last7d: 0,
        last30d: 0,
        lastCallAt: null,
        featureCounts: {},
      };
      byTeam.set(r.ownerUserId, bucket);
    }
    bucket.last30d += 1;
    total30d += 1;
    if (created >= since7d) {
      bucket.last7d += 1;
      total7d += 1;
      // featureCounts is the 7d feature breakdown — recent and useful
      // for spotting which surface a team is hammering.
      bucket.featureCounts[r.feature] = (bucket.featureCounts[r.feature] ?? 0) + 1;
    }
    if (created >= since24h) {
      bucket.last24h += 1;
      total24h += 1;
    }
    if (!bucket.lastCallAt || created > bucket.lastCallAt) {
      bucket.lastCallAt = created;
    }
  }

  // Enrich with team name + owner profile.
  const ownerIds = Array.from(byTeam.keys());
  const settingsMap = new Map<string, { teamName: string; teamShortName: string }>();
  if (ownerIds.length > 0) {
    const settingsRows = await db
      .select()
      .from(teamSettingsTable)
      .where(inArray(teamSettingsTable.userId, ownerIds));
    for (const s of settingsRows) {
      settingsMap.set(s.userId, {
        teamName: s.teamName ?? DEFAULT_TEAM_NAME,
        teamShortName: s.teamShortName ?? DEFAULT_TEAM_SHORT_NAME,
      });
    }
  }

  const aiClerkMap = await fetchClerkLiteMany(ownerIds);
  const perTeam = Array.from(byTeam.values()).map((b) => {
    const lite = aiClerkMap.get(b.ownerUserId) ?? { email: null, name: null };
    const settings = settingsMap.get(b.ownerUserId);
    return {
      ownerUserId: b.ownerUserId,
      teamName: settings?.teamName ?? DEFAULT_TEAM_NAME,
      teamShortName: settings?.teamShortName ?? DEFAULT_TEAM_SHORT_NAME,
      ownerName: lite.name,
      ownerEmail: lite.email,
      last24h: b.last24h,
      last7d: b.last7d,
      last30d: b.last30d,
      lastCallAt: b.lastCallAt ? b.lastCallAt.toISOString() : null,
      featureCounts: b.featureCounts,
    };
  });

  perTeam.sort((a, b) => {
    if (b.last24h !== a.last24h) return b.last24h - a.last24h;
    if (b.last7d !== a.last7d) return b.last7d - a.last7d;
    return b.last30d - a.last30d;
  });

  res.json({
    budgetPerDay: AI_DAILY_TEAM_BUDGET,
    totals: { last24h: total24h, last7d: total7d, last30d: total30d },
    perTeam,
  });
});

export default router;
