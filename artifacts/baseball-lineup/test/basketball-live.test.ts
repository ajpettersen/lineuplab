import assert from "node:assert/strict";
import { buildRotation, DEFAULT_BASKETBALL_SETTINGS, type BasketballPlayer } from "../src/lib/basketball-rotation.ts";
import {
  bench,
  courtSpots,
  currentShift,
  makeSub,
  nextSub,
  nextSubPairs,
  onCourt,
  putBack,
  setSubSize,
  spotsOf,
  secondsToNextSub,
  setClock,
  nudgeClock,
  settle,
  skipSub,
  startClock,
  startState,
  stopClock,
  subDue,
  swapPlayers,
  takeOut,
  undoLast,
  addFoul,
  foulsOf,
  FOUL_OUT,
  addPoints,
  addOppFoul,
  teamFoulsOf,
  bonusLabel,
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
  assert.deepEqual(sorted(onCourt(s)[0]), ["Brody", "Vinnie J"]);
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
    if (!seen.some((x) => x.shift === shift)) seen.push({ shift, guards: sorted(onCourt(s)[0]), front: sorted(onCourt(s)[1]) });
  }
  assert.equal(s.phase, "final");
  for (const row of plan.filter((r) => !r.flex)) {
    const got = seen.find((x) => x.shift === row.shift);
    if (row.shift === 0) continue;
    assert.ok(got, `shift ${row.shift} seen`);
    assert.deepEqual(got!.guards, row.groups[0].names, `shift ${row.shift} guards`);
    assert.deepEqual(got!.front, row.groups[1].names, `shift ${row.shift} front`);
  }
  assert.equal(s.subsMade, 14, "14 planned subs; none during the flex shift");
  // Minutes before flex match the sheet; the flex shift adds 2.5 for whoever stayed on.
  const sheet = Object.fromEntries(buildRotation(input).minutes.map((m) => [m.id, m.minutes * 60]));
  const onInFlex = new Set([...onCourt(s)[0], ...onCourt(s)[1]]);
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
  assert.deepEqual(sorted(onCourt(s)[0]), ["Brody", "Luke"]);
  s = settle(s, 151_000);
  assert.equal(currentShift(s), 1);
  assert.equal(subDue(s), false, "the early sub counts for the 17:30 sub time");
  s = settle(s, 301_000);
  assert.equal(subDue(s), true, "the next one is due at 15:00");
  s = undoLast(s, 301_000);
  assert.deepEqual(sorted(onCourt(s)[0]), ["Brody", "Vinnie J"]);
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
  assert.deepEqual(sorted(onCourt(s)[0]), ["Vinnie J", "Vinnie V"]);
  assert.ok(bench(s).includes("Brody"));
  // Take out a front player who is on court: the next in line fills the spot.
  s = takeOut(s, 0, "Henry");
  assert.deepEqual(sorted(onCourt(s)[1]), ["Anders", "Bash", "Rory"]);
  assert.ok(s.outIds.includes("Henry"));
  assert.equal(s.queues[1].length, 4);
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
  assert.equal(spotsOf(t)[1], 2);
  assert.equal(onCourt(t)[1].length, 2);
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

// ── Subs at a time in the live game match the sheet ───────────────────────
for (const subSize of [1, 3, 4]) {
  const inp = { ...input, settings: { ...DEFAULT_BASKETBALL_SETTINGS, subSize } };
  const plan = buildRotation(inp).halves.flatMap((h) => h.rows);
  let s = startClock(startState(inp), 0);
  let now = 0;
  for (let step = 0; step < 16 * SHIFT; step += 30) {
    now += 30_000;
    s = settle(s, now);
    if (s.phase === "halftime") s = startClock(s, now);
    if (subDue(s)) s = makeSub(s, now);
    const row = plan.find((r) => r.shift === currentShift(s));
    if (row && !row.flex && s.phase === "live") {
      assert.deepEqual(sorted(onCourt(s)[0]), row.groups[0].names, `${subSize} at a time, shift ${row.shift}`);
      assert.deepEqual(sorted(onCourt(s)[1]), row.groups[1].names, `${subSize} at a time, shift ${row.shift}`);
    }
  }
}
{
  // Changing it mid-game takes effect on the next sub.
  let s = startClock(startState(input), 0);
  s = setSubSize(s, 4);
  assert.equal(nextSub(s).in.length, 4);
  s = setSubSize(s, 9);
  assert.equal(s.settings.subSize, 5);
}

