import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  teamMembershipsTable,
  userActiveTeamTable,
} from "@workspace/db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Clerk userId of the team's owner — i.e. the data scope for this
       * request. Equals `req.userId` when the user is on their own team,
       * or another user's id when they've switched into a team they're a
       * member of.
       *
       * All data-scoping queries (`eq(table.userId, ownerUserId)`) and
       * inserts of new owned rows should use this value rather than
       * `req.userId`. Use `req.userId` only for things tied to the actual
       * signed-in person (audit, "who created this", their own active-team
       * pointer, etc.).
       */
      ownerUserId?: string;
    }
  }
}

/**
 * Resolves the active team for the signed-in user. Must be mounted AFTER
 * `requireAuth` so `req.userId` is guaranteed.
 *
 * Lookup order:
 *   1. Read user_active_team row for this userId.
 *   2. If absent → owner is the user themselves (their own team).
 *   3. If present and equals userId → owner is the user themselves.
 *   4. If present and points to another user → verify a team_memberships
 *      row links userId to that owner. If missing (e.g. they were
 *      removed), clear the stale pointer and fall back to the user's own
 *      team. This means "removed coaches gracefully drop back to their
 *      own team" with no broken state.
 */
export async function resolveTeamContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [active] = await db
      .select()
      .from(userActiveTeamTable)
      .where(eq(userActiveTeamTable.userId, userId));

    if (!active || active.activeOwnerUserId === userId) {
      req.ownerUserId = userId;
      next();
      return;
    }

    // Verify the user is still a member of the team they claim to be on.
    const [membership] = await db
      .select({ id: teamMembershipsTable.id })
      .from(teamMembershipsTable)
      .where(
        and(
          eq(teamMembershipsTable.ownerUserId, active.activeOwnerUserId),
          eq(teamMembershipsTable.memberUserId, userId),
        ),
      );

    if (membership) {
      req.ownerUserId = active.activeOwnerUserId;
      next();
      return;
    }

    // Stale pointer (membership revoked). Clear it and fall back.
    await db
      .delete(userActiveTeamTable)
      .where(eq(userActiveTeamTable.userId, userId));
    req.ownerUserId = userId;
    next();
  } catch (err) {
    req.log.error({ err }, "resolveTeamContext failed");
    res.status(500).json({ error: "Failed to resolve team context" });
  }
}
