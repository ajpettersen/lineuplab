import assert from "node:assert/strict";
import { buildRotation, DEFAULT_BASKETBALL_SETTINGS, type BasketballPlayer } from "../src/lib/basketball-rotation.ts";
import {
  bench,
  courtSpots,
  currentShift,
  makeSub,
  nextSub,
  onCourt,
  putBack,
  secondsToNextSub,
  setClock,
  settle,
  skipSub,
  startClock,
  startState,
  stopClock,
  subDue,
  swapPlayers,
  takeOut,
  undoLast,
  type LiveState,
} from "../src/lib/basketball-live.ts";

const guard = (name: string, position?: "1" | "2"): BasketballPlayer => ({ id: name, name, role: "guard", position: position ?? null });
const front = (name: string, big = false): BasketballPlayer => ({ id: name, name, role: "front", big });
const sorted = (ids: string[]) => [...ids].sort((a, b) => a.localeCompare(b));

const guards = [guard("Vinnie J"), guard("Brody"), guard("Luke"), guard("Vinnie V")];
const fronts = [front("Anders", true), front("Henry"), front("Rory", true), front("Bash"), front("Miles", true)];
const input = {
  players: [...guards, ...fronts],
  settings: DEFAULT_BASKETBALL_SETTINGS,
  guardOrder: guards.map((p) => p.id),
  frontOrder: fronts.map((p) => p.id),
};
const SHIFT = 150; // 2.5 min

// ── Following every sub reproduces the bench sheet and its minutes ────────
{
  const plan = buildRotation(input).halves.flatMap((h) => h.rows);
  let s = startState(input);
  let now = 1_000_000;
  assert.equal(s.phase, "pregame");
  assert.deepEqual(sorted(onCourt(s).guards), ["Brody", "Vinnie J"]);
  assert.equal(subDue(s), false);
  assert.equal(secondsToNextSub(s), SHIFT);

  s = startClock(s, now);
  const seen: { shift: number; guards: string[]; front: string[] }[] = [];
  for (let step = 0; step < 16 * SHIFT; step += 30) {
    now += 30_000;
    s = settle(s, now);
    if (s.phase === "halftime") s = startClock(s, now);
    if (subDue(s)) s = makeSub(s, now);
    const shift = currentShift(s);
    if (!seen.some((x) => x.shift === shift)) seen.push({ shift, guards: sorted(onCourt(s).guards), front: sorted(onCourt(s).front) });
  }
  assert.equal(s.phase, "final");
  for (const row of plan.filter((r) => !r.flex)) {
    const got = seen.find((x) => x.shift === row.shift);
    if (row.shift === 0) continue;
    assert.ok(got, `shift ${row.shift} seen`);
    assert.deepEqual(got!.guards, row.guards, `shift ${row.shift} guards`);
    assert.deepEqual(got!.front, row.front, `shift ${row.shift} front`);
  }
  assert.equal(s.subsMade, 14, "14 planned subs; none during the flex shift");
  // Minutes before flex match the sheet; the flex shift adds 2.5 for whoever stayed on.
  const sheet = Object.fromEntries(buildRotation(input).minutes.map((m) => [m.id, m.minutes * 60]));
  const onInFlex = new Set([...onCourt(s).guards, ...onCourt(s).front]);
  for (const p of input.players) {
    assert.equal(Math.round(s.playedSec[p.id]), sheet[p.id] + (onInFlex.has(p.id) ? SHIFT : 0), `${p.name} seconds`);
  }
}

// ── Starters are recorded when the game starts, not changed by later subs ──
{
  let s = startClock(startState(input), 0);
  assert.deepEqual(sorted(s.starterIds ?? []), ["Anders", "Brody", "Henry", "Rory", "Vinnie J"]);
  s = makeSub(s, 1000);
  s = stopClock(s, 2000);
  s = startClock(s, 3000);
  assert.deepEqual(sorted(s.starterIds ?? []), ["Anders", "Brody", "Henry", "Rory", "Vinnie J"]);
}

