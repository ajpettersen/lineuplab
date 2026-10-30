import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db, userSessionsTable } from "@workspace/db";
import { and, eq, gt, lt, ne } from "drizzle-orm";

// Signed-in browsers carry a random token in an HttpOnly cookie; the database
// keeps only its SHA-256, so a leaked database copy can't be replayed as a
// session. Signing out (or setting a new password) deletes the row, which
// ends that session immediately.

export const SESSION_COOKIE_NAME = "lineuplab_session";
const SESSION_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
// Lookups are cached briefly because every API request needs one. Sign-out
// clears the cache right away; the TTL only matters if this server ever runs
// more than one copy.
const CACHE_TTL_MS = 60_000;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The signed-in account id, set by loadSignedInUser. requireAuth copies it to `userId`. */
      signedInUserId?: string | null;
    }
  }
}

const cache = new Map<string, { userId: string | null; checkedAt: number }>();

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function startSession(res: Response, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  await db.insert(userSessionsTable).values({
    tokenHash,
    userId,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS),
  });
  res.cookie(SESSION_COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_MAX_AGE_MS });
  return tokenHash;
}

export function currentSessionHash(req: Request): string | null {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  return token && token.length <= 128 ? hashSessionToken(token) : null;
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const tokenHash = currentSessionHash(req);
  if (tokenHash) {
    cache.delete(tokenHash);
    await db.delete(userSessionsTable).where(eq(userSessionsTable.tokenHash, tokenHash));
  }
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions());
}

/** Signs the account out everywhere except, optionally, the session doing the asking. */
export async function endOtherSessions(userId: string, keepTokenHash: string | null): Promise<void> {
  await db.delete(userSessionsTable).where(keepTokenHash
    ? and(eq(userSessionsTable.userId, userId), ne(userSessionsTable.tokenHash, keepTokenHash))
    : eq(userSessionsTable.userId, userId));
  for (const [hash, entry] of cache) {
    if (entry.userId === userId && hash !== keepTokenHash) cache.delete(hash);
  }
}

async function lookUp(tokenHash: string): Promise<string | null> {
  const cached = cache.get(tokenHash);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached.userId;
  const [session] = await db.select({ userId: userSessionsTable.userId })
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.tokenHash, tokenHash), gt(userSessionsTable.expiresAt, new Date())))
    .limit(1);
  const userId = session?.userId ?? null;
  if (cache.size > 5_000) cache.clear();
  cache.set(tokenHash, { userId, checkedAt: Date.now() });
  return userId;
}

/** Express middleware: works out who is signed in for every request after it. */
export async function loadSignedInUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.signedInUserId = null;
  const tokenHash = currentSessionHash(req);
  if (!tokenHash) return next();
  try {
    req.signedInUserId = await lookUp(tokenHash);
  } catch (err) {
    req.log.error({ err }, "Failed to look up sign-in session");
  }
  next();
}

export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(userSessionsTable).where(lt(userSessionsTable.expiresAt, new Date()));
}
