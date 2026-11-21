import assert from "node:assert/strict";
import { blankPlay, distanceToLine, frameAt, holderAt, playTimeline, pointAlong, moveLine, moveLineEnd, pathLength, screenBar, simplifyStroke, smoothPath, stepCount, zigzagPath } from "../src/lib/basketball-plays.ts";

// A blank play has the 1–5 at their usual spots and the ball with the 1.
{
  const p = blankPlay();
  assert.deepEqual(p.players.map((x) => x.spot), [1, 2, 3, 4, 5]);
  assert.equal(p.ballSpot, 1);
  assert.equal(stepCount(p), 1);
}

// Strokes are thinned but keep both ends; a pass is a straight line.
{
  const raw = Array.from({ length: 50 }, (_, i) => ({ x: 100 + i, y: 200 + (i % 3) }));
  const cut = simplifyStroke(raw, "cut");
  assert.ok(cut.length < raw.length && cut.length >= 2);
  assert.deepEqual(cut[0], { x: 100, y: 200 });
  assert.deepEqual(cut[cut.length - 1], { x: 149, y: 201 });
  assert.deepEqual(simplifyStroke(raw, "pass"), [raw[0], raw[49]]);
  assert.ok(Math.abs(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }]) - 5) < 1e-9);
}

// Paths render: smooth curves, a zigzag for dribbles, a bar for screens.
{
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 50 }];
  assert.match(smoothPath(pts), /^M 0 0 Q 50 0 75 25 L 100 50$/);
  const zig = zigzagPath([{ x: 0, y: 0 }, { x: 140, y: 0 }]);
  const ys = [...zig.matchAll(/L [\d.-]+ ([\d.-]+)/g)].map((m) => Number(m[1]));
  assert.ok(ys.some((y) => y > 3) && ys.some((y) => y < -3), "zigzags both ways");
  assert.equal(ys[ys.length - 1], 0, "ends on the line");
  const bar = screenBar([{ x: 0, y: 0 }, { x: 100, y: 0 }])!;
  assert.equal(bar.a.x, 100);
  assert.equal(bar.b.x, 100);
  assert.equal(Math.abs(bar.a.y - bar.b.y), 22, "bar across the end");
}

// Steps.
{
  const p = blankPlay();
  p.actions.push({ type: "cut", step: 1, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
  p.actions.push({ type: "pass", step: 3, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
  assert.equal(stepCount(p), 3);
}

// Selecting and editing lines.
{
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  assert.equal(distanceToLine({ x: 50, y: 5 }, line), 5, "near the first segment");
  assert.equal(distanceToLine({ x: 110, y: 50 }, line), 10, "near the second segment");
  assert.ok(distanceToLine({ x: 300, y: 300 }, line) > 100);
  assert.deepEqual(moveLine(line, 10, 20), [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 120 }]);
  assert.deepEqual(moveLine(line, -50, 0)[0], { x: 0, y: 0 }, "can't move off the court");
  const end = moveLineEnd(line, "end", { x: 140, y: 100 });
  assert.deepEqual(end[0], { x: 0, y: 0 }, "the start stays put");
  assert.deepEqual(end[2], { x: 140, y: 100 }, "the end moves");
  assert.equal(end[1].x, 120, "the middle bends halfway");
  const start = moveLineEnd(line, "start", { x: 0, y: -40 });
  assert.deepEqual(start[0], { x: 0, y: -40 });
  assert.deepEqual(start[2], { x: 100, y: 100 });
}

// Playback: who moves, where the ball goes.
{
  const p = blankPlay(); // 1 at (250,95) with the ball, 3 at (95,165), 2 at (405,165)
  p.actions.push({ type: "cut", step: 1, points: [{ x: 95, y: 165 }, { x: 200, y: 300 }, { x: 250, y: 400 }] });
  p.actions.push({ type: "pass", step: 1, points: [{ x: 250, y: 95 }, { x: 245, y: 390 }] });
  p.actions.push({ type: "dribble", step: 2, points: [{ x: 405, y: 165 }, { x: 405, y: 300 }] });
  const steps = playTimeline(p);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0].moves.map((m) => m.spot), [3], "the cut moves the 3");
  assert.equal(steps[0].ballFrom, 1);
  assert.equal(steps[0].ballTo, 3, "the pass goes to the cutter");
  assert.deepEqual(steps[0].to[3], { x: 250, y: 400 });
  assert.deepEqual(steps[1].from[3], { x: 250, y: 400 }, "the next step starts where the last ended");
  assert.deepEqual(steps[1].moves.map((m) => m.spot), [2]);
  assert.equal(steps[1].ballFrom, 3);

  const start = frameAt(steps[0], 0);
  assert.deepEqual(start.positions[3], { x: 95, y: 165 });
  assert.equal(start.ball, null, "ball in the 1's hands");
  assert.equal(holderAt(steps[0], 0.2), 1);
  const mid = frameAt(steps[0], 0.75);
  assert.ok(mid.ball !== null, "ball in the air");
  assert.equal(holderAt(steps[0], 0.75), null);
  const end = frameAt(steps[0], 1);
  assert.deepEqual(end.positions[3], { x: 250, y: 400 });
  assert.equal(holderAt(steps[0], 1), 3);
  assert.deepEqual(pointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 0.75), { x: 10, y: 5 });
}

console.log("basketball-plays: all checks passed");
