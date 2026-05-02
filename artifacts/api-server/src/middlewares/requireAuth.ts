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
    // TEMP DIAGNOSTIC: log everything we can see about the auth attempt so
    // we can debug why dev preview sessions are being rejected.
    const a = auth as unknown as Record<string, unknown> | null;
    req.log.warn(
      {
        authKeys: a ? Object.keys(a) : null,
        sessionId: a?.sessionId ?? null,
        sessionStatus: a?.sessionStatus ?? null,
        reason:
          (a as { reason?: unknown } | null)?.reason ??
          (a as { debug?: () => unknown } | null)?.debug?.() ??
          null,
        hasAuthHeader: !!req.headers.authorization,
        cookieNames: (req.headers.cookie ?? "")
          .split(";")
          .map((c) => c.split("=")[0]?.trim())
          .filter(Boolean),
        host: req.headers.host,
        xForwardedHost: req.headers["x-forwarded-host"],
        xForwardedProto: req.headers["x-forwarded-proto"],
        origin: req.headers.origin,
        referer: req.headers.referer,
      },
      "requireAuth: rejecting request as unauthenticated",
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
