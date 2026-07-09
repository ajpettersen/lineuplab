import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, gt } from "drizzle-orm";
import {
  parseIfMatch,
  rejectBadIfMatch,
  sendConflict,
  versionedUpdate,
} from "../lib/concurrency";
import { z } from "zod";
import crypto from "node:crypto";
import { clerkClient } from "@clerk/express";
import {
  db,
  teamMembershipsTable,
  teamInvitesTable,
  teamSettingsTable,
  userActiveTeamTable,
  ensureOwnerMembership,
  isPermissionTier,
  DEFAULT_TEAM_NAME,
  DEFAULT_TEAM_SHORT_NAME,
  type PermissionTier,
} from "@workspace/db";
import { assertPermission, isMasterAdmin, isTeamOwnerUser } from "../lib/permissions";

const router: IRouter = Router();

const INVITE_TTL_DAYS = 7;
const TOKEN_BYTES = 24; // → 32 base64url chars

function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Look up team_settings rows for a list of owner ids and return a
 * `{ ownerUserId → { teamName, teamShortName } }` map. Owners with no
 * row yet (haven't customized branding) appear with the default labels
 * so the UI never shows blanks.
 */
async function fetchTeamLabels(
  ownerUserIds: string[],
): Promise<Record<string, { teamName: string; teamShortName: string }>> {
  const map: Record<string, { teamName: string; teamShortName: string }> = {};
  for (const id of ownerUserIds) {
    map[id] = {
      teamName: DEFAULT_TEAM_NAME,
      teamShortName: DEFAULT_TEAM_SHORT_NAME,
    };
  }
  if (ownerUserIds.length === 0) return map;
  const rows = await db
    .select({
      userId: teamSettingsTable.userId,
      teamName: teamSettingsTable.teamName,
      teamShortName: teamSettingsTable.teamShortName,
    })
    .from(teamSettingsTable)
    .where(inArray(teamSettingsTable.userId, ownerUserIds));
  for (const r of rows) {
    map[r.userId] = { teamName: r.teamName, teamShortName: r.teamShortName };
  }
  return map;
}

/**
 * GET /api/team/context — all data the client needs to show the team
 * switcher and the "Coaches" UI on Settings:
 *   - which team the user is currently acting on
 *   - whether they own that team
 *   - the user's own team (always available)
 *   - any other teams they belong to as a coach
 */
router.get("/team/context", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const ownerUserId = req.ownerUserId!;

  // Idempotently make sure the user has an owner-row in their OWN team
  // so subsequent profile reads/writes have something to update. We do
  // this here (vs in resolveTeamContext) because /team/context is loaded
  // once at app start, not on every API request — keeps the hot path
  // free of the extra SELECT/INSERT round trip.
  let ownerEmail: string | null = null;
  try {
    const u = await clerkClient.users.getUser(userId);
    ownerEmail =
      u.primaryEmailAddress?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      null;
  } catch (err) {
    req.log.warn({ err }, "Failed to fetch owner email from Clerk");
  }
  await ensureOwnerMembership(userId, ownerEmail);

  // Look up the calling user's profile row for the ACTIVE team. For
  // owners on their own team this is the just-ensured owner-row; for
  // assistant coaches it's their member-row created at invite-accept.
  // Master admins switched into a foreign team won't have a row at all
  // — synthesize a 'full' tier so the UI doesn't think they're locked
  // out.
  const [profileRow] = await db
    .select()
    .from(teamMembershipsTable)
    .where(
      and(
        eq(teamMembershipsTable.ownerUserId, ownerUserId),
        eq(teamMembershipsTable.memberUserId, userId),
      ),
    );

  const adminBypass = !profileRow && isMasterAdmin(userId);
  const permission: PermissionTier = profileRow
    ? (isPermissionTier(profileRow.permission) ? profileRow.permission : "view")
    : adminBypass
      ? "full"
      : "view";
  const displayName = profileRow?.displayName ?? null;
  const role = profileRow?.role ?? null;
  // Owner-row counts as profile-complete only when displayName is set;
  // master-admin bypass is implicitly complete (they don't get prompted).
  const profileComplete = adminBypass
    ? true
    : !!displayName && displayName.trim().length >= 2;

  // ALL memberships for this user, split into teams they own (their
  // personal team + any additional teams created via POST /api/teams)
  // vs teams they joined as an assistant coach.
  const memberships = await db
    .select({
      ownerUserId: teamMembershipsTable.ownerUserId,
      isOwner: teamMembershipsTable.isOwner,
    })
    .from(teamMembershipsTable)
    .where(eq(teamMembershipsTable.memberUserId, userId));

  const extraOwnedIds = memberships
    .filter((m) => m.isOwner && m.ownerUserId !== userId)
    .map((m) => m.ownerUserId);
  const otherOwnerIds = memberships
    .filter((m) => !m.isOwner)
    .map((m) => m.ownerUserId);
  const allOwnerIds = Array.from(
    new Set([userId, ...extraOwnedIds, ...otherOwnerIds]),
  );
  const labels = await fetchTeamLabels(allOwnerIds);
  const toSummary = (oid: string) => ({
    ownerUserId: oid,
    teamName: labels[oid]!.teamName,
    teamShortName: labels[oid]!.teamShortName,
  });

  res.json({
    userId,
    activeOwnerUserId: ownerUserId,
    isOwner: userId === ownerUserId || profileRow?.isOwner === true,
    ownedTeam: toSummary(userId),
    // Personal team first, then additional owned teams by creation
    // order (membership id ascending is close enough — ids are serial).
    ownedTeams: [userId, ...extraOwnedIds].map(toSummary),
    memberOf: otherOwnerIds.map(toSummary),
    currentUser: {
      displayName,
      role,
      permission,
      profileComplete,
      isMasterAdmin: isMasterAdmin(userId),
    },
  });
});

