import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Password hashing for Lineup Lab's own sign-in. scrypt is built into Node, so
// there's no native module to install. Stored as
// "scrypt$<log2 N>$<r>$<p>$<salt>$<hash>" so the cost can be raised later
// without breaking existing hashes.

const LOG2_N = 16;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 256 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

function derive(password: string, salt: Buffer, log2N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N: 2 ** log2N, r, p, maxmem: MAX_MEMORY }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** Returns a reason the password can't be used, or null when it's fine. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) return "That password is too long.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, LOG2_N, R, P);
  return ["scrypt", LOG2_N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** False for a wrong password and for anything that isn't a hash this code made. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, log2N, r, p, salt, hash, ...extra] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash || extra.length > 0) return false;
  const params = [Number(log2N), Number(r), Number(p)];
  if (!params.every(n => Number.isInteger(n) && n > 0) || params[0] > 20) return false;
  try {
    const expected = Buffer.from(hash, "base64url");
    const actual = await derive(password, Buffer.from(salt, "base64url"), params[0], params[1], params[2]);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// Hashing a throwaway password when the email is unknown keeps sign-in
// equally slow either way, so response time doesn't reveal who has an account.
let decoyHash: Promise<string> | null = null;
export async function spendPasswordCheckTime(password: string): Promise<void> {
  decoyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await decoyHash);
}
