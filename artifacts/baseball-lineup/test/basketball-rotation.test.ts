import assert from "node:assert/strict";
import {
  buildRotation,
  DEFAULT_BASKETBALL_SETTINGS,
  frontWindowOk,
  guardWindowOk,
  queueIsValid,
  reshuffleStartingOrder,
  type BasketballPlayer,
} from "../src/lib/basketball-rotation.ts";

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
    guards: ["Brody", "Vinnie J"],
    front: ["Anders", "Henry", "Rory"],
    bench: ["Bash", "Luke", "Miles", "Vinnie V"],
    in: [], out: [],
  });
  assert.equal(second.clock, "17:30");
  assert.deepEqual(second.guards, ["Brody", "Luke"]);
  assert.deepEqual(second.front, ["Bash", "Henry", "Rory"]);
  assert.deepEqual(second.in, ["Bash", "Luke"]);
  assert.deepEqual(second.out, ["Anders", "Vinnie J"]);
  assert.equal(third.clock, "15:00");
  assert.deepEqual(third.guards, ["Luke", "Vinnie V"]);
  assert.deepEqual(third.front, ["Bash", "Miles", "Rory"]);
  assert.deepEqual(third.in, ["Miles", "Vinnie V"]);
  assert.deepEqual(third.out, ["Brody", "Henry"]);

  // Queues continue through halftime: 2nd half opens on shift 8, not a reset.
  const secondHalfStart = result.halves[1].rows[0];
  assert.equal(secondHalfStart.clock, "20:00");
  assert.deepEqual(secondHalfStart.guards, ["Brody", "Vinnie J"], "guard window at shift 8 = 8 mod 4 = 0");
  assert.deepEqual(secondHalfStart.front, ["Anders", "Bash", "Miles"], "front window at shift 8 starts at 8 mod 5 = 3");
  assert.equal(secondHalfStart.in.length, 2, "subs still happen at the start of the 2nd half");

  // Last shift is flex.
  const last = result.halves[1].rows[7];
  assert.equal(last.flex, true);
  assert.deepEqual([last.guards, last.front, last.bench, last.in, last.out], [[], [], [], [], []]);
  assert.equal(result.halves.flatMap(h => h.rows).filter(r => r.flex).length, 1);

  // Every sub is 1 guard + 1 front.
  for (const row of result.halves.flatMap(h => h.rows).filter(r => !r.flex && r.shift > 0)) {
    assert.equal(row.in.length, 2, `shift ${row.shift}: two in`);
    assert.equal(row.in.filter(n => guards.some(g => g.name === n)).length, 1, `shift ${row.shift}: one guard in`);
    assert.equal(row.out.filter(n => guards.some(g => g.name === n)).length, 1, `shift ${row.shift}: one guard out`);
  }

  // Every name list is sorted.
  for (const row of result.halves.flatMap(h => h.rows)) {
    for (const list of [row.guards, row.front, row.bench, row.in, row.out]) {
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
    assert.equal(row.guards.length, 2);
    assert.equal(row.front.length, 3);
    assert.equal(row.bench.length, 3);
    const onGuards = guards.filter(g => row.guards.includes(g.name));
    assert.ok(guardWindowOk(onGuards), `shift ${row.shift}: a 1 and a 2 on court`);
    assert.ok(row.front.includes("Eli") || row.front.includes("Gus"), `shift ${row.shift}: a Big on court`);
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
    const g = order.guardOrder.map(id => guards.find(p => p.id === id)!);
    const f = order.frontOrder.map(id => fronts.find(p => p.id === id)!);
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
  assert.ok(oneOut.halves.flatMap(h => h.rows).every(r => ![...r.guards, ...r.bench].includes("Luke")));

  // Only one guard: a non-Big front player fills in and it's flagged.
  const oneGuard = buildRotation({ players, settings: DEFAULT_BASKETBALL_SETTINGS, absentIds: ["Brody", "Luke", "Vinnie V"] });
  assert.ok(oneGuard.warnings.some(w => w.includes("fills in at guard")));
  const filler = oneGuard.minutes.find(m => m.playingAs === "guard");
  assert.ok(filler && !filler.big, "a non-Big is borrowed first");
  assert.ok(oneGuard.halves[0].rows.every(r => r.guards.length === 2));

  // Too few players overall: plays short, warns, doesn't throw.
  const short = buildRotation({ players: [guard("A"), front("B", true), front("C")], settings: DEFAULT_BASKETBALL_SETTINGS });
  assert.ok(short.warnings.some(w => w.includes("short-handed")));
  assert.equal(short.halves[0].rows[0].guards.length + short.halves[0].rows[0].front.length, 3);

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

console.log("basketball-rotation: all checks passed");