const CreateTeamBody = z.object({
  teamName: z.string().trim().min(2, "Team name is too short").max(60),
  teamShortName: z.string().trim().min(1).max(20).optional(),
});

/**
 * POST /api/teams — create an ADDITIONAL team owned by the calling
 * user (e.g. a new season/year, or a second squad). The team gets a
 * synthetic scope key (`team_<uuid>`) that flows through the exact
 * same tenancy plumbing as a personal team:
 *   - team_settings row keyed by the synthetic id (name/branding)
 *   - team_memberships owner-row (isOwner = true, permission 'full')
 *     so resolveTeamContext + permission checks work unchanged
 *   - user_active_team pointer switched to the new team so the very
 *     next request scopes to it
 *
 * The creator's coach profile (displayName/role) is carried over from
 * their personal owner-row so they aren't re-prompted for their name.
 */
router.post("/teams", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = CreateTeamBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const teamName = parsed.data.teamName;
  const teamShortName =
    parsed.data.teamShortName?.trim() ||
    (teamName.split(/\s+/)[0] ?? DEFAULT_TEAM_SHORT_NAME).slice(0, 20);

  const teamKey = `team_${crypto.randomUUID()}`;

  // Carry the coach's profile over from their personal owner-row (if
  // they have one) so the new team doesn't re-prompt for display name.
  const [personalRow] = await db
    .select()
    .from(teamMembershipsTable)
    .where(
      and(
        eq(teamMembershipsTable.ownerUserId, userId),
        eq(teamMembershipsTable.memberUserId, userId),
      ),
    );

  await db.transaction(async (tx) => {
    await tx.insert(teamSettingsTable).values({
      userId: teamKey,
      teamName,
      teamShortName,
    });
    await tx.insert(teamMembershipsTable).values({
      ownerUserId: teamKey,
      memberUserId: userId,
      memberEmail: personalRow?.memberEmail ?? null,
      displayName: personalRow?.displayName ?? null,
      role: personalRow?.role ?? null,
      isOwner: true,
      permission: "full",
    });
    await tx
      .insert(userActiveTeamTable)
      .values({ userId, activeOwnerUserId: teamKey })
      .onConflictDoUpdate({
        target: userActiveTeamTable.userId,
        set: { activeOwnerUserId: teamKey, updatedAt: new Date() },
      });
  });

  req.log.info({ teamKey }, "Created additional team");
  res.status(201).json({ ownerUserId: teamKey, teamName, teamShortName });
});

