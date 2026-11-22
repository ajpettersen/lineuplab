import assert from "node:assert/strict";
import { buildRotation, DEFAULT_BASKETBALL_SETTINGS, type BasketballPlayer } from "../src/lib/basketball-rotation.ts";
import { positionMinutes, priorityNotes, prioritizeGroups, seasonGaps } from "../src/lib/basketball-priority.ts";

const season = new Map([
  ["a", { seconds: 3000, availableGames: 2, starts: 2 }],
  ["b", { seconds: 2000, availableGames: 2, starts: 0 }], // 8:20 a game behind a
  ["c", { seconds: 2600, availableGames: 2, starts: 1 }],
  ["new", { seconds: 0, availableGames: 0, starts: 0 }],
]);

// Gaps per available game; newcomers have none.
{
  const gaps = seasonGaps(["a", "b", "c", "new"], season);
  assert.ok(gaps.get("b")!.minutesSec > gaps.get("c")!.minutesSec && gaps.get("c")!.minutesSec > gaps.get("a")!.minutesSec);
  assert.deepEqual(gaps.get("new"), { minutesSec: 0, starts: 0 });
}

// Most behind first within each group; groups stay separate.
{
  // c is a little ahead of the average; a newcomer counts as average.
  assert.deepEqual(prioritizeGroups([["a", "b"], ["c", "new"]], season), [["b", "a"], ["new", "c"]]);
}

// In a real rotation the front of the queue gets the starts and the extra shift.
{
  const guards: BasketballPlayer[] = ["g1", "g2", "g3", "g4"].map((id) => ({ id, name: id, role: "guard", position: null }));
  const fronts: BasketballPlayer[] = ["f1", "f2", "f3", "f4", "f5"].map((id) => ({ id, name: id, role: "front" }));
  const s = new Map([...guards, ...fronts].map((p) => [p.id, { seconds: 1500 * 2, availableGames: 2, starts: 1 }]));
  s.set("g4", { seconds: 900 * 2, availableGames: 2, starts: 0 }); // behind
  s.set("f5", { seconds: 900 * 2, availableGames: 2, starts: 0 }); // behind
  const ids = [guards.map((p) => p.id), fronts.map((p) => p.id)];
  // Which places pay most depends on the settings: measure them first.
  const trial = buildRotation({ players: [...guards, ...fronts], settings: DEFAULT_BASKETBALL_SETTINGS, order: ids.flat() });
  const value = positionMinutes(ids, new Map(trial.minutes.map((m) => [m.id, m.minutes])));
  const [g, f] = prioritizeGroups(ids, s, value, [2, 3]);
  const r = buildRotation({ players: [...guards, ...fronts], settings: DEFAULT_BASKETBALL_SETTINGS, order: [...g, ...f] });
  const starters = r.halves[0].rows[0].groups.flatMap((x) => x.ids);
  const planned = new Map(r.minutes.map((m) => [m.id, m.minutes * 60]));
  const most = (group: string[]) => Math.max(...group.map((id) => planned.get(id)!));
  assert.equal(planned.get("g4"), most(g), "the guard behind gets the most guard time");
  assert.equal(planned.get("f5"), most(f), "the front player behind gets the most front time");
  const notes = priorityNotes([...guards, ...fronts], planned, starters, s, DEFAULT_BASKETBALL_SETTINGS.shiftMinutes * 60, [g, f]);
  assert.match(notes.get("g4") ?? "", /min a game behind/);
  // Fronts all play the same here (no extra shift to give), so f5 gets the start.
  assert.match(notes.get("f5") ?? "", /fewer start/);
  assert.equal(notes.get("g1"), undefined, "no note for players who aren't behind");
}

console.log("basketball-priority: all checks passed");
