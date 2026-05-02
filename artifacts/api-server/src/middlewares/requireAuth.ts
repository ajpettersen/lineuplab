import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";

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
 * attaches the resolved Clerk userId onto `req.userId` for downstream
 * handlers.
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
  const auth = getAuth(req);
  // Clerk's `auth.userId` is the canonical user identifier on the session.
  // It is `string | null` from @clerk/express; bail with 401 when missing.
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
