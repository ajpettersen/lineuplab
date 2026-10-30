import { Router } from "express";
import { db, passwordSetupTokensTable, userAccountsTable } from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  getAccount,
  getAccountByEmail,
  newAccountId,
  normalizeDisplayName,
  normalizeEmail,
} from "../lib/accounts";
import { hashPassword, passwordProblem, spendPasswordCheckTime, verifyPassword } from "../lib/passwords";
import {
  clearSignInFailures,
  recordSignInFailure,
  signInLocked,
  signUpAllowed,
} from "../lib/signInLimits";
import { currentSessionHash, endOtherSessions, endSession, startSession } from "../lib/userSessions";
import { createPasswordSetupToken, hashSetupToken } from "../lib/passwordSetup";

// Lineup Lab's own sign-in: email + password, a session cookie, and
// single-use "set your password" links that a master admin hands out (or
// that `pnpm --filter @workspace/api-server run auth password-link` prints).
// Mounted before requireAuth: signing in can't require being signed in.

const router = Router();

const WRONG_LOGIN = "That email and password don't match.";
const LOCKED = "Too many attempts. Wait 15 minutes and try again.";

async function findUsableSetupToken(token: unknown) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const [row] = await db.select().from(passwordSetupTokensTable).where(and(
    eq(passwordSetupTokensTable.tokenHash, hashSetupToken(token)),
    isNull(passwordSetupTokensTable.usedAt),
    gt(passwordSetupTokensTable.expiresAt, new Date()),
  )).limit(1);
  return row ?? null;
}

/** GET /api/auth/session — who is signed in, if anyone. */
router.get("/auth/session", async (req, res): Promise<void> => {
  const userId = req.signedInUserId;
  if (!userId) {
    res.json({ signedIn: false });
    return;
  }
  try {
    const account = await getAccount(userId);
    res.json({
      signedIn: true,
      userId,
      email: account?.email ?? null,
      displayName: account?.displayName ?? null,
      hasPassword: !!account?.passwordHash,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to read sign-in session");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/auth/sign-in — { email, password } */
router.post("/auth/sign-in", async (req, res): Promise<void> => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password || password.length > 200) {
    res.status(400).json({ error: WRONG_LOGIN });
    return;
  }
  if (signInLocked(email)) {
    res.status(429).json({ error: LOCKED });
    return;
  }
  try {
    const account = await getAccountByEmail(email);
    const ok = account?.passwordHash
      ? await verifyPassword(password, account.passwordHash)
      : (await spendPasswordCheckTime(password), false);
    if (!account || !ok) {
      recordSignInFailure(email);
      res.status(401).json({ error: WRONG_LOGIN });
      return;
    }
    clearSignInFailures(email);
    await startSession(res, account.userId);
    res.json({ signedIn: true, userId: account.userId });
  } catch (err) {
    req.log.error({ err }, "Failed to sign in");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/auth/sign-up — { name, email, password }. Any coach can make an
 * account; their own team is set up on first load (/team/context).
 */
router.post("/auth/sign-up", async (req, res): Promise<void> => {
  const name = normalizeDisplayName(req.body?.name);
  const email = normalizeEmail(req.body?.email);
  const problem = passwordProblem(req.body?.password);
  if (!name) {
    res.status(400).json({ error: "Enter your name." });
    return;
  }
  if (!email) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  if (!signUpAllowed()) {
    res.status(429).json({ error: "Too many new accounts right now. Try again in an hour." });
    return;
  }
  try {
    if (await getAccountByEmail(email)) {
      res.status(409).json({ error: "There's already an account with that email. Sign in instead." });
      return;
    }
    const userId = newAccountId();
    const passwordHash = await hashPassword(req.body.password);
    const created = await db.insert(userAccountsTable)
      .values({ userId, email, displayName: name, passwordHash })
      .then(() => true, (err) => {
        // Two sign-ups racing for one email: the unique index decides.
        if ((err?.code ?? err?.cause?.code) === "23505") return false;
        throw err;
      });
    if (!created) {
      res.status(409).json({ error: "There's already an account with that email. Sign in instead." });
      return;
    }
    await startSession(res, userId);
    res.status(201).json({ signedIn: true, userId });
  } catch (err) {
    req.log.error({ err }, "Failed to create account");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/auth/sign-out */
router.post("/auth/sign-out", async (req, res): Promise<void> => {
  try {
    await endSession(req, res);
    res.json({ signedIn: false });
  } catch (err) {
    req.log.error({ err }, "Failed to sign out");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/auth/password-setup/validate — { token } → whether the link still works, and for whom. */
router.post("/auth/password-setup/validate", async (req, res): Promise<void> => {
  try {
    const row = await findUsableSetupToken(req.body?.token);
    const account = row ? await getAccount(row.userId) : null;
    res.json(account ? { valid: true, email: account.email } : { valid: false });
  } catch (err) {
    req.log.error({ err }, "Failed to check password link");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/auth/password-setup/complete — { token, password }: sets the password and signs in. */
router.post("/auth/password-setup/complete", async (req, res): Promise<void> => {
  const problem = passwordProblem(req.body?.password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  try {
    const passwordHash = await hashPassword(req.body.password);
    const userId = await db.transaction(async (tx) => {
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      if (token.length < 32 || token.length > 128) return null;
      const [row] = await tx.update(passwordSetupTokensTable)
        .set({ usedAt: new Date() })
        .where(and(
          eq(passwordSetupTokensTable.tokenHash, hashSetupToken(token)),
          isNull(passwordSetupTokensTable.usedAt),
          gt(passwordSetupTokensTable.expiresAt, new Date()),
        ))
        .returning({ userId: passwordSetupTokensTable.userId });
      if (!row) return null;
      await tx.update(userAccountsTable)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(userAccountsTable.userId, row.userId));
      return row.userId;
    });
    if (!userId) {
      res.status(410).json({ error: "This link has expired or was already used. Ask for a new one." });
      return;
    }
    // Anyone who was signed in as this account with the old password is signed out.
    await endOtherSessions(userId, null);
    await startSession(res, userId);
    res.json({ signedIn: true, userId });
  } catch (err) {
    req.log.error({ err }, "Failed to set password from link");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/auth/change-password — { currentPassword, newPassword } */
router.post("/auth/change-password", async (req, res): Promise<void> => {
  const userId = req.signedInUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const problem = passwordProblem(req.body?.newPassword);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  try {
    const account = await getAccount(userId);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if (signInLocked(account.email)) {
      res.status(429).json({ error: LOCKED });
      return;
    }
    const current = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    if (account.passwordHash && !(await verifyPassword(current, account.passwordHash))) {
      recordSignInFailure(account.email);
      res.status(400).json({ error: "Your current password isn't right." });
      return;
    }
    await db.update(userAccountsTable)
      .set({ passwordHash: await hashPassword(req.body.newPassword), updatedAt: new Date() })
      .where(eq(userAccountsTable.userId, userId));
    await endOtherSessions(userId, currentSessionHash(req));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to change password");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
