import { createHash, randomBytes } from "node:crypto";
import { db, passwordSetupTokensTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

// Single-use "set your password" links. The link carries the token after a
// "#", so it never reaches server logs; only its SHA-256 is stored.

export const PASSWORD_SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Self-service resets are short-lived: the coach is at their inbox right
// now, and a stale link in an old email shouldn't keep working for a week.
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export function hashSetupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Makes a new set-password link token for an account, replacing any unused one. */
export async function createPasswordSetupToken(
  userId: string,
  createdByUserId: string | null,
  ttlMs: number = PASSWORD_SETUP_TTL_MS,
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.transaction(async (tx) => {
    await tx.delete(passwordSetupTokensTable).where(and(
      eq(passwordSetupTokensTable.userId, userId),
      isNull(passwordSetupTokensTable.usedAt),
    ));
    await tx.insert(passwordSetupTokensTable).values({
      tokenHash: hashSetupToken(token),
      userId,
      createdByUserId,
      expiresAt,
    });
  });
  return { token, expiresAt };
}
