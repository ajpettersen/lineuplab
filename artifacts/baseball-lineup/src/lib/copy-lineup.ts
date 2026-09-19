/** Copying another game's lineup onto this one (Game Detail "Copy from a previous game"). */

export type CopyParts = "both" | "batting" | "positions";

type CopyEntry = { playerId: number; inning: number; position: string; battingOrder?: number | null };

function battingOrderByPlayer(entries: CopyEntry[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of entries) {
    if (e.battingOrder == null) continue;
    const cur = m.get(e.playerId);
    if (cur == null || e.battingOrder < cur) m.set(e.playerId, e.battingOrder);
  }
  return m;
}

/** Rank → 1..n, in rank order. */
function renumber(rank: Map<number, number>): Map<number, number> {
  return new Map([...rank.entries()].sort((a, b) => a[1] - b[1]).map(([pid], i) => [pid, i + 1]));
}

/**
 * Combine another game's lineup (`source`, already filtered to the active
 * roster and this game's innings) with this game's saved lineup.
 *  - both:      the source lineup as-is.
 *  - batting:   keep this game's defense; take the source batting order.
 *               Players the source didn't have bat after, in their current order.
 *  - positions: take the source defense; keep this game's batting order.
 *               Players only in this game sit on the bench every inning.
 * With no saved lineup here there's nothing to keep, so it copies both.
 */
export function mergeCopiedLineup<T extends CopyEntry>(
  current: T[],
  source: T[],
  parts: CopyParts,
  innings: number,
): { entries: T[]; copiedBoth: boolean } {
  if (parts === "both" || current.length === 0) return { entries: source, copiedBoth: parts !== "both" };
  const cur = battingOrderByPlayer(current);
  const src = battingOrderByPlayer(source);

  if (parts === "batting") {
    const rank = new Map<number, number>();
    for (const pid of new Set(current.map((e) => e.playerId))) {
      if (src.has(pid)) rank.set(pid, src.get(pid)!);
      else if (cur.has(pid)) rank.set(pid, 1000 + cur.get(pid)!);
    }
    const order = renumber(rank);
    return { entries: current.map((e) => ({ ...e, battingOrder: order.get(e.playerId) ?? null })), copiedBoth: false };
  }

  const sourcePids = new Set(source.map((e) => e.playerId));
  const onlyHere = [...new Set(current.map((e) => e.playerId))].filter((pid) => !sourcePids.has(pid));
  const rank = new Map<number, number>();
  for (const pid of sourcePids) {
    if (cur.has(pid)) rank.set(pid, cur.get(pid)!);
    else if (src.has(pid)) rank.set(pid, 1000 + src.get(pid)!);
  }
  for (const pid of onlyHere) if (cur.has(pid)) rank.set(pid, cur.get(pid)!);
  const order = renumber(rank);
  const bench: T[] = [];
  for (const pid of onlyHere) {
    const template = current.find((e) => e.playerId === pid)!;
    for (let inning = 1; inning <= innings; inning++) bench.push({ ...template, inning, position: "Bench" });
  }
  return {
    entries: [...source, ...bench].map((e) => ({ ...e, battingOrder: order.get(e.playerId) ?? null })),
    copiedBoth: false,
  };
}