const ActiveBody = z.object({ ownerUserId: z.string().min(1) });

/**
 * POST /api/team/active — switch which team the user is currently on.
 * Validates that the target team is either the user's own or one they're
 * a member of. Persists to user_active_team so subsequent requests
 * resolve to the same scope.
 */
router.post("/team/active", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = ActiveBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ownerUserId required" });
    return;
  }
  const target = parsed.data.ownerUserId;

  if (target !== userId) {
    // Master admins can switch into ANY team without being a member
    // — that's the whole point of master admin (debug/support a team
    // without provisioning a coach row first).
    if (!isMasterAdmin(userId)) {
      const [m] = await db
        .select({ id: teamMembershipsTable.id })
        .from(teamMembershipsTable)
        .where(
          and(
            eq(teamMembershipsTable.ownerUserId, target),
            eq(teamMembershipsTable.memberUserId, userId),
          ),
        );
      if (!m) {
        res.status(403).json({ error: "Not a member of that team" });
        return;
      }
    }
  }

  await db
    .insert(userActiveTeamTable)
    .values({ userId, activeOwnerUserId: target })
    .onConflictDoUpdate({
      target: userActiveTeamTable.userId,
      set: { activeOwnerUserId: target, updatedAt: new Date() },
    });

  res.json({ activeOwnerUserId: target });
});

/**
 * GET /api/team/invites — list all invites for the current team. Any
 * active coach on the team can see + manage invites (the user chose
 * "full co-owner access").
 */
router.get("/team/invites", async (req, res): Promise<void> => {
  const ownerUserId = req.ownerUserId!;
  const rows = await db
    .select()
    .from(teamInvitesTable)
    .where(eq(teamInvitesTable.ownerUserId, ownerUserId))
    .orderBy(desc(teamInvitesTable.createdAt));
  res.json(
    rows.map((r) => ({
      id: r.id,
      token: r.token,
      label: r.label,
      invitedEmail: r.invitedEmail,
      sentEmailAt: r.sentEmailAt,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      acceptedAt: r.acceptedAt,
      acceptedByUserId: r.acceptedByUserId,
    })),
  );
});

const CreateInviteBody = z.object({
  label: z.string().trim().max(60).optional(),
  // Optional email the invite is intended for. Stored for future
  // email-delivery; today the coach still copies the link manually.
  email: z.string().trim().email("Enter a valid email").max(120).optional(),
});

router.post("/team/invites", assertPermission("full"), async (req, res): Promise<void> => {
  const ownerUserId = req.ownerUserId!;
  const parsed = CreateInviteBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(teamInvitesTable)
    .values({
      ownerUserId,
      token: generateToken(),
      label: parsed.data.label?.trim() || null,
      invitedEmail: parsed.data.email?.toLowerCase() || null,
      expiresAt,
    })
    .returning();
  res.status(201).json({
    id: row!.id,
    token: row!.token,
    label: row!.label,
    invitedEmail: row!.invitedEmail,
    sentEmailAt: row!.sentEmailAt,
    createdAt: row!.createdAt,
    expiresAt: row!.expiresAt,
    revokedAt: row!.revokedAt,
    acceptedAt: row!.acceptedAt,
  });
});

router.delete("/team/invites/:id", assertPermission("full"), async (req, res): Promise<void> => {
  const ownerUserId = req.ownerUserId!;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .update(teamInvitesTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(teamInvitesTable.id, id),
        eq(teamInvitesTable.ownerUserId, ownerUserId),
        // Only revoke pending invites — already-accepted ones aren't
        // useful to revoke here (use DELETE /team/members instead).
        isNull(teamInvitesTable.acceptedAt),
        isNull(teamInvitesTable.revokedAt),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }
  res.sendStatus(204);
});

/**
 * GET /api/team/members — list ALL coaches on the current team
 * including the head coach (whose row is `isOwner = true`). Each row is
 * augmented with the member's email/name from Clerk for fallback
 * display when they haven't set their own `displayName`.
 *
 * Owner-row first (sorted by `isOwner desc`), then assistants by
 * join date so the head coach is always at the top of the list.
 */