// ── Who goes in for whom ──────────────────────────────────────────────────
{
  let s = startClock(startState(input), 0);
  assert.deepEqual(nextSubPairs(s), [{ in: "Luke", out: "Vinnie J" }, { in: "Bash", out: "Anders" }], "guard for guard, front for front");
  s = makeSub(s, 1000);
  assert.deepEqual(nextSubPairs(s), [{ in: "Vinnie V", out: "Brody" }, { in: "Miles", out: "Henry" }]);
  const one = startClock(startState({ ...input, settings: { ...DEFAULT_BASKETBALL_SETTINGS, subSize: 1 } }), 0);
  assert.deepEqual(nextSubPairs(one), [{ in: "Bash", out: "Anders" }], "1 at a time starts with the front court");
}

// ── Setting the clock by hand moves on-court time with it ─────────────────
{
  let s = startState(input); // clock stopped, 20:00
  s = setClock(s, 0, 1200 - 90); // ran 1:30 that wasn't timed
  assert.equal(s.playedSec["Brody"], 90, "on-court players get the time");
  assert.equal(s.playedSec["Luke"], 0, "bench players don't");
  s = nudgeClock(s, 0, -1);
  assert.equal(s.playedSec["Brody"], 91, "1 second down = 1 more second played");
  s = nudgeClock(s, 0, 10);
  assert.equal(s.playedSec["Brody"], 81, "adding time back takes it off");
  assert.equal(s.clockSec, 1200 - 81);
  s = nudgeClock(s, 0, 600);
  assert.equal(s.clockSec, 1200, "can't go past the start of the half");
  assert.equal(s.playedSec["Brody"], 0, "never below zero");
  // While running, the running time and the nudge both count.
  let r = startClock(startState(input), 0);
  r = nudgeClock(r, 30_000, -60);
  assert.equal(Math.round(r.playedSec["Anders"]), 90);
  assert.equal(Math.round(r.clockSec), 1200 - 90);
}

// A coach's own plan (the Game 2 sheet): the court follows it shift by shift.
{
  const plan = [
    ["196", "204", "198", "203", "205"], ["196", "204", "197", "203", "201"], ["200", "204", "202", "197", "201"], ["200", "202", "198", "201", "205"],
    ["196", "202", "198", "203", "205"], ["196", "204", "198", "197", "203"], ["200", "204", "197", "203", "201"], ["200", "204", "202", "201", "205"],
    ["196", "200", "202", "198", "205"], ["196", "202", "198", "197", "203"], ["196", "204", "197", "203", "201"], ["200", "204", "197", "201", "205"],
    ["200", "202", "198", "201", "205"], ["196", "200", "202", "198", "203"], ["200", "204", "202", "197", "203"],
  ];
  const ids = ["196", "197", "198", "200", "201", "202", "203", "204", "205"];
  const roster = [...ids, "199"].map((id) => guard(id));
  const planned = {
    players: roster,
    settings: { ...DEFAULT_BASKETBALL_SETTINGS, flexShifts: 1 },
    order: ids,
    absentIds: ["199"],
    customShifts: plan,
  };
  const rotation = buildRotation(planned);
  assert.equal(rotation.custom, true);
  assert.deepEqual(rotation.warnings, []);
  const rows = rotation.halves.flatMap((h) => h.rows);
  assert.equal(rows.length, 16);
  assert.ok(rows[15].flex, "the last shift is the flex");
  rows.slice(0, 15).forEach((row, i) => assert.deepEqual(row.groups[0].ids, plan[i], `shift ${i + 1} follows the plan`));
  assert.deepEqual(rows[1].in.sort(), ["197", "201"]);
  const mins = Object.fromEntries(rotation.minutes.map((m) => [m.id, m.minutes]));
  assert.deepEqual(
    ids.map((id) => mins[id]).sort((a, b) => a - b),
    [17.5, 20, 20, 20, 20, 22.5, 22.5, 22.5, 22.5],
    "planned minutes match the sheet",
  );

  let s = startState(planned);
  assert.deepEqual(courtSpots(s).map((x) => x.id), plan[0], "starters at their spots");
  assert.deepEqual(sorted(nextSubPairs(s).map((p) => `${p.in}>${p.out}`)), ["197>198", "201>205"], "who goes in for whom, by spot");
  s = makeSub(s, 0);
  assert.deepEqual(courtSpots(s).map((x) => x.id), plan[1]);
  // 197 moves from the 3 to the 4: 202 goes in for 196 and 203 isn't paired with 197.
  assert.deepEqual(sorted(nextSubPairs(s).map((p) => `${p.in}>${p.out}`)), ["200>196", "202>203"]);
  s = makeSub(s, 0);
  assert.deepEqual(courtSpots(s).map((x) => x.id), plan[2]);
  // Someone on the plan leaves: the bench player with the least time covers.
  s = { ...s, playedSec: { ...s.playedSec, "196": 10, "198": 5, "203": 50, "205": 50 } };
  s = takeOut(s, 0, "204");
  assert.deepEqual(courtSpots(s).map((x) => x.id), ["200", "198", "202", "197", "201"], "the least-played sub takes the 2");
  assert.deepEqual(nextSub(s).in.includes("204"), false, "an injured player isn't planned back in");
  s = makeSub(s, 0);
  assert.deepEqual(courtSpots(s).map((x) => x.id), plan[3]);
  s = undoLast(s, 0);
  assert.deepEqual(courtSpots(s).map((x) => x.id), ["200", "198", "202", "197", "201"], "undo works with a plan");
}

