import assert from "node:assert/strict";
import { DEFAULT_BASKETBALL_SETTINGS, type BasketballPlayer } from "../src/lib/basketball-rotation.ts";
import { DEFAULT_REBALANCE_RULES, pairingProblem, rebalance, type RebalancePlayer } from "../src/lib/basketball-rebalance.ts";
import { applyRebalance, makeSub, onCourt, planRebalance, settle, startClock, startState, swapPlayers, trackStints, undoLast, courtSpots } from "../src/lib/basketball-live.ts";
import { minuteTargets } from "../src/lib/basketball-targets.ts";

const groups = [
  { key: "guard" as const, label: "Guards", one: "Guard", short: "G", spots: [1, 2] as (1 | 2 | 3 | 4 | 5)[] },
  { key: "front" as const, label: "Front", one: "Front", short: "F", spots: [3, 4, 5] as (1 | 2 | 3 | 4 | 5)[] },
];
const G = ["g1", "g2", "g3", "g4"];
const F = ["f1", "f2", "f3", "f4", "f5"];
const player = (id: string, over: Partial<RebalancePlayer> = {}): RebalancePlayer => ({
  id,
  group: id.startsWith("g") ? "guard" : "front",
  playedSec: 600,
  targetSec: 1333,
  on: false,
  stintSec: 0,
  ...over,
});

// Evens out: a player far behind plays a lot; group balance kept; limits respected.
{
  const on = ["g1", "g2", "f1", "f2", "f3"];
  const players = [...G, ...F].map((id) => player(id, { on: on.includes(id), stintSec: on.includes(id) ? 240 : 120 }));
  players.find((p) => p.id === "g4")!.playedSec = 0; // sat a lot (injury scare)
  const shifts = Array(6).fill(150);
  const r = rebalance({ players, spotOrder: on, currentLeftSec: 60, shifts, groups, rules: DEFAULT_REBALANCE_RULES });
  assert.equal(r.shifts.length, 6);
  for (const five of r.shifts) {
    assert.equal(new Set(five).size, 5);
    assert.equal(five.filter((id) => id.startsWith("g")).length, 2, "2 guards each shift");
  }
  const played = (id: string) => r.shifts.filter((f) => f.includes(id)).length;
  assert.ok(played("g4") >= 4, "the player behind gets most of the shifts");
  // Nobody plays more than 8 min in a row (150 s shifts: at most 3 in a row, counting the current stretch).
  for (const id of [...G, ...F]) {
    let run = on.includes(id) ? 300 : 0;
    for (const five of r.shifts) {
      run = five.includes(id) ? run + 150 : 0;
      assert.ok(run <= DEFAULT_REBALANCE_RULES.maxOnSec, `${id} stays on too long`);
    }
  }
  // Players who stay keep their spot.
  for (let k = 1; k < r.shifts.length; k++) {
    r.shifts[k].forEach((id, i) => {
      if (r.shifts[k - 1].includes(id)) assert.equal(r.shifts[k - 1].indexOf(id), i, "kept spot");
    });
  }
}

// Pairing rules: never together is honored; an impossible at-least-one warns.
{
  const rules = { ...DEFAULT_REBALANCE_RULES, neverTogether: [["f1", "f2"]], atLeastOne: [{ label: "ball-handler", ids: ["g1", "g2"] }] };
  const players = [...G, ...F].map((id) => player(id));
  const r = rebalance({ players, spotOrder: ["g3", "g4", "f3", "f4", "f5"], currentLeftSec: 0, shifts: [150, 150, 150, 150], groups, rules });
  for (const five of r.shifts) {
    assert.ok(!(five.includes("f1") && five.includes("f2")), "never together");
    assert.ok(five.includes("g1") || five.includes("g2"), "a ball-handler on court");
  }
  const noHandlers = rebalance({
    players: players.filter((p) => p.id !== "g1" && p.id !== "g2"),
    spotOrder: ["g3", "g4", "f3", "f4", "f5"],
    currentLeftSec: 0,
    shifts: [150],
    groups,
    rules,
  });
  assert.ok(noHandlers.warnings.some((w) => w.includes("No ball-handler available")), "warns instead of breaking silently");
  assert.equal(pairingProblem(["f1", "f2", "g1"], rules, new Set(["f1", "f2", "g1"])), "f1 and f2 are on court together (never-together rule)");
}

// Live: after an unplanned sub, plan the rest, apply it, follow it, undo it.
{
  const guards: BasketballPlayer[] = ["Vinnie J", "Brody", "Luke", "Vinnie V"].map((n) => ({ id: n, name: n, role: "guard", position: null }));
  const fronts: BasketballPlayer[] = ["Anders", "Henry", "Rory", "Bash", "Miles"].map((n) => ({ id: n, name: n, role: "front" }));
  const input = { players: [...guards, ...fronts], settings: DEFAULT_BASKETBALL_SETTINGS, order: [...guards, ...fronts].map((p) => p.id) };
  let s = trackStints(startClock(startState(input), 0));
  s = trackStints(settle(s, 60_000)); // 1:00 in
  const benchGuy = [...guards, ...fronts].map((p) => p.id).find((id) => !onCourt(s).flat().includes(id))!;
  const starter = onCourt(s).flat()[0];
  s = trackStints(swapPlayers(s, 60_000, starter, benchGuy));
  assert.equal(s.offPlan, true, "an unplanned sub offers Rebalance");
  const targets = minuteTargets(s.players.map((p) => p.id), 2400);
  const plan = planRebalance(s, targets, DEFAULT_REBALANCE_RULES);
  assert.equal(plan.firstShift, 1, "plans from the next shift");
  assert.ok(plan.shifts.length > 0);
  const before = courtSpots(s).map((x) => x.id).sort();
  s = applyRebalance(s, 60_000, plan);
  assert.equal(s.offPlan, false);
  assert.deepEqual(courtSpots(s).map((x) => x.id).sort(), before, "the current five play out this shift");
  s = makeSub(settle(startClock(s, 60_000), 150_000), 150_000);
  assert.deepEqual(courtSpots(s).map((x) => x.id), plan.shifts[0], "the next sub follows the new plan");
  s = undoLast(undoLast(s, 150_000), 150_000);
  assert.equal(s.script ?? null, null, "undo steps back to before the rebalance");
  assert.notEqual(s.groups[0].key, "all");
}

console.log("basketball-rebalance: all checks passed");