// ── Clock: settle, stop, set, halftime ─────────────────────────────────────
{
  let s = startClock(startState(input), 0);
  s = settle(s, 100_000);
  assert.equal(s.clockSec, 1200 - 100);
  assert.equal(Math.round(s.playedSec["Brody"]), 100);
  assert.equal(s.playedSec["Luke"], 0);
  s = stopClock(s, 160_000);
  assert.equal(s.runningSince, null);
  assert.equal(Math.round(s.clockSec), 1040);
  s = settle(s, 999_000);
  assert.equal(Math.round(s.clockSec), 1040, "a stopped clock doesn't move");
  assert.equal(subDue(s), true, "160s in is past the 17:30 sub time");
  s = setClock(s, 999_000, 1100);
  assert.equal(currentShift(s), 0);
  assert.equal(subDue(s), false, "setting the clock back before a sub time clears it");
  s = setClock(s, 999_000, 1000);
  assert.equal(currentShift(s), 1);
  assert.equal(subDue(s), true, "setting the clock past a sub time makes that sub due");
  assert.equal(Math.round(secondsToNextSub(s)!), 100);
  s = setClock(s, 999_000, 1);
  s = startClock(s, 1_000_000);
  s = settle(s, 1_010_000);
  assert.equal(s.phase, "halftime");
  assert.equal(s.clockSec, 0);
  s = startClock(s, 2_000_000);
  assert.equal(s.half, 2);
  assert.equal(s.clockSec, 1200);
  assert.equal(currentShift(s), 8);
}

// ── Jump ahead and undo ────────────────────────────────────────────────────
{
  let s = startClock(startState(input), 0);
  const planned = nextSub(s);
  assert.deepEqual(sorted(planned.in), ["Bash", "Luke"]);
  assert.deepEqual(sorted(planned.out), ["Anders", "Vinnie J"]);
  s = makeSub(s, 60_000); // a minute in, before the 17:30 sub time
  assert.deepEqual(sorted(onCourt(s).guards), ["Brody", "Luke"]);
  s = settle(s, 151_000);
  assert.equal(currentShift(s), 1);
  assert.equal(subDue(s), false, "the early sub counts for the 17:30 sub time");
  s = settle(s, 301_000);
  assert.equal(subDue(s), true, "the next one is due at 15:00");
  s = undoLast(s, 301_000);
  assert.deepEqual(sorted(onCourt(s).guards), ["Brody", "Vinnie J"]);
  assert.equal(s.subsMade, 0);
  assert.equal(Math.round(s.playedSec["Luke"]), 241, "undo doesn't take back time already played");
  s = skipSub(s, 301_000);
  assert.equal(subDue(s), false, "skipping clears the due sub");
}

// ── On-the-fly changes ─────────────────────────────────────────────────────
{
  let s = startClock(startState(input), 0);
  // Swap a guard on court for one on the bench: they trade places in the rotation.
  s = swapPlayers(s, 0, "Brody", "Vinnie V");
  assert.deepEqual(sorted(onCourt(s).guards), ["Vinnie J", "Vinnie V"]);
  assert.ok(bench(s).includes("Brody"));
  // Take out a front player who is on court: the next in line fills the spot.
  s = takeOut(s, 0, "Henry");
  assert.deepEqual(sorted(onCourt(s).front), ["Anders", "Bash", "Rory"]);
  assert.ok(s.outIds.includes("Henry"));
  assert.equal(s.frontQueue.length, 4);
  // Put him back: he's next to go in.
  s = putBack(s, 0, fronts[1]);
  assert.deepEqual(nextSub(s).in.includes("Henry"), true);
  assert.deepEqual(s.outIds, []);
  // A late arrival who wasn't on the sheet.
  s = putBack(s, 0, guard("Zed"));
  assert.ok(s.players.some((p) => p.id === "Zed"));
  assert.equal(s.playedSec["Zed"], 0);
  assert.ok(nextSub(s).in.includes("Zed"));
  // Taking out until a queue is short shrinks the spots instead of breaking.
  let t = startClock(startState(input), 0);
  for (const id of ["Henry", "Rory", "Bash"]) t = takeOut(t, 0, id);
  assert.equal(t.frontSpots, 2);
  assert.equal(onCourt(t).front.length, 2);
  assert.deepEqual(nextSub(t).in.filter((id) => fronts.some((f) => f.id === id)), [], "no front sub with nobody on the bench");
}

// ── Court spots 1–5 ────────────────────────────────────────────────────────
{
  const s = startState(input);
  const spots = Object.fromEntries(courtSpots(s).map((x) => [x.spot, x.id]));
  assert.deepEqual(new Set([spots[1], spots[2]]), new Set(["Brody", "Vinnie J"]));
  assert.equal(spots[3], "Henry", "the non-Big plays the 3");
  assert.deepEqual(new Set([spots[4], spots[5]]), new Set(["Anders", "Rory"]));

  const tagged: LiveState = startState({
    players: [guard("Ava", "2"), guard("Ben", "1"), front("Cy"), front("Di"), front("Ed")],
    settings: DEFAULT_BASKETBALL_SETTINGS,
  });
  const t = Object.fromEntries(courtSpots(tagged).map((x) => [x.spot, x.id]));
  assert.equal(t[1], "Ben", "the guard tagged 1 plays the 1");
  assert.equal(t[2], "Ava");
  assert.equal(Object.keys(t).length, 5, "everyone gets a spot even with no Bigs");
}

console.log("basketball-live: all checks passed");
