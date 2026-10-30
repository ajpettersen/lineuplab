import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Express middleware that rejects unauthenticated requests with 401 and
 * attaches the signed-in account id onto `req.userId` for downstream
 * handlers. The session itself is read by loadSignedInUser (lib/userSessions).
 *
 * Routes that need a logged-in coach should chain through this middleware,
 * then read `req.userId` (which is guaranteed to be a non-empty string) when
 * scoping DB queries.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const userId = req.signedInUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
