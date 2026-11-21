import assert from "node:assert/strict";
import { blankPlay, pathLength, screenBar, simplifyStroke, smoothPath, stepCount, zigzagPath } from "../src/lib/basketball-plays.ts";

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

console.log("basketball-plays: all checks passed");
