import assert from "node:assert/strict";
import { computeStandings } from "../src/lib/pool-play-simulator";

// Pool standings with a per-game point-differential cap (e.g. Minnesota's 15).
const pool = {
  ourTeamName: "Us",
  teams: [{ name: "Us" }, { name: "A" }, { name: "B" }],
  games: [
    { id: "1", home: "Us", away: "A", homeScore: 50, awayScore: 20, final: true }, // +30, counts +15 capped
    { id: "2", home: "A", away: "B", homeScore: 30, awayScore: 28, final: true },
    { id: "3", home: "B", away: "Us", homeScore: 40, awayScore: 30, final: true }, // Us -10
  ],
  tiebreakers: ["winPct", "runDiff"] as const,
  advanceCount: 2,
  byeCount: 0,
  updatedAt: new Date().toISOString(),
};

const uncapped = computeStandings({ ...pool, tiebreakers: [...pool.tiebreakers] });
assert.equal(uncapped.find((t) => t.teamName === "Us")!.runDiff, 20, "no cap: raw margin");

const capped = computeStandings({ ...pool, tiebreakers: [...pool.tiebreakers], diffCap: 15 });
const us = capped.find((t) => t.teamName === "Us")!;
assert.equal(us.runDiff, 5, "capped: +15 and -10");
assert.equal(us.runsFor, 80, "points scored aren't capped");
assert.equal(capped.find((t) => t.teamName === "A")!.runDiff, -13, "capped: -15 and +2");
// All 1-1: order by capped differential.
assert.deepEqual(capped.map((t) => t.teamName), ["B", "Us", "A"]);

console.log("pool-play-cap: all checks passed");