router.get("/team/members", async (req, res): Promise<void> => {
  const ownerUserId = req.ownerUserId!;
  const rows = await db
    .select()
    .from(teamMembershipsTable)
    .where(eq(teamMembershipsTable.ownerUserId, ownerUserId))
    .orderBy(desc(teamMembershipsTable.isOwner), desc(teamMembershipsTable.joinedAt));

  const enriched = await Promise.all(
    rows.map(async (r) => {
      let email = r.memberEmail;
      let name: string | null = null;
      try {
        const u = await clerkClient.users.getUser(r.memberUserId);
        email =
          u.primaryEmailAddress?.emailAddress ??
          u.emailAddresses[0]?.emailAddress ??
          email;
        name =
          [u.firstName, u.lastName].filter(Boolean).join(" ") ||
          u.username ||
          null;
      } catch (err) {
        req.log.warn(
          { err, memberUserId: r.memberUserId },
          "Failed to fetch member from Clerk",
        );
      }
      return {
        id: r.id,
        memberUserId: r.memberUserId,
        memberEmail: email,
        memberName: name,
        displayName: r.displayName,
        role: r.role,
        permission: isPermissionTier(r.permission) ? r.permission : "view",
        isOwner: r.isOwner,
        joinedAt: r.joinedAt,
      };
    }),
  );

  res.json(enriched);
});

const UpdateMemberBody = z.object({
  displayName: z.string().trim().min(2).max(40).nullable().optional(),
  role: z.string().trim().max(40).nullable().optional(),
  permission: z.enum(["full", "partial", "upload", "view"]).optional(),
});

/**
 * PATCH /api/team/members/:memberUserId — update a coach's per-team
 * profile + permission tier.
 *
 * Authorization rules:
 *   - Anyone on the team can edit THEIR OWN displayName/role.
 *   - Only the actual team owner can edit ANYONE'S permission tier.
 *   - The owner-row's permission is locked to 'full' (the head coach
 *     can't demote themselves).
 *   - Master admins acting in another team's context get owner powers.
 */
router.patch("/team/members/:memberUserId", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const ownerUserId = req.ownerUserId!;
  const memberUserId = req.params.memberUserId;
  if (!memberUserId) {
    res.status(400).json({ error: "memberUserId required" });
    return;
  }
  const ifm = parseIfMatch(req);
  if (!ifm.ok) {
    rejectBadIfMatch(res);
    return;
  }
  const parsed = UpdateMemberBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const body = parsed.data;
  if (body.displayName === undefined && body.role === undefined && body.permission === undefined) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const isSelf = memberUserId === userId;
  const callerIsOwner =
    (await isTeamOwnerUser(userId, ownerUserId)) || isMasterAdmin(userId);

  // Permission edits require owner-equivalent authority.
  if (body.permission !== undefined && !callerIsOwner) {
    res.status(403).json({ error: "Only the head coach can change permissions" });
    return;
  }

  // Profile edits (displayName/role) require either self OR owner.
  if (
    (body.displayName !== undefined || body.role !== undefined) &&
    !isSelf &&
    !callerIsOwner
  ) {
    res.status(403).json({ error: "You can only edit your own profile" });
    return;
  }

  // Find the existing row.
  const [existing] = await db
    .select()
    .from(teamMembershipsTable)
    .where(
      and(
        eq(teamMembershipsTable.ownerUserId, ownerUserId),
        eq(teamMembershipsTable.memberUserId, memberUserId),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Coach not on this team" });
    return;
  }

  // Owner-row's permission is locked to 'full'.
  if (existing.isOwner && body.permission !== undefined && body.permission !== "full") {
    res.status(400).json({ error: "Head coach must keep full access" });
    return;
  }

  const updates: Partial<typeof teamMembershipsTable.$inferInsert> = {};
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.role !== undefined) updates.role = body.role;
  if (body.permission !== undefined) updates.permission = body.permission;

  const result = await versionedUpdate(db, teamMembershipsTable, {
    set: updates,
    where: eq(teamMembershipsTable.id, existing.id),
    ifMatch: ifm.version,
  });
  if (result.kind === "conflict") {
    sendConflict(res, result.current);
    return;
  }
  if (result.kind === "missing") {
    res.status(404).json({ error: "Coach not on this team" });
    return;
  }

  const updated = result.row;
  res.json({
    id: updated.id,
    memberUserId: updated.memberUserId,
    displayName: updated.displayName,
    role: updated.role,
    permission: isPermissionTier(updated.permission) ? updated.permission : "view",
    isOwner: updated.isOwner,
  });
});

