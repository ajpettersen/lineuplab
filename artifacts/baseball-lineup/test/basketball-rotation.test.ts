import assert from "node:assert/strict";
import {
  buildRotation,
  roleIn,
  stickySpots,
  subSplit,
  DEFAULT_BASKETBALL_SETTINGS,
  frontWindowOk,
  guardWindowOk,
  queueIsValid,
  reshuffleStartingOrder,
  type BasketballPlayer,
} from "../src/lib/basketball-rotation.ts";
import type { RotationRow } from "../src/lib/basketball-rotation.ts";

/** On-court names by group (Guards / Front layout). */
const G = (row: RotationRow) => row.groups[0]?.names ?? [];
const F = (row: RotationRow) => row.groups[1]?.names ?? [];

const guard = (name: string, position?: "1" | "2"): BasketballPlayer => ({ id: name, name, role: "guard", position: position ?? null });
const front = (name: string, big = false): BasketballPlayer => ({ id: name, name, role: "front", big });

/** Seeded random so reshuffle tests are repeatable. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

// ── The bench-sheet test case ─────────────────────────────────────────────
{
  const guards = [guard("Vinnie J"), guard("Brody"), guard("Luke"), guard("Vinnie V")];
  const fronts = [front("Anders", true), front("Henry"), front("Rory", true), front("Bash"), front("Miles", true)];
  const result = buildRotation({
    players: [...guards, ...fronts],
    settings: DEFAULT_BASKETBALL_SETTINGS,
    guardOrder: guards.map(p => p.id),
    frontOrder: fronts.map(p => p.id),
  });

  assert.deepEqual(result.warnings, [], "no warnings for the standard roster");
  assert.equal(result.halves[0].rows.length, 8, "8 shifts a half");
  assert.equal(result.halves[1].rows.length, 8);
  assert.deepEqual(result.halves[0].rows.map(r => r.clock), ["20:00", "17:30", "15:00", "12:30", "10:00", "7:30", "5:00", "2:30"]);

  const [first, second, third] = result.halves[0].rows;
  assert.deepEqual(first, {
    shift: 0, half: 1, clock: "20:00", minutes: 2.5, flex: false,
    bench: ["Bash", "Luke", "Miles", "Vinnie V"],
    in: [], out: [],
    groups: [
      { key: "guard", label: "Guards", ids: ["Vinnie J", "Brody"], names: ["Brody", "Vinnie J"] },
      { key: "front", label: "Front", ids: ["Anders", "Henry", "Rory"], names: ["Anders", "Henry", "Rory"] },
    ],
  });
  assert.equal(second.clock, "17:30");
  assert.deepEqual(G(second), ["Brody", "Luke"]);
  assert.deepEqual(F(second), ["Bash", "Henry", "Rory"]);
  assert.deepEqual(second.in, ["Bash", "Luke"]);
  assert.deepEqual(second.out, ["Anders", "Vinnie J"]);
  assert.equal(third.clock, "15:00");
  assert.deepEqual(G(third), ["Luke", "Vinnie V"]);
  assert.deepEqual(F(third), ["Bash", "Miles", "Rory"]);
  assert.deepEqual(third.in, ["Miles", "Vinnie V"]);
  assert.deepEqual(third.out, ["Brody", "Henry"]);

  // Queues continue through halftime: 2nd half opens on shift 8, not a reset.
  const secondHalfStart = result.halves[1].rows[0];
  assert.equal(secondHalfStart.clock, "20:00");
  assert.deepEqual(G(secondHalfStart), ["Brody", "Vinnie J"], "guard window at shift 8 = 8 mod 4 = 0");
  assert.deepEqual(F(secondHalfStart), ["Anders", "Bash", "Miles"], "front window at shift 8 starts at 8 mod 5 = 3");
  assert.equal(secondHalfStart.in.length, 2, "subs still happen at the start of the 2nd half");

  // Last shift is flex.
  const last = result.halves[1].rows[7];
  assert.equal(last.flex, true);
  assert.deepEqual([G(last), F(last), last.bench, last.in, last.out], [[], [], [], [], []]);
  assert.equal(result.halves.flatMap(h => h.rows).filter(r => r.flex).length, 1);

  // Every sub is 1 guard + 1 front.
  for (const row of result.halves.flatMap(h => h.rows).filter(r => !r.flex && r.shift > 0)) {
    assert.equal(row.in.length, 2, `shift ${row.shift}: two in`);
    assert.equal(row.in.filter(n => guards.some(g => g.name === n)).length, 1, `shift ${row.shift}: one guard in`);
    assert.equal(row.out.filter(n => guards.some(g => g.name === n)).length, 1, `shift ${row.shift}: one guard out`);
  }

  // Every name list is sorted.
  for (const row of result.halves.flatMap(h => h.rows)) {
    for (const list of [G(row), F(row), row.bench, row.in, row.out]) {
      assert.deepEqual(list, [...list].sort((a, b) => a.localeCompare(b)), `shift ${row.shift} sorted`);
    }
  }

  const minutes = Object.fromEntries(result.minutes.map(m => [m.name, m.minutes]));
  assert.deepEqual(minutes, {
    Anders: 22.5, Bash: 22.5, Henry: 22.5, Miles: 22.5, Rory: 22.5,
    Brody: 20, Luke: 20,
    "Vinnie J": 17.5, "Vinnie V": 17.5,
  });
  assert.deepEqual(result.minutes.map(m => m.minutes), [...result.minutes.map(m => m.minutes)].sort((a, b) => b - a), "sorted by minutes, most first");
  for (const m of result.minutes) assert.ok(m.longestSit <= 5, `${m.name} sits ${m.longestSit} in a row`);

  // Fewest minutes (Vinnie J, Vinnie V) + sat both shifts before the flex (Vinnie J, Rory).
  assert.deepEqual(result.flexSuggestion, ["Rory", "Vinnie J", "Vinnie V"]);

  // The order meets the Big rule.
  assert.ok(queueIsValid(fronts, 3, frontWindowOk));
}

// ── 4 guards / 4 front ────────────────────────────────────────────────────
{
  const guards = [guard("Ava", "1"), guard("Ben", "2"), guard("Cal", "1"), guard("Dev", "2")];
  const fronts = [front("Eli", true), front("Finn"), front("Gus", true), front("Hal")];
  const result = buildRotation({
    players: [...guards, ...fronts],
    settings: DEFAULT_BASKETBALL_SETTINGS,
    guardOrder: guards.map(p => p.id),
    frontOrder: fronts.map(p => p.id),
  });
  assert.deepEqual(result.warnings, []);
  const rows = result.halves.flatMap(h => h.rows);
  assert.equal(rows.length, 16);
  for (const row of rows.filter(r => !r.flex)) {
    assert.equal(G(row).length, 2);
    assert.equal(F(row).length, 3);
    assert.equal(row.bench.length, 3);
    const onGuards = guards.filter(g => G(row).includes(g.name));
    assert.ok(guardWindowOk(onGuards), `shift ${row.shift}: a 1 and a 2 on court`);
    assert.ok(F(row).includes("Eli") || F(row).includes("Gus"), `shift ${row.shift}: a Big on court`);
  }
  const minutes = Object.fromEntries(result.minutes.map(m => [m.name, m.minutes]));
  // 15 shifts × 3 front spots / 4 players; window of 3 over 4: each sits every 4th shift.
  assert.deepEqual(minutes, {
    Ava: 17.5, Ben: 20, Cal: 20, Dev: 17.5,
    Eli: 27.5, Finn: 27.5, Gus: 30, Hal: 27.5,
  });
  for (const m of result.minutes) {
    assert.ok(m.longestSit <= (m.role === "guard" ? 5 : 2.5), `${m.name} longest sit ${m.longestSit}`);
  }

  // A bad guard order (two 1s together) is flagged, not crashed on.
  const bad = buildRotation({
    players: [...guards, ...fronts],
    settings: DEFAULT_BASKETBALL_SETTINGS,
    guardOrder: ["Ava", "Cal", "Ben", "Dev"],
  });
  assert.ok(bad.warnings.some(w => w.includes("same position")), "same-position pairing is warned");

  // Reshuffle always finds a valid order when one exists.
  for (let seed = 1; seed <= 50; seed++) {
    const order = reshuffleStartingOrder([...guards, ...fronts], DEFAULT_BASKETBALL_SETTINGS, [], seeded(seed));
    const g = order.filter(id => guards.some(p => p.id === id)).map(id => guards.find(p => p.id === id)!);
    const f = order.filter(id => fronts.some(p => p.id === id)).map(id => fronts.find(p => p.id === id)!);
    assert.ok(queueIsValid(g, 2, guardWindowOk), `seed ${seed}: guards alternate`);
    assert.ok(queueIsValid(f, 3, frontWindowOk), `seed ${seed}: a Big in every front group`);
  }
}

// ── Attendance and short rosters ──────────────────────────────────────────
{
  const guards = [guard("Vinnie J"), guard("Brody"), guard("Luke"), guard("Vinnie V")];
  const fronts = [front("Anders", true), front("Henry"), front("Rory", true), front("Bash"), front("Miles", true)];
  const players = [...guards, ...fronts];

  // One kid out: rotation rebuilds from whoever is present.
  const oneOut = buildRotation({ players, settings: DEFAULT_BASKETBALL_SETTINGS, absentIds: ["Luke"] });
  assert.ok(oneOut.minutes.every(m => m.name !== "Luke"));
  assert.ok(oneOut.halves.flatMap(h => h.rows).every(r => ![...G(r), ...r.bench].includes("Luke")));

  // Only one guard: a non-Big front player fills in and it's flagged.
  const oneGuard = buildRotation({ players, settings: DEFAULT_BASKETBALL_SETTINGS, absentIds: ["Brody", "Luke", "Vinnie V"] });
  assert.ok(oneGuard.warnings.some(w => w.includes("fills in at guard")));
  const filler = oneGuard.minutes.find(m => m.playingAs === "Guard");
  assert.ok(filler && !filler.big, "a non-Big is borrowed first");
  assert.ok(oneGuard.halves[0].rows.every(r => G(r).length === 2));

  // Nobody tagged Guard (e.g. a fresh import with no positions): one clear warning, still 2 at guard.
  const noGuards = buildRotation({ players: players.map(p => ({ ...p, role: "front" as const })), settings: DEFAULT_BASKETBALL_SETTINGS });
  const guardWarnings = noGuards.warnings.filter(w => w.includes("in at guard"));
  assert.equal(guardWarnings.length, 1, "one combined warning, not one per player");
  assert.match(guardWarnings[0], /^Nobody here is set as a Guard, so .+ and .+ \(Front\) fill in at guard\./);
  assert.ok(noGuards.halves[0].rows.every(r => G(r).length === 2));

  // Too few players overall: plays short, warns, doesn't throw.
  const short = buildRotation({ players: [guard("A"), front("B", true), front("C")], settings: DEFAULT_BASKETBALL_SETTINGS });
  assert.ok(short.warnings.some(w => w.includes("short-handed")));
  assert.equal(G(short.halves[0].rows[0]).length + F(short.halves[0].rows[0]).length, 3);

  // No Bigs possible in every window: warns.
  const fewBigs = buildRotation({
    players: [front("P", true), front("Q"), front("R"), front("S"), front("T"), front("U"), guard("G1"), guard("G2")],
    settings: DEFAULT_BASKETBALL_SETTINGS,
  });
  assert.ok(fewBigs.warnings.some(w => w.includes("Not enough Bigs")));

  // Nobody present and bad settings: warnings, empty sheet.
  assert.deepEqual(buildRotation({ players, settings: DEFAULT_BASKETBALL_SETTINGS, absentIds: players.map(p => p.id) }).halves, []);
  assert.deepEqual(buildRotation({ players, settings: { ...DEFAULT_BASKETBALL_SETTINGS, shiftMinutes: 0 } }).halves, []);

  // Uneven halves end with a shorter shift.
  const uneven = buildRotation({ players, settings: { ...DEFAULT_BASKETBALL_SETTINGS, shiftMinutes: 3 } });
  assert.deepEqual(uneven.halves[0].rows.map(r => r.clock), ["20:00", "17:00", "14:00", "11:00", "8:00", "5:00", "2:00"]);
  assert.equal(uneven.halves[0].rows[6].minutes, 2);
  assert.ok(uneven.warnings.some(w => w.includes("don't split evenly")));
}

// ── Subs at a time ─────────────────────────────────────────────────────────
{
  const guards = [guard("Vinnie J"), guard("Brody"), guard("Luke"), guard("Vinnie V")];
  const fronts = [front("Anders", true), front("Henry"), front("Rory", true), front("Bash"), front("Miles", true)];
  const run = (subSize: number) =>
    buildRotation({
      players: [...guards, ...fronts],
      settings: { ...DEFAULT_BASKETBALL_SETTINGS, subSize },
      guardOrder: guards.map((p) => p.id),
      frontOrder: fronts.map((p) => p.id),
    });
  const isGuard = (n: string) => guards.some((g) => g.name === n);
  const subRows = (r: ReturnType<typeof run>) => r.halves.flatMap((h) => h.rows).filter((row) => !row.flex && row.shift > 0);

  // 2 at a time is the default and matches the sheet without the setting.
  assert.deepEqual(run(2).halves, buildRotation({ players: [...guards, ...fronts], settings: { ...DEFAULT_BASKETBALL_SETTINGS, subSize: undefined }, guardOrder: guards.map((p) => p.id), frontOrder: fronts.map((p) => p.id) }).halves);

  for (const k of [1, 2, 3, 4]) {
    const r = run(k);
    assert.deepEqual(
      r.warnings,
      k === 1 ? ["Some players sit 10:00 in a row. Shorter shifts or more subs at a time spread the minutes more evenly."] : [],
      `${k} at a time: warnings`,
    );
    for (const row of subRows(r)) {
      assert.equal(row.in.length, k, `${k} at a time, shift ${row.shift}: ${k} in`);
      assert.equal(row.out.length, k, `${k} at a time, shift ${row.shift}: ${k} out`);
      assert.equal(row.in.filter(isGuard).length, row.out.filter(isGuard).length, "guards only swap with guards");
    }
  }
  // 1 at a time alternates front, guard, front…
  const one = subRows(run(1));
  assert.deepEqual(one.slice(0, 4).map((r) => isGuard(r.in[0])), [false, true, false, true]);
  // 3 at a time alternates 1 guard + 2 front, then 2 guards + 1 front.
  const three = subRows(run(3));
  assert.deepEqual(three.slice(0, 2).map((r) => r.in.filter(isGuard).length), [1, 2]);
  // 4 at a time = 2 guards + 2 front every time.
  assert.ok(subRows(run(4)).every((r) => r.in.filter(isGuard).length === 2));
  // 5 at a time: only 2 guards and 2 front are on the bench, so it's 4 at a time, with a warning.
  const five = run(5);
  assert.ok(five.warnings.some((w) => w.includes("4 at a time")));
  assert.ok(subRows(five).every((r) => r.in.length === 4));
  // Minutes stay fair inside each group whatever the sub size.
  for (const k of [3, 4]) {
    const m = Object.fromEntries(run(k).minutes.map((x) => [x.name, x.minutes]));
    const frontMins = fronts.map((f) => m[f.name]);
    assert.ok(Math.max(...frontMins) - Math.min(...frontMins) <= 5, `${k} at a time: front minutes within 5`);
  }

  // The split rule on its own.
  const g = { queue: 4, spots: 2 };
  const f = { queue: 5, spots: 3 };
  assert.deepEqual(subSplit(1, 2, [g, f]), [1, 1]);
  assert.deepEqual(subSplit(1, 1, [g, f]), [0, 1]);
  assert.deepEqual(subSplit(2, 1, [g, f]), [1, 0]);
  assert.deepEqual(subSplit(1, 5, [g, { queue: 6, spots: 3 }]), [2, 3], "a full line change with a deep bench");
  assert.deepEqual(subSplit(1, 2, [{ queue: 2, spots: 2 }, f]), [0, 2], "no bench guards: both subs are front");
}

// ── Sticky spots: players who stay on keep their spot ─────────────────────
{
  const players = [guard("A"), guard("B"), guard("C"), front("D", true), front("E"), front("F", true), front("G")];
  const first = new Map(stickySpots([{ ids: ["A", "B"], spots: [1, 2] }, { ids: ["D", "E", "F"], spots: [3, 4, 5] }], players, null).map((s) => [s.id, s.spot!]));
  assert.equal(first.get("E"), 3, "non-Big at the 3");
  // A and F stay; C comes in for B, G (non-Big) comes in for D (Big).
  const next = new Map(stickySpots([{ ids: ["A", "C"], spots: [1, 2] }, { ids: ["E", "F", "G"], spots: [3, 4, 5] }], players, first).map((s) => [s.id, s.spot!]));
  assert.equal(next.get("A"), first.get("A"), "A keeps their spot");
  assert.equal(next.get("F"), first.get("F"), "F keeps their spot");
  assert.equal(next.get("E"), 3);
  assert.equal(next.get("C"), first.get("B"), "C takes B's spot");
  assert.equal(next.get("G"), first.get("D"), "G takes the open post spot");
}

// ── Position groups: Guards / Forwards / Center ────────────────────────────
{
  const guards = [guard("Vinnie J"), guard("Brody"), guard("Luke"), guard("Vinnie V")];
  const fronts = [front("Anders", true), front("Henry"), front("Rory", true), front("Bash"), front("Miles", true)];
  const settings = { ...DEFAULT_BASKETBALL_SETTINGS, groupLayout: "guards-forwards-center" as const };
  // Roles saved as Guard / Front carry over: Bigs become centers, others forwards.
  assert.equal(roleIn("guards-forwards-center", fronts[0]), "center");
  assert.equal(roleIn("guards-forwards-center", fronts[1]), "forward");
  assert.equal(roleIn("guards-forwards-center", guards[0]), "guard");
  assert.equal(roleIn("perimeter-bigs", fronts[1]), "perimeter");
  assert.equal(roleIn("five-out", guards[0]), "all");

  const r = buildRotation({ players: [...guards, ...fronts], settings, order: [...guards, ...fronts].map((p) => p.id) });
  assert.deepEqual(r.groups.map((g) => g.key), ["guard", "forward", "center"]);
  assert.deepEqual(r.warnings, []);
  const rows = r.halves.flatMap((h) => h.rows).filter((row) => !row.flex);
  const centers = ["Anders", "Rory", "Miles"];
  for (const row of rows) {
    assert.equal(row.groups[0].ids.length, 2, "2 guards");
    assert.equal(row.groups[1].ids.length, 2, "2 forwards");
    assert.equal(row.groups[2].ids.length, 1, "1 center");
    assert.ok(centers.includes(row.groups[2].ids[0]), "the center is a Big");
    if (row.shift > 0) {
      for (const name of row.in) {
        const wentOut = row.out;
        // A center only comes in for a center, a guard for a guard.
        const group = (n: string) => (guards.some((g) => g.name === n) ? "g" : centers.includes(n) ? "c" : "f");
        assert.ok(wentOut.some((o) => group(o) === group(name)), `${name} replaces someone in the same group`);
      }
    }
  }
  // Henry and Bash are the only forwards, so they play every shift.
  const m = Object.fromEntries(r.minutes.map((x) => [x.name, x.minutes]));
  assert.equal(m["Henry"], 37.5);
  assert.equal(m["Bash"], 37.5);
  const centerMins = centers.map((c) => m[c]);
  assert.ok(Math.max(...centerMins) - Math.min(...centerMins) <= 2.5, "centers share the 5 evenly");
  assert.equal(r.minutes.find((x) => x.name === "Anders")!.roleLabel, "Center");
  // Spots: guards 1–2, forwards 3–4, center 5.
  const row0 = rows[0];
  const spots = new Map(stickySpots(r.groups.map((g, i) => ({ ids: row0.groups[i].ids, spots: g.spots })), [...guards, ...fronts], null).map((x) => [x.spot, x.id]));
  assert.ok(centers.includes(spots.get(5)!));
  assert.ok(["Henry", "Bash"].includes(spots.get(3)!) && ["Henry", "Bash"].includes(spots.get(4)!));
}

// ── Everyone flexes: one group, the whole roster rotates ──────────────────
{
  const players = ["A", "B", "C", "D", "E", "F", "G"].map((n) => guard(n));
  const r = buildRotation({ players, settings: { ...DEFAULT_BASKETBALL_SETTINGS, groupLayout: "five-out" } });
  assert.deepEqual(r.groups.map((g) => g.key), ["all"]);
  const mins = r.minutes.map((x) => x.minutes);
  assert.ok(Math.max(...mins) - Math.min(...mins) <= 5, "even minutes");
  assert.ok(r.halves[0].rows.every((row) => row.groups[0].ids.length === 5));
}

console.log("basketball-rotation: all checks passed");
