import assert from "node:assert/strict";
import { DEFAULT_BASKETBALL_SETTINGS, type BasketballPlayer } from "../src/lib/basketball-rotation.ts";
import { addFoul, addOppFoul, addPoints, callTimeout, makeSub, onCourt, setClock, startClock, startState, stopClock, takeOut } from "../src/lib/basketball-live.ts";
import { describeChange } from "../src/lib/basketball-live-sync.ts";

const guards: BasketballPlayer[] = ["Vinnie J", "Brody", "Luke", "Vinnie V"].map((n) => ({ id: n, name: n, role: "guard", position: null }));
const fronts: BasketballPlayer[] = ["Anders", "Henry", "Rory", "Bash", "Miles"].map((n) => ({ id: n, name: n, role: "front" }));
const input = { players: [...guards, ...fronts], settings: { ...DEFAULT_BASKETBALL_SETTINGS, subSize: 1 }, order: [...guards, ...fronts].map((p) => p.id) };
const name = (id: string) => id;

const pre = startState(input);
assert.equal(describeChange(null, pre, name), "set up the game");
const live = startClock(pre, 0);
assert.equal(describeChange(pre, live, name), "started the game");
assert.equal(describeChange(live, addPoints(live, "us", 2, 1000), name), "+2 us");
assert.equal(describeChange(live, addPoints(live, "them", 3, 1000), name, "Edina"), "+3 Edina");
const starter = onCourt(live).flat()[0];
assert.equal(describeChange(live, addFoul(live, starter, 1, 1000), name), `foul on ${starter} (1)`);
assert.equal(describeChange(live, addOppFoul(live), name, "Edina"), "Edina foul");
assert.equal(describeChange(live, callTimeout(live, 30_000), name), "timeout");
const stopped = stopClock(live, 30_000);
assert.equal(describeChange(live, stopped, name), "stopped the clock");
assert.match(describeChange(stopped, setClock(stopped, 30_000, 600), name), /set the clock to 10:00/);
const subbed = makeSub(live, 150_000);
assert.match(describeChange(live, subbed, name), / in for /, "one in, one out");
assert.equal(describeChange(live, takeOut(live, 1000, starter), name).startsWith(`${starter} out of the game`), true);

console.log("basketball-live-sync: all checks passed");
