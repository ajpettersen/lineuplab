import { type Player } from "@workspace/db";

export const FIELD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
export type FieldPosition = typeof FIELD_POSITIONS[number];

export interface LineupConstraints {
  maxInningsPerPosition?: number;
  maxInningsBench?: number;
  ensureAllPositions?: boolean;
  pitcherRotation?: boolean;
}

export interface GeneratedEntry {
  playerId: number;
  inning: number;
  position: string;
  battingOrder: number | null;
}

/**
 * Greedy fair lineup generator.
 * Attempts to distribute playing time and positions equitably.
 */
export function generateFairLineup(
  players: Player[],
  innings: number,
  constraints: LineupConstraints = {}
): GeneratedEntry[] {
  const maxPerPosition = constraints.maxInningsPerPosition ?? 2;
  const maxBench = constraints.maxInningsBench ?? 2;
  const ensureAll = constraints.ensureAllPositions ?? true;

  const n = players.length;
  if (n < 1) return [];

  // Track state
  const benchCount: Map<number, number> = new Map(players.map((p) => [p.id, 0]));
  const positionCount: Map<number, Map<string, number>> = new Map(
    players.map((p) => [p.id, new Map()])
  );
  const totalInningsPlayed: Map<number, number> = new Map(players.map((p) => [p.id, 0]));

  const results: GeneratedEntry[] = [];

  const fieldPositions = ensureAll
    ? FIELD_POSITIONS.filter(() => true)
    : FIELD_POSITIONS.slice();

  // Number of players on field per inning
  const fieldSlotsPerInning = Math.min(9, n);
  const benchSlotsPerInning = n - fieldSlotsPerInning;

  for (let inning = 1; inning <= innings; inning++) {
    const assignedThisInning: Set<number> = new Set();
    const inningAssignments: GeneratedEntry[] = [];

    // Score players by need to play — prefer those with most bench time and least field time
    const scorePlayer = (playerId: number) => {
      const bench = benchCount.get(playerId) ?? 0;
      const total = totalInningsPlayed.get(playerId) ?? 0;
      return bench * 10 - total;
    };

    // Fill field positions
    const positions = [...FIELD_POSITIONS];

    for (const pos of positions) {
      if (assignedThisInning.size >= fieldSlotsPerInning) break;

      // Find best eligible player for this position
      const eligible = players
        .filter((p) => {
          if (assignedThisInning.has(p.id)) return false;
          const posCount = positionCount.get(p.id)?.get(pos) ?? 0;
          if (posCount >= maxPerPosition) return false;
          // Check if player can play this position
          if (!p.eligiblePositions.includes(pos)) return false;
          return true;
        })
        .sort((a, b) => {
          // Prefer players who need time, then prefer those who want this position
          const scoreDiff = scorePlayer(b.id) - scorePlayer(a.id);
          if (scoreDiff !== 0) return scoreDiff;
          // Prefer their preferred positions
          const aPreferred = a.preferredPositions.includes(pos) ? -1 : 0;
          const bPreferred = b.preferredPositions.includes(pos) ? -1 : 0;
          return aPreferred - bPreferred;
        });

      if (eligible.length === 0) {
        // Fall back to any unassigned player
        const fallback = players
          .filter((p) => !assignedThisInning.has(p.id))
          .sort((a, b) => scorePlayer(b.id) - scorePlayer(a.id));

        if (fallback.length === 0) continue;

        const p = fallback[0];
        assignedThisInning.add(p.id);
        inningAssignments.push({ playerId: p.id, inning, position: pos, battingOrder: null });
        positionCount.get(p.id)!.set(pos, (positionCount.get(p.id)!.get(pos) ?? 0) + 1);
        totalInningsPlayed.set(p.id, (totalInningsPlayed.get(p.id) ?? 0) + 1);
        continue;
      }

      const player = eligible[0];
      assignedThisInning.add(player.id);
      inningAssignments.push({ playerId: player.id, inning, position: pos, battingOrder: null });
      positionCount.get(player.id)!.set(pos, (positionCount.get(player.id)!.get(pos) ?? 0) + 1);
      totalInningsPlayed.set(player.id, (totalInningsPlayed.get(player.id) ?? 0) + 1);
    }

    // Assign remaining players to bench
    for (const p of players) {
      if (assignedThisInning.has(p.id)) continue;
      const currentBench = benchCount.get(p.id) ?? 0;
      // Warn if exceeding max bench but still assign
      if (currentBench >= maxBench && benchSlotsPerInning > 0) {
        // Try to swap with a field player if possible
        // (simplified — just assign bench for now)
      }
      inningAssignments.push({ playerId: p.id, inning, position: "Bench", battingOrder: null });
      benchCount.set(p.id, currentBench + 1);
    }

    results.push(...inningAssignments);
  }

  // Assign batting order based on total playing time (more playing time → earlier in order)
  // Only assign batting order to players who play field (not bench)
  const battingOrderMap = new Map<number, number>();
  let battingSlot = 1;
  const orderedByPlayTime = [...players].sort(
    (a, b) => (totalInningsPlayed.get(b.id) ?? 0) - (totalInningsPlayed.get(a.id) ?? 0)
  );
  for (const p of orderedByPlayTime) {
    battingOrderMap.set(p.id, battingSlot++);
  }

  return results.map((e) => ({
    ...e,
    battingOrder: e.position !== "Bench" ? (battingOrderMap.get(e.playerId) ?? null) : null,
  }));
}
