import assert from "node:assert/strict";
import { MAX_SEASON_NUDGE_SEC, minuteTargets, paceOf, seasonBeforeGame } from "../src/lib/basketball-targets.ts";

const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
const GAME = 40 * 60;

// Even split with no season: 40 min × 5 / 9 players.
{
  const t = minuteTargets(ids, GAME);
  for (const id of ids) assert.equal(Math.round(t.get(id)!.targetSec), Math.round((GAME * 5) / 9));
}

// Season nudges: behind gets more, ahead gets less, total unchanged, capped.
{
  const season = new Map(ids.map((id, i) => [id, { seconds: (1200 + i * 100) * 2, games: 2 }]));
  season.set("a", { seconds: 0, games: 2 }); // way behind
  const t = minuteTargets(ids, GAME, season);
  const total = [...t.values()].reduce((s, x) => s + x.targetSec, 0);
  assert.ok(Math.abs(total - GAME * 5) < 1e-6, "team total stays the game × 5");
  assert.ok(t.get("a")!.adjustSec > 0 && t.get("i")!.adjustSec < 0);
  assert.ok(t.get("a")!.adjustSec <= MAX_SEASON_NUDGE_SEC + 60, "nudge is capped (plus re-centering)");
}

// Newcomers (no games yet) aren't nudged by the formula.
{
  const t = minuteTargets(["a", "b", "new"], GAME, new Map([["a", { seconds: 600, games: 1 }], ["b", { seconds: 1800, games: 1 }]]), 2);
  assert.ok(t.get("a")!.targetSec > t.get("b")!.targetSec);
}

// Pace: halfway through, half the target is expected.
{
  assert.equal(paceOf(300, 1200, 0.5).status, "owed");
  assert.equal(paceOf(600, 1200, 0.5).status, "on-track");
  assert.equal(paceOf(900, 1200, 0.5).status, "over");
  assert.equal(paceOf(0, 1200, 0).status, "on-track", "nobody is owed before tip-off");
}

// Season before this game subtracts what this game already saved.
{
  const before = seasonBeforeGame([{ playerId: 1, seconds: 3000, games: 3 }, { playerId: 2, seconds: 1000, games: 1 }], new Map([[1, 600]]));
  assert.deepEqual(before.get("1"), { seconds: 2400, games: 2 });
  assert.deepEqual(before.get("2"), { seconds: 1000, games: 1 });
}

console.log("basketball-targets: all checks passed");
