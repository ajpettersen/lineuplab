// One-off sign-in chores, run against a database from the command line:
//
//   pnpm --filter @workspace/api-server run auth import-accounts [--dry-run]
//     Gives every coach who has data in Lineup Lab a login (email, no
//     password yet). The email comes from Clerk when Clerk knows the
//     account (needs CLERK_SECRET_KEY), otherwise from the email Lineup Lab
//     saved in team_memberships. Safe to run again: accounts that already
//     have a login are left alone.
//
//   pnpm --filter @workspace/api-server run auth password-link <email> [--url https://…]
//     Prints a single-use, 7-day "set your password" link for that account.
//
// For production, prefix with `railway run` (this folder is linked to the
// "Lineup Lab" service).
import {
  db,
  pool,
  playersTable,
  teamMembershipsTable,
  teamSettingsTable,
  userAccountsTable,
} from "@workspace/db";
import { desc, isNotNull } from "drizzle-orm";
import { getAccount, getAccountByEmail, normalizeDisplayName, normalizeEmail } from "./lib/accounts";
import { createPasswordSetupToken } from "./lib/passwordSetup";

const DEFAULT_APP_URL = "https://lineup-lab-production-7c33.up.railway.app";

interface ClerkUser {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: { id: string; email_address: string }[];
}

async function fromClerk(userId: string, secret: string | undefined) {
  if (!secret || !userId.startsWith("user_")) return null;
  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) return null;
  const user = await response.json() as ClerkUser;
  const primary = user.email_addresses?.find(e => e.id === user.primary_email_address_id)
    ?? user.email_addresses?.[0];
  return {
    email: normalizeEmail(primary?.email_address),
    name: normalizeDisplayName([user.first_name, user.last_name].filter(Boolean).join(" "))
      ?? normalizeDisplayName(user.username),
  };
}

async function importAccounts(dryRun: boolean) {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) console.log("CLERK_SECRET_KEY isn't set; using saved team emails only.");

  const [members, owners, settings] = await Promise.all([
    db.select({
      userId: teamMembershipsTable.memberUserId,
      email: teamMembershipsTable.memberEmail,
      displayName: teamMembershipsTable.displayName,
    }).from(teamMembershipsTable).orderBy(desc(teamMembershipsTable.joinedAt)),
    db.selectDistinct({ userId: playersTable.userId }).from(playersTable),
    db.select({ userId: teamSettingsTable.userId }).from(teamSettingsTable).where(isNotNull(teamSettingsTable.userId)),
  ]);

  // Newest membership row first, so its saved email and name win.
  const saved = new Map<string, { email: string | null; name: string | null }>();
  for (const m of members) {
    const prev = saved.get(m.userId);
    saved.set(m.userId, {
      email: prev?.email ?? normalizeEmail(m.email),
      name: prev?.name ?? normalizeDisplayName(m.displayName),
    });
  }
  const ids = new Set([...members, ...owners, ...settings].map(r => r.userId).filter(id => id && !id.startsWith("team_")));

  let imported = 0;
  let missing = 0;
  for (const userId of ids) {
    if (await getAccount(userId)) continue;
    const clerk = await fromClerk(userId, secret);
    const email = clerk?.email ?? saved.get(userId)?.email ?? null;
    const name = clerk?.name ?? saved.get(userId)?.name ?? null;
    if (!email) {
      console.log(`  skip ${userId}: no email anywhere (an admin can add one when making a link)`);
      missing++;
      continue;
    }
    const taken = await getAccountByEmail(email);
    if (taken) {
      console.log(`  skip ${userId}: ${email} already belongs to ${taken.userId}`);
      missing++;
      continue;
    }
    console.log(`  ${dryRun ? "would import" : "import"} ${email} (${clerk?.email ? "from Clerk" : "saved team email"}${name ? `, ${name}` : ""})`);
    if (!dryRun) {
      await db.insert(userAccountsTable).values({ userId, email, displayName: name });
    }
    imported++;
  }
  console.log(`${dryRun ? "Would import" : "Imported"} ${imported} account(s); ${missing} skipped.`);
}

async function printPasswordLink(rawEmail: string | undefined, appUrl: string) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error("Give the account's email: auth password-link <email>");
  const account = await getAccountByEmail(email);
  if (!account) throw new Error(`No Lineup Lab login uses ${email}. Run import-accounts first?`);
  const { token, expiresAt } = await createPasswordSetupToken(account.userId, null);
  console.log(`Set-password link for ${email} (works once, until ${expiresAt.toISOString()}):`);
  console.log(`${appUrl.replace(/\/+$/, "")}/set-password#${token}`);
}

const [command, ...rest] = process.argv.slice(2);
const urlFlag = rest.indexOf("--url");
const appUrl = urlFlag >= 0 ? rest[urlFlag + 1] : process.env.LINEUP_LAB_APP_URL || DEFAULT_APP_URL;
const positional = rest.filter((arg, i) => !arg.startsWith("--") && rest[i - 1] !== "--url");

try {
  if (command === "import-accounts") await importAccounts(rest.includes("--dry-run"));
  else if (command === "password-link") await printPasswordLink(positional[0], appUrl);
  else {
    console.error("Usage: auth import-accounts [--dry-run] | auth password-link <email> [--url https://…]");
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
