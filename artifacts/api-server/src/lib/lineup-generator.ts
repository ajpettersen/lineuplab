import { type Player, type LineupConstraint } from "@workspace/db";

export const FIELD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
export type FieldPosition = typeof FIELD_POSITIONS[number];

/**
 * Every position string the system understands. Includes the optional
 * `LCF`/`RCF` slots a coach can swap in for `CF` when running a 10-player
 * field. Server validators (locks, constraints, AI prompts, image import)
 * accept any of these so the active-positions choice on one team doesn't
 * cause writes from another team's positions to fail validation.
 */
export const ALL_KNOWN_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "CF", "RCF", "RF"] as const;
export type KnownPosition = typeof ALL_KNOWN_POSITIONS[number];

export interface LineupConstraints {
  maxInningsPerPosition?: number;
  maxInningsBench?: number;
  ensureAllPositions?: boolean;
  pitcherRotation?: boolean;
  /**
   * Per-game competitive context. Overrides the global equity slider:
   *  - "tournament" → equity≈10 (favor preferred + best players), batting
   *    order by OBP desc.
   *  - "league"     → equity≈70 (lean fair on the field) AND batting order
   *    sorted ascending by season plate appearances so under-used kids bat
   *    earlier and pick up more PAs this game.
   *  - undefined/null → use the existing global_equity_weight constraint.
   */
  gameType?: "league" | "tournament" | null;
  /**
   * Season plate-appearance totals per playerId. Only consulted when
   * gameType === "league" — used to bias the batting order toward under-used
   * players so PAs trend toward parity over the season.
   */
  playerSeasonPlateAppearances?: Map<number, number>;
  /**
   * Season on-base percentage per playerId. Only consulted when
   * gameType === "tournament" — feeds the table-setter / cleanup
   * arrangement at the top of the order. Players missing from the map
   * get the team-mean OBP so a kid with no recorded stats slots in the
   * middle instead of being pushed to the bottom of the lineup.
   */
  playerSeasonOBP?: Map<number, number>;
  /**
   * Season slugging percentage per playerId. Pairs with `playerSeasonOBP`
   * for the tournament-mode batting order: best SLG hitters get the
   * cleanup spots so the table setters in front of them get driven in.
   * Same fallback rule — missing players are treated as team average.
   */
  playerSeasonSLG?: Map<number, number>;
  /**
   * Team-wide batting style (from team_settings.batting_style):
   *  - "continuous" → every player on the roster gets a batting slot
   *    (everyone bats, slots 1..N).
   *  - "nine_man"   → only the top 9 players in the chosen ordering get
   *    slots 1-9; the rest are subs with battingOrder=null.
   * Defaults to "continuous" when unset to preserve existing behavior.
   */
  battingStyle?: "continuous" | "nine_man";
  /**
   * Active defensive positions to fill each inning. Defaults to the standard
   * 9 (`FIELD_POSITIONS`). When a team is configured for a 10-player field
   * (LF/LCF/RCF/RF outfield instead of LF/CF/RF), the route passes the
   * 10-element list here and the generator fills 10 slots per inning.
   */
  fieldPositions?: readonly string[];
  /**
   * Per-position depth chart, sourced from `team_settings.depthChart`.
   * Map shape: `{ "SS": [aliceId, bobId, carlosId], "2B": [...] }` — the
   * first id in each array is the coach's #1 at that position, second is
   * the #2, etc. Only consulted as a SOFT BIAS during the greedy fill;
   * the bonus per (player, position) match scales inversely with the
   * equity dial just like `preferredPositions`:
   *   - equity 0.0 (fully competitive): rank-1 player gets a strong push
   *     (~+30) toward their best slot, rank-2 ~+24, decaying linearly to
   *     0 by rank 6+.
   *   - equity 0.5 (balanced default):  no depth-chart bonus.
   *   - equity 1.0 (max fairness):      no depth-chart bonus.
   * The depth chart is additive with the existing preferred-position
   * bonus, so a player who is BOTH preferred and #1 in the depth chart
   * gets the strongest possible nudge in competitive games. Players not
   * listed in the depth chart for a position simply receive no bonus.
   */
  depthChart?: Record<string, number[]>;
}

