import { createHash, randomBytes } from "node:crypto";
import { db, passwordSetupTokensTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

// Single-use "set your password" links. The link carries the token after a
// "#", so it never reaches server logs; only its SHA-256 is stored.

export const PASSWORD_SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashSetupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Makes a new set-password link token for an account, replacing any unused one. */
export async function createPasswordSetupToken(userId: string, createdByUserId: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PASSWORD_SETUP_TTL_MS);
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