router.delete("/team/members/:memberUserId", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const ownerUserId = req.ownerUserId!;
  const memberUserId = req.params.memberUserId;
  if (!memberUserId) {
    res.status(400).json({ error: "memberUserId required" });
    return;
  }
  // Allow self-removal (a coach leaves the team) without an owner-tier
  // permission check; otherwise require 'full' access (head coach can
  // remove any other coach). Refuse to delete the owner-row entirely
  // — the head coach can't kick themselves off their own team. The
  // owner-row check must look at `isOwner` (not `memberUserId ===
  // ownerUserId`) because on additional teams the scope key is a
  // synthetic id, not the owner's userId.
  const [targetRow] = await db
    .select({ isOwner: teamMembershipsTable.isOwner })
    .from(teamMembershipsTable)
    .where(
      and(
        eq(teamMembershipsTable.ownerUserId, ownerUserId),
        eq(teamMembershipsTable.memberUserId, memberUserId),
      ),
    );
  if (targetRow?.isOwner) {
    res.status(400).json({ error: "Head coach can't be removed from their own team" });
    return;
  }
  if (memberUserId !== userId) {
    // Not self-removal — caller must have full access.
    const callerIsOwner =
      (await isTeamOwnerUser(userId, ownerUserId)) || isMasterAdmin(userId);
    if (!callerIsOwner) {
      const [callerRow] = await db
        .select({ permission: teamMembershipsTable.permission })
        .from(teamMembershipsTable)
        .where(
          and(
            eq(teamMembershipsTable.ownerUserId, ownerUserId),
            eq(teamMembershipsTable.memberUserId, userId),
          ),
        );
      if (!callerRow || callerRow.permission !== "full") {
        res.status(403).json({ error: "Only the head coach can remove other coaches" });
        return;
      }
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(teamMembershipsTable)
      .where(
        and(
          eq(teamMembershipsTable.ownerUserId, ownerUserId),
          eq(teamMembershipsTable.memberUserId, memberUserId),
        ),
      );
    // If the removed coach was actively switched into this team, drop
    // their pointer so their next request falls back to their own team.
    await tx
      .delete(userActiveTeamTable)
      .where(
        and(
          eq(userActiveTeamTable.userId, memberUserId),
          eq(userActiveTeamTable.activeOwnerUserId, ownerUserId),
        ),
      );
  });
  res.sendStatus(204);
});

/**
 * GET /api/invites/:token — preview an invite before accepting. Auth
 * required (the user must sign in first), but the response is benign
 * even for already-consumed tokens so the join page can render an
 * informative error.
 */
router.get("/invites/:token", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const token = req.params.token ?? "";
  const [invite] = await db
    .select()
    .from(teamInvitesTable)
    .where(eq(teamInvitesTable.token, token));
  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  const labels = await fetchTeamLabels([invite.ownerUserId]);
  const team = labels[invite.ownerUserId]!;

  let status: "ok" | "revoked" | "expired" | "accepted" | "self" | "already_member" = "ok";
  if (invite.revokedAt) status = "revoked";
  else if (invite.acceptedAt) status = "accepted";
  else if (invite.expiresAt.getTime() < Date.now()) status = "expired";
  else if (await isTeamOwnerUser(userId, invite.ownerUserId)) status = "self";
  else {
    const [m] = await db
      .select({ id: teamMembershipsTable.id })
      .from(teamMembershipsTable)
      .where(
        and(
          eq(teamMembershipsTable.ownerUserId, invite.ownerUserId),
          eq(teamMembershipsTable.memberUserId, userId),
        ),
      );
    if (m) status = "already_member";
  }

  res.json({
    status,
    teamName: team.teamName,
    teamShortName: team.teamShortName,
    expiresAt: invite.expiresAt,
  });
});

