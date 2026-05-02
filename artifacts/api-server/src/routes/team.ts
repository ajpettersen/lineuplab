import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, gt } from "drizzle-orm";
import { z } from "zod";
import crypto from "node:crypto";
import { clerkClient } from "@clerk/express";
import {
  db,
  teamMembershipsTable,
  teamInvitesTable,
  teamSettingsTable,
  userActiveTeamTable,
  DEFAULT_TEAM_NAME,
  DEFAULT_TEAM_SHORT_NAME,
} from "@workspace/db";

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

  const memberships = await db
    .select({ ownerUserId: teamMembershipsTable.ownerUserId })
    .from(teamMembershipsTable)
    .where(eq(teamMembershipsTable.memberUserId, userId));

  const otherOwnerIds = memberships.map((m) => m.ownerUserId);
  const allOwnerIds = Array.from(new Set([userId, ...otherOwnerIds]));
  const labels = await fetchTeamLabels(allOwnerIds);

  res.json({
    userId,
    activeOwnerUserId: ownerUserId,
    isOwner: userId === ownerUserId,
    ownedTeam: {
      ownerUserId: userId,
      teamName: labels[userId]!.teamName,
      teamShortName: labels[userId]!.teamShortName,
    },
    memberOf: otherOwnerIds.map((oid) => ({
      ownerUserId: oid,
      teamName: labels[oid]!.teamName,
      teamShortName: labels[oid]!.teamShortName,
    })),
  });
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
});

router.post("/team/invites", async (req, res): Promise<void> => {
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
      expiresAt,
    })
    .returning();
  res.status(201).json({
    id: row!.id,
    token: row!.token,
    label: row!.label,
    createdAt: row!.createdAt,
    expiresAt: row!.expiresAt,
    revokedAt: row!.revokedAt,
    acceptedAt: row!.acceptedAt,
  });
});

router.delete("/team/invites/:id", async (req, res): Promise<void> => {
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
 * GET /api/team/members — list coaches on the current team (excluding
 * the implicit owner). Augments each row with the member's email/name
 * from Clerk so the UI can display something human.
 */
router.get("/team/members", async (req, res): Promise<void> => {
  const ownerUserId = req.ownerUserId!;
  const rows = await db
    .select()
    .from(teamMembershipsTable)
    .where(eq(teamMembershipsTable.ownerUserId, ownerUserId))
    .orderBy(desc(teamMembershipsTable.joinedAt));

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
        joinedAt: r.joinedAt,
      };
    }),
  );

  res.json(enriched);
});

router.delete("/team/members/:memberUserId", async (req, res): Promise<void> => {
  const ownerUserId = req.ownerUserId!;
  const memberUserId = req.params.memberUserId;
  if (!memberUserId) {
    res.status(400).json({ error: "memberUserId required" });
    return;
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
  else if (invite.ownerUserId === userId) status = "self";
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
    if (invite.ownerUserId === userId)
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

    // STEP 2 — Now (and only now) record the membership. No-op if the
    // user was already a member from a previous accepted invite.
    await tx
      .insert(teamMembershipsTable)
      .values({
        ownerUserId: invite.ownerUserId,
        memberUserId: userId,
        memberEmail,
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
