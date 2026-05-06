import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, max } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
  teamMembershipsTable,
  teamSettingsTable,
  playersTable,
  gamesTable,
  DEFAULT_TEAM_NAME,
  DEFAULT_TEAM_SHORT_NAME,
} from "@workspace/db";
import { requireMasterAdmin } from "../middlewares/requireMasterAdmin";
import { isMasterAdmin } from "../lib/permissions";

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

// Everything below requires master admin.
router.use("/admin", requireMasterAdmin);

/**
 * GET /api/admin/teams — list every team (one per distinct owner). For
 * each team include team name + member/game/player counts + a Clerk
 * profile snippet for the owner.
 */
router.get("/admin/teams", async (_req, res): Promise<void> => {
  // Distinct owners — only users who actually OWN a team (have an
  // `isOwner = true` row in team_memberships). A coach who joined
  // someone else's team has a team_settings row seeded for them on
  // first sign-in, but they should not show up as their own team in
  // the admin list — so we deliberately do NOT fall back to
  // team_settings here.
  const ownersFromMemberships = await db
    .selectDistinct({ ownerUserId: teamMembershipsTable.ownerUserId })
    .from(teamMembershipsTable)
    .where(eq(teamMembershipsTable.isOwner, true));
  const owners = Array.from(
    new Set(ownersFromMemberships.map((r) => r.ownerUserId)),
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

  const enriched = await Promise.all(
    owners.map(async (oid) => {
      const settings = settingsMap.get(oid);
      const lite = await fetchClerkLite(oid);
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
    }),
  );

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

  const members = await Promise.all(
    memberRows.map(async (m) => {
      const lite = await fetchClerkLite(m.memberUserId);
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
    }),
  );

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

  const ownerLite = await fetchClerkLite(ownerUserId);

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
 * either an owner or a member, with the teams they belong to.
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

  const users = await Promise.all(
    Array.from(byUser.values()).map(async (u) => {
      const lite = await fetchClerkLite(u.userId);
      return {
        userId: u.userId,
        email: lite.email,
        name: lite.name,
        teams: u.teams,
      };
    }),
  );

  // Sort by name/email for predictable output.
  users.sort((a, b) => {
    const aKey = (a.name ?? a.email ?? a.userId).toLowerCase();
    const bKey = (b.name ?? b.email ?? b.userId).toLowerCase();
    return aKey.localeCompare(bKey);
  });

  res.json(users);
});

export default router;