// Fouls: count up to the limit, team fouls per half, the fifth fouls out.
{
  let s = startState(input);
  const starter = onCourt(s).flat()[0];
  assert.equal(foulsOf(s, starter), 0);
  for (let i = 0; i < 4; i++) s = addFoul(s, starter, 1, 0);
  assert.equal(teamFoulsOf(s), 4);
  assert.ok(onCourt(s).flat().includes(starter), "4 fouls: still on");
  s = addFoul(s, starter, 1, 0);
  assert.equal(foulsOf(s, starter), FOUL_OUT);
  assert.ok(s.outIds.includes(starter) && !onCourt(s).flat().includes(starter), "5th foul: out of the game");
  assert.equal(onCourt(s).flat().length, 5, "someone covers the spot");
  s = addFoul(s, starter, 1, 0);
  assert.equal(foulsOf(s, starter), FOUL_OUT, "stops at the limit");
  s = addFoul(s, starter, -1, 0);
  assert.ok(!s.outIds.includes(starter), "taking the 5th back brings them back");
  s = addFoul(addFoul(s, "Luke", -1, 0), "Luke", -1, 0);
  assert.equal(foulsOf(s, "Luke"), 0, "never below zero");
  // Bonus from team fouls; the other team's fouls count separately.
  assert.equal(bonusLabel(6), null);
  assert.equal(bonusLabel(7), "Bonus");
  assert.equal(bonusLabel(10), "Double bonus");
  s = addOppFoul(addOppFoul(s));
  assert.equal(teamFoulsOf(s, "them"), 2);
  // Team fouls reset at the half.
  assert.equal(teamFoulsOf({ ...s, half: 2 }), 0);
}

// Score: points for each side, logged with who was on court.
{
  let s = startState(input);
  s = addPoints(s, "us", 2, 0);
  s = addPoints(s, "us", 3, 0);
  s = addPoints(s, "them", 2, 0);
  s = addPoints(s, "them", -5, 0);
  assert.deepEqual(s.score, { us: 5, them: 0 }, "never below zero");
  assert.equal(s.scoreLog!.length, 4);
  assert.equal(s.scoreLog![3].pts, -2, "the log keeps the change actually made");
  assert.deepEqual(sorted(s.scoreLog![0].on), sorted(onCourt(s).flat()));
}

console.log("basketball-live: all checks passed");
