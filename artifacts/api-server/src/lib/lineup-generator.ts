import { type Player, type LineupConstraint } from "@workspace/db";

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
 * Respects both inline constraints and stored DB constraints.
 */
export function generateFairLineup(
  players: Player[],
  innings: number,
  constraints: LineupConstraints = {},
  storedConstraints: LineupConstraint[] = []
): GeneratedEntry[] {
  // --- Apply stored global constraint overrides ---
  const active = storedConstraints.filter((c) => c.active);

  const findGlobal = (type: string) => active.find((c) => c.type === type);

  const maxBenchConstraint = findGlobal("global_max_bench");
  const maxPositionConstraint = findGlobal("global_max_position");
  const rotatePitcherConstraint = findGlobal("global_rotate_pitcher");
  const ensurePositionsConstraint = findGlobal("global_ensure_positions");

  const maxPerPosition = maxPositionConstraint?.value ?? constraints.maxInningsPerPosition ?? 2;
  const maxBench = maxBenchConstraint?.value ?? constraints.maxInningsBench ?? 2;
  const ensureAll = ensurePositionsConstraint
    ? ensurePositionsConstraint.rule === "on"
    : (constraints.ensureAllPositions ?? true);
  const rotatePitcher = rotatePitcherConstraint
    ? rotatePitcherConstraint.rule === "on"
    : (constraints.pitcherRotation ?? false);

  // Player-specific constraints
  const cannotPlayMap = new Map<number, Set<string>>();
  const mustPlayMap = new Map<number, Set<string>>();
  const benchFirstSet = new Set<number>();
  const benchLastSet = new Set<number>();
  const minFieldMap = new Map<number, number>();

  for (const c of active) {
    if (!c.playerId) continue;
    if (c.type === "player_cannot_play" && c.position) {
      if (!cannotPlayMap.has(c.playerId)) cannotPlayMap.set(c.playerId, new Set());
      cannotPlayMap.get(c.playerId)!.add(c.position);
    }
    if (c.type === "player_must_play" && c.position) {
      if (!mustPlayMap.has(c.playerId)) mustPlayMap.set(c.playerId, new Set());
      mustPlayMap.get(c.playerId)!.add(c.position);
    }
    if (c.type === "player_bench_first") benchFirstSet.add(c.playerId);
    if (c.type === "player_bench_last") benchLastSet.add(c.playerId);
    if (c.type === "player_min_field" && c.value != null) {
      minFieldMap.set(c.playerId, c.value);
    }
  }

  const n = players.length;
  if (n < 1) return [];

  const benchCount = new Map<number, number>(players.map((p) => [p.id, 0]));
  const positionCount = new Map<number, Map<string, number>>(players.map((p) => [p.id, new Map()]));
  const totalInningsPlayed = new Map<number, number>(players.map((p) => [p.id, 0]));
  // Track which positions each player has played (for must_play satisfaction)
  const positionsPlayed = new Map<number, Set<string>>(players.map((p) => [p.id, new Set()]));

  const results: GeneratedEntry[] = [];
  const fieldSlotsPerInning = Math.min(9, n);

  const scorePlayer = (playerId: number, inning: number, isLastInning: boolean) => {
    const bench = benchCount.get(playerId) ?? 0;
    const total = totalInningsPlayed.get(playerId) ?? 0;
    // Prefer players with more bench time and less field time
    let score = bench * 10 - total;
    // Boost if they have a min-field requirement not yet met
    const minField = minFieldMap.get(playerId);
    if (minField != null) {
      const fieldInnings = total - bench;
      if (fieldInnings < minField) score += (minField - fieldInnings) * 15;
    }
    return score;
  };

  for (let inning = 1; inning <= innings; inning++) {
    const isLastInning = inning === innings;
    const assignedThisInning = new Set<number>();
    const inningAssignments: GeneratedEntry[] = [];

    // Players forced to bench this inning
    const forcedBench = new Set<number>();
    if (inning === 1) {
      for (const pid of benchFirstSet) {
        if (players.find((p) => p.id === pid)) forcedBench.add(pid);
      }
    }
    if (isLastInning) {
      for (const pid of benchLastSet) {
        if (players.find((p) => p.id === pid)) forcedBench.add(pid);
      }
    }

    // Pitcher rotation: track who pitched last inning
    const lastPitcher = rotatePitcher && results.length > 0
      ? results.filter((e) => e.inning === inning - 1 && e.position === "P")[0]?.playerId ?? null
      : null;

    const positions = [...FIELD_POSITIONS];

    for (const pos of positions) {
      if (assignedThisInning.size >= fieldSlotsPerInning) break;

      const eligible = players
        .filter((p) => {
          if (assignedThisInning.has(p.id)) return false;
          if (forcedBench.has(p.id)) return false;
          const posCount = positionCount.get(p.id)?.get(pos) ?? 0;
          if (posCount >= maxPerPosition) return false;
          if (!p.eligiblePositions.includes(pos)) return false;
          // Respect cannot-play constraints
          if (cannotPlayMap.get(p.id)?.has(pos)) return false;
          // Pitcher rotation: don't use same pitcher back-to-back if rotation enabled
          if (rotatePitcher && pos === "P" && p.id === lastPitcher) return false;
          return true;
        })
        .sort((a, b) => {
          // Check if player must play this position (boost priority)
          const aMust = mustPlayMap.get(a.id)?.has(pos) && !positionsPlayed.get(a.id)?.has(pos) ? 20 : 0;
          const bMust = mustPlayMap.get(b.id)?.has(pos) && !positionsPlayed.get(b.id)?.has(pos) ? 20 : 0;
          const scoreDiff = (scorePlayer(b.id, inning, isLastInning) + bMust) - (scorePlayer(a.id, inning, isLastInning) + aMust);
          if (scoreDiff !== 0) return scoreDiff;
          const aPreferred = a.preferredPositions.includes(pos) ? -1 : 0;
          const bPreferred = b.preferredPositions.includes(pos) ? -1 : 0;
          return aPreferred - bPreferred;
        });

      const player = eligible[0];
      if (!player) {
        // Fallback: any unassigned non-forced player
        const fallback = players
          .filter((p) => !assignedThisInning.has(p.id) && !forcedBench.has(p.id))
          .sort((a, b) => scorePlayer(b.id, inning, isLastInning) - scorePlayer(a.id, inning, isLastInning));
        if (!fallback[0]) continue;
        const fb = fallback[0];
        assignedThisInning.add(fb.id);
        inningAssignments.push({ playerId: fb.id, inning, position: pos, battingOrder: null });
        positionCount.get(fb.id)!.set(pos, (positionCount.get(fb.id)!.get(pos) ?? 0) + 1);
        positionsPlayed.get(fb.id)!.add(pos);
        totalInningsPlayed.set(fb.id, (totalInningsPlayed.get(fb.id) ?? 0) + 1);
        continue;
      }

      assignedThisInning.add(player.id);
      inningAssignments.push({ playerId: player.id, inning, position: pos, battingOrder: null });
      positionCount.get(player.id)!.set(pos, (positionCount.get(player.id)!.get(pos) ?? 0) + 1);
      positionsPlayed.get(player.id)!.add(pos);
      totalInningsPlayed.set(player.id, (totalInningsPlayed.get(player.id) ?? 0) + 1);
    }

    // Assign bench
    for (const p of players) {
      if (assignedThisInning.has(p.id)) continue;
      inningAssignments.push({ playerId: p.id, inning, position: "Bench", battingOrder: null });
      benchCount.set(p.id, (benchCount.get(p.id) ?? 0) + 1);
    }

    results.push(...inningAssignments);
  }

  // Batting order: higher OBP/more field time → earlier slot
  const battingOrderMap = new Map<number, number>();
  let slot = 1;
  const orderedByPlayTime = [...players].sort(
    (a, b) => (totalInningsPlayed.get(b.id) ?? 0) - (totalInningsPlayed.get(a.id) ?? 0)
  );
  for (const p of orderedByPlayTime) battingOrderMap.set(p.id, slot++);

  return results.map((e) => ({
    ...e,
    battingOrder: e.position !== "Bench" ? (battingOrderMap.get(e.playerId) ?? null) : null,
  }));
}
