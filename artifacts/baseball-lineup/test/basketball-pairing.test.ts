import assert from "node:assert/strict";
import { buildRotation, DEFAULT_BASKETBALL_SETTINGS, type BasketballPlayer } from "../src/lib/basketball-rotation.ts";
import { pairingProblems } from "../src/lib/basketball-pairing.ts";
import { fixOrderForRules, orderViolations } from "../src/lib/basketball-pairing-fix.ts";

const guards: BasketballPlayer[] = ["g1", "g2", "g3", "g4"].map((id) => ({ id, name: id, role: "guard", position: null }));
const fronts: BasketballPlayer[] = ["f1", "f2", "f3", "f4", "f5"].map((id) => ({ id, name: id, role: "front" }));
const players = [...guards, ...fronts];
const order = players.map((p) => p.id);

// Checking a five.
{
  const rules = { neverTogether: [["f1", "f2"]], atLeastOne: [{ label: "ball-handler", ids: ["g1", "g2"] }] };
  const all = new Set(order);
  assert.deepEqual(pairingProblems(["f1", "f2", "g1", "g3", "f3"], rules, all).map((p) => p.text), ["f1 and f2 together"]);
  assert.deepEqual(pairingProblems(["f3", "f4", "g3", "g4", "f5"], rules, all).map((p) => p.text), ["no ball-handler on court"]);
  assert.deepEqual(pairingProblems(["f3", "f4", "g3", "g4", "f5"], rules, new Set(["g3"])).map((p) => p.text), ["no ball-handler available"]);
}

// The rotation warns where a rule is broken; Fix order finds an order that meets it.
{
  const settings = { ...DEFAULT_BASKETBALL_SETTINGS, flexShifts: 0 };
  // g1 and g2 start together in this order; one of them must always be on.
  const pairing = { neverTogether: [["g1", "g2"]], atLeastOne: [{ label: "ball-handler", ids: ["g1", "g2"] }] };
  const r = buildRotation({ players, settings, order, pairing });
  assert.ok(r.warnings.some((w) => w.startsWith("Pairing rule broken: g1 and g2 together")), "warns, doesn't break silently");
  assert.ok(orderViolations({ players, settings, order, pairing }) > 0);
  const fixed = fixOrderForRules({ players, settings, order, pairing });
  assert.equal(fixed.after, 0, "an order exists that meets both rules");
  const r2 = buildRotation({ players, settings, order: fixed.order, pairing });
  assert.ok(!r2.warnings.some((w) => w.startsWith("Pairing rule broken")));
}

// Can't be met by a rotating queue: 5 fronts share 3 spots, so any two fronts meet.
{
  const settings = { ...DEFAULT_BASKETBALL_SETTINGS, flexShifts: 0 };
  const pairing = { neverTogether: [["f1", "f2"]], atLeastOne: [] };
  const fixed = fixOrderForRules({ players, settings, order, pairing }, 300);
  assert.ok(fixed.after > 0 && fixed.after <= fixed.before, "best effort, and the warning stays");
}

// Impossible rule: still returns the best order and says how many breaks remain.
{
  const settings = { ...DEFAULT_BASKETBALL_SETTINGS, flexShifts: 0 };
  const pairing = { neverTogether: [], atLeastOne: [{ label: "ball-handler", ids: ["g1"] }] }; // one player can't play every shift
  const fixed = fixOrderForRules({ players, settings, order, pairing }, 200);
  assert.ok(fixed.after > 0, "can't be met: some breaks remain");
  assert.ok(fixed.after <= fixed.before);
}

console.log("basketball-pairing: all checks passed");
