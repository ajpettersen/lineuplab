import assert from "node:assert/strict";
import { hashPassword, passwordProblem, verifyPassword } from "../src/lib/passwords";
import {
  clearSignInFailures,
  recordSignInFailure,
  resetSignInLimits,
  signInLocked,
  signUpAllowed,
} from "../src/lib/signInLimits";

const password = "correct horse ünïcode 🙂";
const hash = await hashPassword(password);
assert.ok(hash.startsWith("scrypt$16$8$1$"), "tagged with scheme and cost");
assert.ok(!hash.includes(password), "plaintext never appears in the stored value");
assert.equal(await verifyPassword(password, hash), true, "right password verifies");
assert.equal(await verifyPassword(password + "x", hash), false, "wrong password fails");
assert.equal(await verifyPassword("", hash), false, "empty password fails");
assert.notEqual(await hashPassword(password), hash, "a fresh salt makes every hash different");
assert.equal(await verifyPassword(password, null), false, "no stored hash fails closed");
assert.equal(await verifyPassword(password, "not-a-hash"), false, "garbage fails closed");
assert.equal(await verifyPassword(password, hash.replace("scrypt$16", "scrypt$40")), false, "absurd cost is refused");
const parts = hash.split("$");
parts[5] = parts[5].slice(0, -2) + (parts[5].endsWith("AA") ? "BB" : "AA");
assert.equal(await verifyPassword(password, parts.join("$")), false, "tampered hash fails");

assert.equal(passwordProblem("short"), "Use at least 8 characters.");
assert.equal(passwordProblem(12345678), "Use at least 8 characters.");
assert.equal(passwordProblem("x".repeat(201)), "That password is too long.");
assert.equal(passwordProblem("long enough"), null);

resetSignInLimits();
const now = 1_000_000;
for (let i = 0; i < 10; i++) recordSignInFailure("a@example.com", now);
assert.equal(signInLocked("a@example.com", now), true, "ten misses lock that email");
assert.equal(signInLocked("b@example.com", now), false, "other emails are unaffected");
assert.equal(signInLocked("a@example.com", now + 15 * 60_000), false, "the lock lifts after 15 minutes");
for (let i = 0; i < 10; i++) recordSignInFailure("c@example.com", now);
clearSignInFailures("c@example.com");
assert.equal(signInLocked("c@example.com", now), false, "a successful sign-in clears that email's misses");
resetSignInLimits();
for (let i = 0; i < 100; i++) recordSignInFailure(`u${i}@example.com`, now);
assert.equal(signInLocked("fresh@example.com", now), true, "100 misses overall lock everyone for a while");
resetSignInLimits();
for (let i = 0; i < 20; i++) assert.equal(signUpAllowed(now), true);
assert.equal(signUpAllowed(now), false, "sign-ups are capped per hour");

console.log("passwords: all checks passed");
