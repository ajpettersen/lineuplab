// Limits on wrong passwords and new accounts. Counted per email and across
// everyone, never per visitor address: behind Railway's edge the address the
// server sees isn't reliably the visitor's. Kept in memory, so a restart
// clears them; that's fine at this size.

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_PER_EMAIL = 10;
const MAX_FAILURES_OVERALL = 100;
const SIGN_UP_WINDOW_MS = 60 * 60_000;
const MAX_SIGN_UPS = 20;

let failuresByEmail = new Map<string, number[]>();
let failures: number[] = [];
let signUps: number[] = [];

function prune(now: number) {
  failures = failures.filter(at => now - at < WINDOW_MS);
  signUps = signUps.filter(at => now - at < SIGN_UP_WINDOW_MS);
  const next = new Map<string, number[]>();
  for (const [email, times] of failuresByEmail) {
    const recent = times.filter(at => now - at < WINDOW_MS);
    if (recent.length) next.set(email, recent);
  }
  failuresByEmail = next;
}

export function signInLocked(email: string, now = Date.now()): boolean {
  prune(now);
  return failures.length >= MAX_FAILURES_OVERALL
    || (failuresByEmail.get(email)?.length ?? 0) >= MAX_FAILURES_PER_EMAIL;
}

export function recordSignInFailure(email: string, now = Date.now()): void {
  failures.push(now);
  failuresByEmail.set(email, [...(failuresByEmail.get(email) ?? []), now]);
}

export function clearSignInFailures(email: string): void {
  failuresByEmail.delete(email);
}

export function signUpAllowed(now = Date.now()): boolean {
  prune(now);
  if (signUps.length >= MAX_SIGN_UPS) return false;
  signUps.push(now);
  return true;
}

/** Test hook. */
export function resetSignInLimits(): void {
  failuresByEmail = new Map();
  failures = [];
  signUps = [];
}
