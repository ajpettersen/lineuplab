import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  parseIfMatch,
  rejectBadIfMatch,
  sendConflict,
  versionedUpdate,
} from "../lib/concurrency";
import { z } from "zod";
import { clerkClient } from "@clerk/express";
import {
  db,
  teamMembershipsTable,
  ensureOwnerMembership,
  isPermissionTier,
} from "@workspace/db";

const router: IRouter = Router();

const UpdateProfileBody = z.object({
  displayName: z.string().trim().min(2).max(40),
  role: z.string().trim().max(40).nullable().optional(),
});

/**
 * PUT /api/coach-profile — update the calling user's display name +
 * role for the CURRENTLY ACTIVE team. Used by the first-time onboarding
 * dialog and by the "edit my profile" affordance.
 *
 * Works for owners (updates their own owner-row) and members (updates
 * their member-row). Idempotently creates the owner-row first so
 * existing accounts that pre-date the schema migration get one on
 * first save.
 */
router.put("/coach-profile", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const ownerUserId = req.ownerUserId!;

  const ifm = parseIfMatch(req);
  if (!ifm.ok) {
    rejectBadIfMatch(res);
    return;
  }
  const parsed = UpdateProfileBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const { displayName, role } = parsed.data;

  // For owners, make sure their owner-row exists before we try to
  // update it. For members, the row was created at invite-accept and
  // we just update it.
  if (userId === ownerUserId) {
    let email: string | null = null;
    try {
      const u = await clerkClient.users.getUser(userId);
      email =
        u.primaryEmailAddress?.emailAddress ??
        u.emailAddresses[0]?.emailAddress ??
        null;
    } catch (err) {
      req.log.warn({ err }, "Failed to fetch owner email from Clerk");
    }
    await ensureOwnerMembership(userId, email);
  }

  const result = await versionedUpdate(db, teamMembershipsTable, {
    set: {
      displayName,
      role: role ?? null,
    },
    where: and(
      eq(teamMembershipsTable.ownerUserId, ownerUserId),
      eq(teamMembershipsTable.memberUserId, userId),
    ),
    ifMatch: ifm.version,
  });

  if (result.kind === "conflict") {
    sendConflict(res, result.current);
    return;
  }
  if (result.kind === "missing") {
    // Caller has no membership row on the active team (e.g. a master
    // admin viewing a foreign team). Profile edits don't make sense in
    // that context — they'd accidentally create a stub coach row on a
    // team they're not really on.
    res.status(404).json({
      error: "You don't have a coach profile on this team",
    });
    return;
  }

  const updated = result.row;
  res.json({
    displayName: updated.displayName,
    role: updated.role,
    permission: isPermissionTier(updated.permission) ? updated.permission : "view",
  });
});

export default router;
