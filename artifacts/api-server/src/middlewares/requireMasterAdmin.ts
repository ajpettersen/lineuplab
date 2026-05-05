import type { NextFunction, Request, Response } from "express";
import { isMasterAdmin } from "../lib/permissions";

/**
 * Express middleware that 403s unless the caller's Clerk userId is in
 * the `MASTER_ADMIN_USER_IDS` env allow-list. Mount AFTER `requireAuth`
 * so `req.userId` is populated.
 *
 * Use for cross-tenant superuser routes (e.g. `/api/admin/*`). The
 * client-facing `/api/admin/me` endpoint is the one exception: it only
 * needs `requireAuth` and returns `{ isMasterAdmin: boolean }` so any
 * signed-in user can ask "am I admin?" without getting a 403.
 */
export function requireMasterAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isMasterAdmin(userId)) {
    res.status(403).json({ error: "Master admin access required" });
    return;
  }
  next();
}
