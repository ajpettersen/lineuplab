import assert from "node:assert/strict";
import { DEFAULT_BASKETBALL_SETTINGS, type BasketballPlayer } from "../src/lib/basketball-rotation.ts";
import { lineupStats, type GameLog } from "../src/lib/basketball-lineups.ts";
import { addPoints, makeSub, onCourtIds, settle, startClock, startState, trackStints } from "../src/lib/basketball-live.ts";

const A = ["a", "b", "c", "d", "e"];
const B = ["a", "b", "c", "d", "f"];

// Minutes together, points for/against and +/- per five and per player.
{
  const game: GameLog = {
    gameId: 1,
    gameSec: 600,
    events: [
      { kind: "lineup", at: 0, on: A },
      { team: "us", pts: 2, at: 30, on: A },
      { team: "them", pts: 3, at: 100, on: A },
      { kind: "lineup", at: 240, on: B },
      { team: "us", pts: 2, at: 300, on: B },
      { team: "us", pts: -2, at: 301, on: B }, // a correction
      { team: "us", pts: 3, at: 500, on: B },
    ],
  };
  const { fives, players } = lineupStats([game, { ...game, gameId: 2 }]);
  const a = fives.find((f) => f.key === "a,b,c,d,e")!;
  const b = fives.find((f) => f.key === "a,b,c,d,f")!;
  assert.deepEqual([a.seconds, a.pointsFor, a.pointsAgainst, a.plusMinus, a.games], [480, 4, 6, -2, 2]);
  assert.deepEqual([b.seconds, b.pointsFor, b.pointsAgainst, b.plusMinus], [720, 6, 0, 6]);
  const pm = new Map(players.map((p) => [p.id, p.plusMinus]));
  assert.equal(pm.get("a"), 4, "on for everything: 10 for, 6 against");
  assert.equal(pm.get("e"), -2);
  assert.equal(pm.get("f"), 6);
}

// The live engine logs the five as it changes, and points with who was on.
{
  const guards: BasketballPlayer[] = ["g1", "g2", "g3", "g4"].map((id) => ({ id, name: id, role: "guard", position: null }));
  const fronts: BasketballPlayer[] = ["f1", "f2", "f3", "f4", "f5"].map((id) => ({ id, name: id, role: "front" }));
  const input = { players: [...guards, ...fronts], settings: DEFAULT_BASKETBALL_SETTINGS, order: [...guards, ...fronts].map((p) => p.id) };
  let s = trackStints(startClock(startState(input), 0));
  assert.equal(s.lineupLog!.length, 1, "starting five logged at tip-off");
  s = addPoints(s, "us", 2, 60_000);
  s = trackStints(makeSub(settle(s, 150_000), 150_000));
  assert.equal(s.lineupLog!.length, 2);
  assert.equal(s.lineupLog![1].at, 150);
  s = addPoints(s, "them", 3, 200_000);
  const log: GameLog = {
    gameId: 1,
    gameSec: 200,
    events: [...s.lineupLog!.map((l) => ({ kind: "lineup" as const, ...l })), ...s.scoreLog!],
  };
  const { fives } = lineupStats([log]);
  assert.equal(fives.length, 2);
  assert.equal(fives.find((f) => f.key === [...onCourtIds(s)].sort().join(","))!.pointsAgainst, 3);
}

console.log("basketball-lineups: all checks passed");
