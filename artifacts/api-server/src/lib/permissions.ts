import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import {
  db,
  teamMembershipsTable,
  PERMISSION_RANK,
  isPermissionTier,
  type PermissionTier,
} from "@workspace/db";

/**
 * Read the comma-separated `MASTER_ADMIN_USER_IDS` env var into a Set
 * of trimmed Clerk user IDs. Empty / missing var → empty set (no admins).
 */
export function getMasterAdminUserIds(): Set<string> {
  const raw = process.env.MASTER_ADMIN_USER_IDS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function isMasterAdmin(userId: string | undefined | null): boolean {
  if (!userId) return false;
  return getMasterAdminUserIds().has(userId);
}

/**
 * Resolve the calling user's permission tier on the given team owner's
 * data scope. Short-circuits:
 *   - userId === ownerUserId → 'full' (the owner is always full).
 *   - master-admin → 'full' (cross-tenant override).
 *   - otherwise look up the membership row.
 *
 * Returns `null` when there is no membership at all (caller should
 * treat as "no access").
 */
export async function getUserPermission(
  userId: string,
  ownerUserId: string,
): Promise<PermissionTier | null> {
  if (userId === ownerUserId) return "full";
  if (isMasterAdmin(userId)) return "full";

  const [row] = await db
    .select({ permission: teamMembershipsTable.permission })
    .from(teamMembershipsTable)
    .where(
      and(
        eq(teamMembershipsTable.ownerUserId, ownerUserId),
        eq(teamMembershipsTable.memberUserId, userId),
      ),
    );

  if (!row) return null;
  return isPermissionTier(row.permission) ? row.permission : "view";
}

/**
 * Express middleware factory that 403s if `req.userId` lacks at least
 * `level` access on `req.ownerUserId`. Mount AFTER `requireAuth` and
 * `resolveTeamContext`.
 *
 * Use as the LAST middleware in a route's chain (or attach it to the
 * router level for groups of write routes) so reads remain unrestricted.
 */
/**
 * Convenience middleware for files where we want EVERY non-read method
 * gated at the same tier. Applied with `router.use(gateWrites('full'))`
 * at the top of a routes file, it short-circuits GET/HEAD/OPTIONS to
 * `next()` and runs `assertPermission(level)` for everything else.
 *
 * Pairs nicely with `routes/<feature>.ts` files that mix reads + writes
 * — keeps the gating in one place instead of decorating every handler.
 */
export function gateWrites(level: PermissionTier) {
  const guard = assertPermission(level);
  return function gateWritesMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    void guard(req, res, next);
  };
}

export function assertPermission(level: PermissionTier) {
  const required = PERMISSION_RANK[level];
  return async function assertPermissionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const userId = req.userId;
    const ownerUserId = req.ownerUserId;
    if (!userId || !ownerUserId) {
      // Should be impossible if mounted correctly, but bail loudly.
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const tier = await getUserPermission(userId, ownerUserId);
      if (!tier) {
        res.status(403).json({ error: "No access to this team" });
        return;
      }
      if (PERMISSION_RANK[tier] < required) {
        res.status(403).json({
          error: `This action requires '${level}' access. You have '${tier}' access.`,
        });
        return;
      }
      next();
    } catch (err) {
      req.log.error({ err }, "assertPermission failed");
      res.status(500).json({ error: "Failed to check permission" });
    }
  };
}
