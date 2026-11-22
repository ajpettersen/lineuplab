// Second-coach mode, the pure parts: a stable id for this device, and a
// short description of what changed between two live states, for the
// "Coach Sam: Luke in for Henry" line every device shows.
// Tested in test/basketball-live-sync.test.ts.

import type { LiveState } from "./basketball-live.ts";

const DEVICE_KEY = "lineuplab:device-id";

/** A random id for this browser, kept in localStorage (a fresh one if storage is unavailable). */
export function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const id = `d_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return `d_${Math.random().toString(36).slice(2, 12)}`;
  }
}

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

function onCourt(s: LiveState): string[] {
  // The first five of each group's window, as the engine stores them (enough to compare).
  const on: string[] = [];
  s.queues.forEach((q, i) => {
    const spots = Math.min(s.groups[i]?.spots.length ?? 0, q.length);
    for (let j = 0; j < spots; j++) on.push(q[(((s.starts[i] ?? 0) + j) % q.length + q.length) % q.length]);
  });
  return on;
}

/** What changed, in a few words ("+2 us", "Luke in for Henry", "started the clock"). */
export function describeChange(prev: LiveState | null, next: LiveState, nameOf: (id: string) => string, opponent = "them"): string {
  if (!prev) return next.phase === "pregame" ? "set up the game" : "started the game";
  const parts: string[] = [];
  const us = (next.score?.us ?? 0) - (prev.score?.us ?? 0);
  const them = (next.score?.them ?? 0) - (prev.score?.them ?? 0);
  if (us) parts.push(`${us > 0 ? "+" : ""}${us} us`);
  if (them) parts.push(`${them > 0 ? "+" : ""}${them} ${opponent}`);
  for (const [id, n] of Object.entries(next.fouls ?? {})) {
    const before = prev.fouls?.[id] ?? 0;
    if (n > before) parts.push(`foul on ${nameOf(id)} (${n})`);
    if (n < before) parts.push(`took back a foul on ${nameOf(id)}`);
  }
  const theirFouls = (o?: Record<string, number>) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
  if (theirFouls(next.oppFouls) !== theirFouls(prev.oppFouls)) parts.push(theirFouls(next.oppFouls) > theirFouls(prev.oppFouls) ? `${opponent} foul` : `took back a ${opponent} foul`);
  const timeouts = (o?: Record<string, number>) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
  if (timeouts(next.timeouts) > timeouts(prev.timeouts)) parts.push("timeout");
  if (prev.phase === "pregame" && next.phase === "live") parts.push("started the game");
  else if (prev.phase === "halftime" && next.phase === "live") parts.push("started the next period");
  else if (prev.runningSince === null && next.runningSince !== null) parts.push("started the clock");
  else if (prev.runningSince !== null && next.runningSince === null && next.phase === "live" && timeouts(next.timeouts) === timeouts(prev.timeouts)) parts.push("stopped the clock");
  if (next.runningSince === null && prev.runningSince === null && Math.abs(next.clockSec - prev.clockSec) >= 1) parts.push(`set the clock to ${fmt(next.clockSec)}`);
  const newlyOut = next.outIds.filter((id) => !prev.outIds.includes(id));
  const back = prev.outIds.filter((id) => !next.outIds.includes(id));
  newlyOut.forEach((id) => parts.push(`${nameOf(id)} out of the game`));
  back.forEach((id) => parts.push(`${nameOf(id)} back in the game`));
  if ((next.script ?? null) !== (prev.script ?? null) && next.script && next.script !== prev.script && JSON.stringify(next.script) !== JSON.stringify(prev.script)) {
    parts.push("rebalanced the rest of the game");
  } else {
    const before = onCourt(prev);
    const after = onCourt(next);
    const ins = after.filter((id) => !before.includes(id) && !back.includes(id));
    const outs = before.filter((id) => !after.includes(id) && !newlyOut.includes(id));
    if (ins.length === 1 && outs.length === 1) parts.push(`${nameOf(ins[0])} in for ${nameOf(outs[0])}`);
    else if (ins.length > 0) parts.push(`sub: ${ins.map(nameOf).join(", ")} in`);
  }
  return parts.length ? parts.join(", ") : "updated the game";
}