export interface GeneratedEntry {
  playerId: number;
  inning: number;
  position: string;
  battingOrder: number | null;
}

/** Hard-pinned (playerId, inning, position) assignment that the generator must honor. */
export interface PinnedAssignment {
  playerId: number;
  inning: number;
  position: string;
}

/**
 * Greedy fair lineup generator.
 * Respects both inline constraints and stored DB constraints.
 *
 * `pinned` lets a caller (e.g. the AI assistant) hard-pin specific
 * (playerId, inning, position) tuples before the greedy pass runs. Pinned
 * field assignments are placed first; pinned "Bench" entries force that
 * player to bench in that inning. Conflicting pins (same inning+position
 * twice, or same player twice in one inning) are skipped after the first.
 */
export function generateFairLineup(
  players: Player[],
  innings: number,
  constraints: LineupConstraints = {},
  storedConstraints: LineupConstraint[] = [],
  pinned: PinnedAssignment[] = []
): GeneratedEntry[] {
  // --- Apply stored global constraint overrides ---
  const active = storedConstraints.filter((c) => c.active);

  const findGlobal = (type: string) => active.find((c) => c.type === type);

  // For singleton settings like the equity dial, defensively pick the newest row
  // if duplicates somehow exist (concurrent tabs, manual API calls, etc.).
  const findGlobalNewest = (type: string) =>
    active
      .filter((c) => c.type === type)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

  const maxBenchConstraint = findGlobal("global_max_bench");
  const maxPositionConstraint = findGlobal("global_max_position");
  const rotatePitcherConstraint = findGlobal("global_rotate_pitcher");
  const ensurePositionsConstraint = findGlobal("global_ensure_positions");
  const noBenchTwoOfThree = !!findGlobal("global_no_bench_two_of_three");
  const equityWeightConstraint = findGlobalNewest("global_equity_weight");

  const maxPerPosition = maxPositionConstraint?.value ?? constraints.maxInningsPerPosition ?? 2;
  const maxBench = maxBenchConstraint?.value ?? constraints.maxInningsBench ?? 2;
  const ensureAll = ensurePositionsConstraint
    ? ensurePositionsConstraint.rule === "on"
    : (constraints.ensureAllPositions ?? true);
  const rotatePitcher = rotatePitcherConstraint
    ? rotatePitcherConstraint.rule === "on"
    : (constraints.pitcherRotation ?? false);

  // Equity dial: 0 = ignore fairness, prefer best player at each spot.
  // 50 = balanced (default, matches legacy behavior).
  // 100 = strong fairness pressure.
  // Per-game gameType overrides the global slider — tournament games go
  // competitive, league games lean fair on the field (and rebalance PAs in
  // the batting order, see below).
  const gameTypeOverride =
    constraints.gameType === "tournament" ? 10 :
    constraints.gameType === "league" ? 70 :
    null;
  const equityRaw = gameTypeOverride ?? equityWeightConstraint?.value ?? 50;
  const equity = Math.min(1, Math.max(0, equityRaw / 100));
  // At e=0.5 the fairness multiplier is 1.0 (legacy behavior); at e=0 it's 0; at e=1 it's 2.
  const fairnessMultiplier = equity * 2;
  // When equity drops below 0.5, preferred positions get a real bonus (up to +25 at e=0).
  // At e>=0.5, preferred is only a tiebreaker (legacy behavior).
  // Tournament mode doubles the preferred-position bonus to push the best
  // fielders into their best spots even more aggressively.
  const basePreferredBonus = Math.max(0, (0.5 - equity) * 50);
  const preferredBonus =
    constraints.gameType === "tournament" ? basePreferredBonus * 2 : basePreferredBonus;

  // Depth-chart bonus — same equity curve as preferredBonus but a touch
  // stronger at the top of the order (max ~30 at e=0) and decaying with
  // rank position so #1 gets a real push, #2 a smaller push, etc., and
  // by rank 6 the bonus is gone. Tournament games double the base just
  // like preferredBonus so the coach's depth-chart wins more often when
  // the game type itself is competitive.
  const depthChart = constraints.depthChart ?? {};
  const baseDepthBonus = Math.max(0, (0.5 - equity) * 60);
  const depthBonusFactor = constraints.gameType === "tournament" ? 2 : 1;
  /**
   * Depth-chart bonus for `playerId` at `position`. Returns 0 if the
   * player isn't listed in the depth chart for that slot OR if equity
   * is at/above the neutral midpoint.
   */
  const depthBonusFor = (playerId: number, position: string): number => {
    if (baseDepthBonus <= 0) return 0;
    const order = depthChart[position];
    if (!order || order.length === 0) return 0;
    const rank = order.indexOf(playerId);
    if (rank < 0) return 0;
    // Linear decay: rank 0 → 1.0, rank 5+ → 0.
    const decay = Math.max(0, 1 - rank * 0.2);
    return baseDepthBonus * depthBonusFactor * decay;
  };

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
  // Track which innings each player was benched in (for no-bench-2-of-3 rule)
  const benchedInnings = new Map<number, Set<number>>(players.map((p) => [p.id, new Set()]));

  const results: GeneratedEntry[] = [];
  const activePositions: readonly string[] =
    constraints.fieldPositions && constraints.fieldPositions.length > 0
      ? constraints.fieldPositions
      : FIELD_POSITIONS;
  const fieldSlotsPerInning = Math.min(activePositions.length, n);

  // Returns true if benching this player in this inning would put them on the bench
  // 2 or more times within any 3-inning window covering this inning
  const wouldViolateTwoOfThree = (playerId: number, inning: number): boolean => {
    const benched = benchedInnings.get(playerId) ?? new Set();
    // Windows ending at `inning`: [inning-2, inning-1, inning], [inning-1, inning, inning+1], [inning, inning+1, inning+2]
    // We only need to look backwards since future innings haven't been assigned yet.
    // If benched in either of the previous 2 innings, benching now creates a violation in some 3-window.
    return benched.has(inning - 1) || benched.has(inning - 2);
  };

  const scorePlayer = (playerId: number, inning: number, _isLastInning: boolean) => {
    const bench = benchCount.get(playerId) ?? 0;
    const total = totalInningsPlayed.get(playerId) ?? 0;
    // Fairness component — scaled by the equity dial.
    let score = (bench * 10 - total) * fairnessMultiplier;
    // Boost if they have a min-field requirement not yet met
    const minField = minFieldMap.get(playerId);
    if (minField != null) {
      const fieldInnings = total - bench;
      if (fieldInnings < minField) score += (minField - fieldInnings) * 15;
    }
    // Strong boost if benching them now would violate 2-of-3 rule
    if (noBenchTwoOfThree && wouldViolateTwoOfThree(playerId, inning)) {
      score += 100;
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

    // Apply pinned (playerId, position) tuples for THIS inning before the
    // greedy pass, so the AI assistant / coach overrides are honored as hard
    // constraints. A pinned "Bench" entry forces that player onto bench.
    const pinnedThisInning = pinned.filter((p) => p.inning === inning);
    const filledPositions = new Set<string>(); // skip these in the greedy pass
    // Two-pass to make pin handling order-independent:
    //   1. Apply Bench pins first (they always win conflicts).
    //   2. Apply field pins, skipping any player that was bench-pinned and any
    //      slot that was already filled. This guarantees one-position-per-player
    //      and one-player-per-position per inning regardless of input order.
    for (const pin of pinnedThisInning) {
      if (pin.position !== "Bench") continue;
      const player = players.find((p) => p.id === pin.playerId);
      if (!player) continue;
      forcedBench.add(pin.playerId);
    }
    for (const pin of pinnedThisInning) {
      if (pin.position === "Bench") continue;
      const player = players.find((p) => p.id === pin.playerId);
      if (!player) continue;
      if (forcedBench.has(pin.playerId)) continue; // bench pin wins
      if (assignedThisInning.has(pin.playerId)) continue; // duplicate field pin
      if (filledPositions.has(pin.position)) continue; // two pins for same slot
      assignedThisInning.add(pin.playerId);
      filledPositions.add(pin.position);
      inningAssignments.push({ playerId: pin.playerId, inning, position: pin.position, battingOrder: null });
      positionCount.get(pin.playerId)!.set(pin.position, (positionCount.get(pin.playerId)!.get(pin.position) ?? 0) + 1);
      positionsPlayed.get(pin.playerId)!.add(pin.position);
      totalInningsPlayed.set(pin.playerId, (totalInningsPlayed.get(pin.playerId) ?? 0) + 1);
    }

    // Pitcher rotation: track who pitched last inning
    const lastPitcher = rotatePitcher && results.length > 0
      ? results.filter((e) => e.inning === inning - 1 && e.position === "P")[0]?.playerId ?? null
      : null;

    const positions = [...activePositions];

    for (const pos of positions) {
      if (filledPositions.has(pos)) continue;
      if (assignedThisInning.size >= fieldSlotsPerInning) break;

      const eligible = players
        .filter((p) => {
          if (assignedThisInning.has(p.id)) return false;
          if (forcedBench.has(p.id)) return false;
          const posCount = positionCount.get(p.id)?.get(pos) ?? 0;
          if (posCount >= maxPerPosition) return false;
          // Pitching is the ONLY hard exclusion — every other position is open
          // to every player. The old "eligiblePositions" gate is gone; coaches
          // express position fit through `preferredPositions` (soft bias) and
          // `cannotPlayMap` (per-game constraints) instead.
          if (pos === "P" && !p.canPitch) return false;
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
          // Preferred-position bonus scales up as the equity dial drops below 50.
          const aPref = a.preferredPositions.includes(pos) ? preferredBonus : 0;
          const bPref = b.preferredPositions.includes(pos) ? preferredBonus : 0;
          // Depth-chart bonus: also scales up below e=0.5, decays with
          // depth-chart rank. Additive with preferredBonus so a player
          // who is BOTH preferred and #1 in the depth chart gets the
          // strongest possible push toward this slot in tournament play.
          const aDepth = depthBonusFor(a.id, pos);
          const bDepth = depthBonusFor(b.id, pos);
          const scoreDiff =
            (scorePlayer(b.id, inning, isLastInning) + bMust + bPref + bDepth) -
            (scorePlayer(a.id, inning, isLastInning) + aMust + aPref + aDepth);
          if (scoreDiff !== 0) return scoreDiff;
          // Final tiebreaker: still prefer preferred positions (matches legacy at e>=0.5).
          // We do NOT add a depth-chart tiebreaker here — once the bonus
          // hits 0 (e>=0.5) we honor the coach's "everyone gets time"
          // intent and don't sneak the depth chart back in via tiebreak.
          const aPreferred = a.preferredPositions.includes(pos) ? -1 : 0;
          const bPreferred = b.preferredPositions.includes(pos) ? -1 : 0;
          return aPreferred - bPreferred;
        });

      const player = eligible[0];
      if (!player) {
        // Fallback: any unassigned non-forced player. Pitching keeps its
        // hard exclusion here too — a non-pitcher must never be auto-placed
        // at "P", even when the greedy fill runs out of preferred candidates.
        const fallback = players
          .filter(
            (p) =>
              !assignedThisInning.has(p.id) &&
              !forcedBench.has(p.id) &&
              !(pos === "P" && !p.canPitch),
          )
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

    // Hard-enforce "no bench 2 of 3" via swap pass:
    // For any player who would violate when benched, try to swap them onto the field
    // by ejecting a non-violator currently in a position the violator can play.
    if (noBenchTwoOfThree) {
      for (const p of players) {
        if (assignedThisInning.has(p.id)) continue;
        if (forcedBench.has(p.id)) continue;
        if (!wouldViolateTwoOfThree(p.id, inning)) continue;
        // Find a swap target: a field assignment held by a non-violator that p is eligible for
        const swapIdx = inningAssignments.findIndex((e) => {
          if (e.position === "Bench") return false;
          if (forcedBench.has(e.playerId)) return false;
          if (wouldViolateTwoOfThree(e.playerId, inning)) return false;
          // Same rule as the greedy fill: only pitching is hard-excluded.
          if (e.position === "P" && !p.canPitch) return false;
          if (cannotPlayMap.get(p.id)?.has(e.position)) return false;
          if (rotatePitcher && e.position === "P" && p.id === lastPitcher) return false;
          const posCount = positionCount.get(p.id)?.get(e.position) ?? 0;
          if (posCount >= maxPerPosition) return false;
          return true;
        });
        if (swapIdx === -1) continue;
        const swapped = inningAssignments[swapIdx]!;
        // Roll back the displaced player's bookkeeping
        positionCount.get(swapped.playerId)!.set(
          swapped.position,
          (positionCount.get(swapped.playerId)!.get(swapped.position) ?? 1) - 1
        );
        totalInningsPlayed.set(swapped.playerId, (totalInningsPlayed.get(swapped.playerId) ?? 1) - 1);
        assignedThisInning.delete(swapped.playerId);
        // Insert violator
        inningAssignments[swapIdx] = { playerId: p.id, inning, position: swapped.position, battingOrder: null };
        positionCount.get(p.id)!.set(swapped.position, (positionCount.get(p.id)!.get(swapped.position) ?? 0) + 1);
        positionsPlayed.get(p.id)!.add(swapped.position);
        totalInningsPlayed.set(p.id, (totalInningsPlayed.get(p.id) ?? 0) + 1);
        assignedThisInning.add(p.id);
      }
    }

    // Assign bench
    for (const p of players) {
      if (assignedThisInning.has(p.id)) continue;
      inningAssignments.push({ playerId: p.id, inning, position: "Bench", battingOrder: null });
      benchCount.set(p.id, (benchCount.get(p.id) ?? 0) + 1);
      benchedInnings.get(p.id)!.add(inning);
    }

    results.push(...inningAssignments);
  }

  // Batting order — depends on gameType:
  //  - "league"     → ascending season plate appearances (under-used kids bat
  //                   earlier so they get more PAs this game). Tiebreak by
  //                   field time so a player who sat the whole game still
  //                   slots behind a similarly-batted player who took the field.
  //  - "tournament" → OBP desc, then field time desc — most-likely-to-reach
  //                   bats first.
  //  - default      → legacy behavior (more field time → earlier slot).
  const battingOrderMap = new Map<number, number>();
  let slot = 1;
  const paMap = constraints.playerSeasonPlateAppearances ?? new Map<number, number>();
  let ordered: Player[];
  if (constraints.gameType === "league") {
    ordered = [...players].sort((a, b) => {
      const paDiff = (paMap.get(a.id) ?? 0) - (paMap.get(b.id) ?? 0);
      if (paDiff !== 0) return paDiff;
      return (totalInningsPlayed.get(b.id) ?? 0) - (totalInningsPlayed.get(a.id) ?? 0);
    });
  } else if (constraints.gameType === "tournament") {
    // Tournament batting order: table-setter / cleanup blend.
    //
    // Plain OBP-descending isn't quite what a coach wants — yes, the
    // best on-base guy should bat early, but the most-valuable spot for
    // raw power (SLG) is hitting BEHIND the table setters so they get
    // driven in. So we do a two-stage arrangement:
    //
    //   Stage 1 — score every player on OPS (= OBP + SLG). Players
    //             missing stats use the TEAM MEAN of each component so
    //             a kid with no recorded at-bats slots into the middle
    //             instead of getting buried at the bottom (per coach
    //             preference: "treated as average").
    //
    //   Stage 2 — take the top 5 by OPS as the "core" of the order and
    //             rearrange them in the classic pattern:
    //               1  best OBP        (table setter)
    //               2  2nd-best OBP    (table setter)
    //               3  best remaining  (highest OPS — best overall hitter)
    //               4  best SLG        (cleanup — drives in the runners)
    //               5  2nd-best SLG    (protection)
    //             Slots 6+ fall in pure OPS-descending order.
    //
    // Tiebreakers throughout: more field time → earlier slot, so a
    // player who actually played gets bumped ahead of a similarly-rated
    // player who sat the whole game.
    const obpMap = constraints.playerSeasonOBP ?? new Map<number, number>();
    const slgMap = constraints.playerSeasonSLG ?? new Map<number, number>();
    const knownObps = [...obpMap.values()];
    const knownSlgs = [...slgMap.values()];
    const meanOBP = knownObps.length > 0
      ? knownObps.reduce((a, b) => a + b, 0) / knownObps.length
      : 0;
    const meanSLG = knownSlgs.length > 0
      ? knownSlgs.reduce((a, b) => a + b, 0) / knownSlgs.length
      : 0;
    type Scored = { player: Player; obp: number; slg: number; ops: number };
    const scored: Scored[] = players.map((p) => {
      const obp = obpMap.get(p.id) ?? meanOBP;
      const slg = slgMap.get(p.id) ?? meanSLG;
      return { player: p, obp, slg, ops: obp + slg };
    });
    const fieldTime = (s: Scored) => totalInningsPlayed.get(s.player.id) ?? 0;
    // Baseline: OPS desc, field time desc as tiebreaker.
    scored.sort((a, b) => (b.ops - a.ops) || (fieldTime(b) - fieldTime(a)));
    // Core arrangement on the top 5 (or however many we have).
    const coreSize = Math.min(5, scored.length);
    const core = scored.slice(0, coreSize);
    const tail = scored.slice(coreSize);
    const arranged: Scored[] = [];
    const pickFrom = (pool: Scored[], scoreFn: (s: Scored) => number) => {
      if (pool.length === 0) return undefined;
      let bestIdx = 0;
      for (let i = 1; i < pool.length; i++) {
        const better =
          scoreFn(pool[i]!) > scoreFn(pool[bestIdx]!) ||
          (scoreFn(pool[i]!) === scoreFn(pool[bestIdx]!) && fieldTime(pool[i]!) > fieldTime(pool[bestIdx]!));
        if (better) bestIdx = i;
      }
      return pool.splice(bestIdx, 1)[0];
    };
    // 1 & 2: best two OBPs from the core (table setters).
    const t1 = pickFrom(core, (s) => s.obp); if (t1) arranged.push(t1);
    const t2 = pickFrom(core, (s) => s.obp); if (t2) arranged.push(t2);
    // 3: best remaining OPS (best overall hitter still left in the core).
    const t3 = pickFrom(core, (s) => s.ops); if (t3) arranged.push(t3);
    // 4 & 5: best two SLGs from what's left (cleanup + protection).
    const t4 = pickFrom(core, (s) => s.slg); if (t4) arranged.push(t4);
    const t5 = pickFrom(core, (s) => s.slg); if (t5) arranged.push(t5);
    // Anything left in `core` (defensive — shouldn't trigger with size ≤5)
    // and the tail fall through in OPS-descending order.
    arranged.push(...core.sort((a, b) => (b.ops - a.ops) || (fieldTime(b) - fieldTime(a))));
    arranged.push(...tail);
    ordered = arranged.map((s) => s.player);
  } else {
    ordered = [...players].sort(
      (a, b) => (totalInningsPlayed.get(b.id) ?? 0) - (totalInningsPlayed.get(a.id) ?? 0)
    );
  }
  // In nine-man mode only the top 9 players (by the chosen ordering rule)
  // get a batting slot — the rest are subs with battingOrder=null. Continuous
  // mode (the default) hands a slot to everyone on the roster.
  const battingCap =
    constraints.battingStyle === "nine_man" ? Math.min(9, ordered.length) : ordered.length;
  for (let i = 0; i < battingCap; i++) battingOrderMap.set(ordered[i]!.id, slot++);

  return results.map((e) => ({
    ...e,
    battingOrder: e.position !== "Bench" ? (battingOrderMap.get(e.playerId) ?? null) : null,
  }));
}