/**
 * POST /api/invites/:token/accept — atomically claim the invite,
 * register the membership, and switch the user's active team to the
 * invited one. All checks + writes happen inside a single transaction so
 * a race between two clicks can't double-consume.
 */
router.post("/invites/:token/accept", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const token = req.params.token ?? "";

  // Fetch the inviter's email opportunistically so we can show a label
  // in the Coaches list even if Clerk lookups fail later.
  let memberEmail: string | null = null;
  try {
    const u = await clerkClient.users.getUser(userId);
    memberEmail =
      u.primaryEmailAddress?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      null;
  } catch {
    // Non-fatal — we'll fall back to userId for display.
  }

  const result = await db.transaction(async (tx) => {
    // Re-read inside the transaction so we get a row lock for the update.
    const [invite] = await tx
      .select()
      .from(teamInvitesTable)
      .where(eq(teamInvitesTable.token, token));
    if (!invite) return { ok: false as const, status: 404, error: "Invite not found" };
    if (invite.revokedAt) return { ok: false as const, status: 410, error: "Invite revoked" };
    if (invite.acceptedAt) return { ok: false as const, status: 410, error: "Invite already used" };
    if (invite.expiresAt.getTime() < Date.now())
      return { ok: false as const, status: 410, error: "Invite expired" };
    if (await isTeamOwnerUser(userId, invite.ownerUserId))
      return {
        ok: false as const,
        status: 400,
        error: "You can't invite yourself to your own team",
      };

    // STEP 1 — Consume the invite first with a guarded UPDATE. Critical:
    // we must do this BEFORE inserting the membership row, otherwise two
    // concurrent accepts (different users) would each pass the SELECT
    // check above and each insert a membership (different unique keys),
    // and only the guarded UPDATE would gate. Returning {ok:false} after
    // the membership insert does NOT roll back the transaction — the
    // loser would still end up as a member. Putting the guarded UPDATE
    // first means the losing request performs zero writes before bailing.
    const stamped = await tx
      .update(teamInvitesTable)
      .set({ acceptedAt: new Date(), acceptedByUserId: userId })
      .where(
        and(
          eq(teamInvitesTable.id, invite.id),
          isNull(teamInvitesTable.acceptedAt),
          isNull(teamInvitesTable.revokedAt),
          gt(teamInvitesTable.expiresAt, new Date()),
        ),
      )
      .returning({ id: teamInvitesTable.id });
    if (stamped.length === 0) {
      return { ok: false as const, status: 410, error: "Invite already used" };
    }

    // STEP 2 — Now (and only now) record the membership. New coaches
    // start at 'view' tier so they can browse the team safely; the head
    // coach upgrades them from the Coaches card. No-op if the user was
    // already a member from a previous accepted invite (we explicitly
    // do NOT re-grant tier on re-acceptance).
    await tx
      .insert(teamMembershipsTable)
      .values({
        ownerUserId: invite.ownerUserId,
        memberUserId: userId,
        memberEmail,
        permission: "view",
        isOwner: false,
      })
      .onConflictDoNothing({
        target: [teamMembershipsTable.ownerUserId, teamMembershipsTable.memberUserId],
      });

    // Switch the active team to the just-joined one so the next page
    // load shows the new data immediately.
    await tx
      .insert(userActiveTeamTable)
      .values({ userId, activeOwnerUserId: invite.ownerUserId })
      .onConflictDoUpdate({
        target: userActiveTeamTable.userId,
        set: { activeOwnerUserId: invite.ownerUserId, updatedAt: new Date() },
      });

    return {
      ok: true as const,
      ownerUserId: invite.ownerUserId,
    };
  });

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const labels = await fetchTeamLabels([result.ownerUserId]);
  res.json({
    ownerUserId: result.ownerUserId,
    teamName: labels[result.ownerUserId]!.teamName,
    teamShortName: labels[result.ownerUserId]!.teamShortName,
  });
});

export default router;
