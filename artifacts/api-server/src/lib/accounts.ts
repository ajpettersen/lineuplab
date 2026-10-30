import { randomBytes } from "node:crypto";
import { db, userAccountsTable, type UserAccount } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Who an account belongs to (email and name), now that Lineup Lab runs its
// own sign-in instead of asking Clerk.

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= 80 ? name : null;
}

/**
 * New accounts get an id shaped like the old Clerk ones but clearly Lineup
 * Lab's own. Never `team_…`: that prefix marks synthetic team owners.
 */
export function newAccountId(): string {
  return `usr_${randomBytes(16).toString("base64url")}`;
}

export async function getAccount(userId: string): Promise<UserAccount | null> {
  const [account] = await db.select().from(userAccountsTable)
    .where(eq(userAccountsTable.userId, userId)).limit(1);
  return account ?? null;
}

export async function getAccountByEmail(email: string): Promise<UserAccount | null> {
  const [account] = await db.select().from(userAccountsTable)
    .where(eq(userAccountsTable.email, email)).limit(1);
  return account ?? null;
}

export function accountDisplayName(account: Pick<UserAccount, "displayName" | "email"> | null, fallback: string): string {
  return account?.displayName?.trim() || account?.email.split("@")[0] || fallback;
}

export interface AccountLite {
  email: string | null;
  name: string | null;
  hasPassword?: boolean;
}

/** Email and name for many accounts in one query; unknown ids are simply absent. */
export async function getAccountsLite(userIds: readonly string[]): Promise<Map<string, AccountLite>> {
  const unique = Array.from(new Set(userIds)).filter((id) => !id.startsWith("team_"));
  const out = new Map<string, AccountLite>();
  if (unique.length === 0) return out;
  const rows = await db.select({
    userId: userAccountsTable.userId,
    email: userAccountsTable.email,
    name: userAccountsTable.displayName,
    passwordHash: userAccountsTable.passwordHash,
  }).from(userAccountsTable).where(inArray(userAccountsTable.userId, unique));
  for (const row of rows) {
    out.set(row.userId, { email: row.email, name: row.name, hasPassword: !!row.passwordHash });
  }
  return out;
}
