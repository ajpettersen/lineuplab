import type {
  PoolPlayJson,
  PoolPlayGameJson,
  PoolPlayTiebreakerKey,
} from "@workspace/db";
import { tiebreakersFromLegacy } from "@workspace/db";

/**
 * Pool-play scenario simulator.
 *
 * Enumerates every possible W/L outcome of the remaining (non-final)
 * games and produces:
 *  - today's standings (computed from final games only)
 *  - per-team finish-position probabilities
 *  - clinch / elimination flags (relative to the pool's advanceCount)
 *  - bye flags (relative to the pool's byeCount)
 *
 * Run differential / runs scored / runs allowed are computed from final
 * games only — we don't try to predict future scores. As a result those
 * tiebreakers, when they apply, use today's actual values and treat
 * remaining games as contributing 0. That's a reasonable lower bound for
 * "what we've already established" and avoids inventing scores.
 *
 * Ties are not enumerated in v1 (every remaining game is W/L) — the
 * tie outcome is rare in tournament pool play and tripling the state
 * space hurts the enumeration cap. Manually editing a remaining game
 * to a tie before saving still works for the standings math.
 */

export type TeamRecord = {
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  runsFor: number;
  runsAgainst: number;
  runDiff: number;
  winPct: number;
};

export type TeamProjection = {
  teamName: string;
  /**
   * `finishProbs[i]` = fraction of scenarios in which this team
   * finishes in position `i` (0-indexed; 0 = 1st place).
   */
  finishProbs: number[];
  /** True in EVERY enumerated scenario the team finishes 1st. */
  clinchedFirst: boolean;
  /** True in EVERY enumerated scenario the team is in the top `advanceCount`. */
  clinchedAdvance: boolean;
  /** True in EVERY enumerated scenario the team is in the top `byeCount`. */
  clinchedBye: boolean;
  /** True in NO enumerated scenario the team finishes 1st. */
  eliminatedFirst: boolean;
  /** True in NO enumerated scenario the team is in the top `advanceCount`. */
  eliminatedAdvance: boolean;
  /** Probability of advancing (finishing in top `advanceCount`). */
  advanceProb: number;
  /** Probability of finishing first. */
  firstProb: number;
  /** Probability of earning a bye (finishing in top `byeCount`). 0 when byeCount=0. */
  byeProb: number;
};

export type PoolPlayAnalysis = {
  /** Total scenarios enumerated. */
  scenarioCount: number;
  /** True when the number of remaining games exceeded the enumeration cap. */
  truncated: boolean;
  /** Cap on remaining games — anything beyond this is skipped (treated as a "?"). */
  remainingGamesCap: number;
  /** Number of remaining games actually present (informational; may exceed the cap). */
  remainingGames: number;
  /** Current standings (final games only). */
  standingsToday: TeamRecord[];
  /** Per-team finish projections. Ordered by best advance probability. */
  projections: TeamProjection[];
  /** advanceCount mirrored from input for client convenience. */
  advanceCount: number;
  /** byeCount mirrored from input for client convenience. */
  byeCount: number;
  /** Ordered tiebreaker chain in effect (for label rendering). */
  tiebreakers: PoolPlayTiebreakerKey[];
  /** Human-readable summary lines for the coach's own team (top 4 most useful). */
  ourTeamInsights: string[];
};

const REMAINING_GAMES_CAP = 14; // 2^14 = 16384 scenarios — fast to enumerate.

function emptyRecord(name: string): TeamRecord {
  return {
    teamName: name,
    wins: 0,
    losses: 0,
    ties: 0,
    gamesPlayed: 0,
    runsFor: 0,
    runsAgainst: 0,
    runDiff: 0,
    winPct: 0,
  };
}

function applyGameToRecords(
  records: Map<string, TeamRecord>,
  game: PoolPlayGameJson,
  // Override outcome for simulated remaining games. If provided, scores
  // contribute 0 to runFor/runAgainst (we don't invent scores).
  override?: "home" | "away",
): void {
  const home = records.get(game.home);
  const away = records.get(game.away);
  if (!home || !away) return; // unknown team — drop silently

  if (override) {
    home.gamesPlayed++;
    away.gamesPlayed++;
    if (override === "home") {
      home.wins++;
      away.losses++;
    } else {
      away.wins++;
      home.losses++;
    }
    return;
  }

  // Real final game with known scores
  const hs = game.homeScore ?? 0;
  const as = game.awayScore ?? 0;
  home.gamesPlayed++;
  away.gamesPlayed++;
  home.runsFor += hs;
  home.runsAgainst += as;
  away.runsFor += as;
  away.runsAgainst += hs;
  if (hs > as) {
    home.wins++;
    away.losses++;
  } else if (as > hs) {
    away.wins++;
    home.losses++;
  } else {
    home.ties++;
    away.ties++;
  }
}

function finalizeRecord(r: TeamRecord): void {
  r.runDiff = r.runsFor - r.runsAgainst;
  const decisions = r.wins + r.losses; // ties don't count toward pct
  r.winPct = decisions === 0 ? 0 : r.wins / decisions;
}

/**
 * Resolve the effective ordered tiebreaker chain from a pool-play row.
 * Prefers the new `tiebreakers` array; falls back to the legacy enum
 * mapping (so rows persisted before the upgrade still sort sensibly).
 */
function effectiveTiebreakers(pool: PoolPlayJson): PoolPlayTiebreakerKey[] {
  if (Array.isArray(pool.tiebreakers) && pool.tiebreakers.length > 0) {
    return pool.tiebreakers;
  }
  return tiebreakersFromLegacy(pool.tiebreaker);
}

/**
 * Sort all teams using the configured ordered tiebreaker chain.
 * Unlike a winPct-first hardcoded sort, the FIRST key in the chain is
 * the primary sort. Subsequent keys recursively break ties within
 * equal-primary subgroups.
 */
function sortTeams(
  records: TeamRecord[],
  allGames: PoolPlayGameJson[],
  chain: PoolPlayTiebreakerKey[],
): TeamRecord[] {
  return resolveGroup(records, allGames, chain);
}

/**
 * Resolve a group of teams (or the full pool) using the ordered chain
 * strictly lexicographically: take the first step's score as the
 * primary key; teams that remain tied within that key are recursed
 * with the REMAINING chain (never any earlier step). When the chain
 * runs out, fall back to alphabetical for a stable total order.
 *
 * IMPORTANT: do not try to "skip" a step that didn't separate anyone —
 * the recursion already handles all-tied subgroups by passing the
 * remainder of the chain down. Skipping outward would let a later
 * step reorder across already-resolved partitions of a higher-priority
 * step, violating lex chain semantics.
 */
function resolveGroup(
  group: TeamRecord[],
  allGames: PoolPlayGameJson[],
  chain: PoolPlayTiebreakerKey[],
): TeamRecord[] {
  if (group.length <= 1) return group;
  if (chain.length === 0) {
    return [...group].sort((a, b) => a.teamName.localeCompare(b.teamName));
  }
  const step = chain[0];
  const rest = chain.slice(1);
  const scored = group.map((t) => ({
    team: t,
    score: scoreTeam(t, group, allGames, step),
  }));
  scored.sort((a, b) => b.score - a.score);
  const out: TeamRecord[] = [];
  let i = 0;
  while (i < scored.length) {
    let j = i + 1;
    while (j < scored.length && scored[j].score === scored[i].score) j++;
    const sub = scored.slice(i, j).map((x) => x.team);
    if (sub.length === 1) {
      out.push(...sub);
    } else {
      out.push(...resolveGroup(sub, allGames, rest));
    }
    i = j;
  }
  return out;
}

/**
 * Cheap deterministic hash for the coinFlip tiebreaker. We want a
 * stable ordering across scenarios (so projection counts converge)
 * but one that isn't obviously alphabetical — otherwise coaches who
 * picked coinFlip in the UI would see "A teams always beat Z teams"
 * which is misleading. A simple djb2-style hash on the name does it.
 */
function coinFlipHash(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  // Force into a small float so equal hashes are still possible (then
  // we fall through to alphabetical), but ordering looks scrambled.
  return h;
}

function scoreTeam(
  team: TeamRecord,
  group: TeamRecord[],
  allGames: PoolPlayGameJson[],
  step: PoolPlayTiebreakerKey,
): number {
  switch (step) {
    case "winPct":
      return team.winPct;
    case "runDiff":
      return team.runDiff;
    case "runsScored":
      return team.runsFor;
    case "runsAllowed":
      // Less is better — negate so higher score = better.
      return -team.runsAgainst;
    case "coinFlip":
      return coinFlipHash(team.teamName);
    case "h2h": {
      // head-to-head: combined record vs the OTHER teams in the group.
      // Multi-way: count wins against group members only.
      const opponents = new Set(
        group.filter((g) => g.teamName !== team.teamName).map((g) => g.teamName),
      );
      let h2hWins = 0;
      let h2hDecisions = 0;
      for (const g of allGames) {
        if (!g.final) continue;
        const hs = g.homeScore ?? 0;
        const as = g.awayScore ?? 0;
        if (hs === as) continue;
        const winner = hs > as ? g.home : g.away;
        const loser = hs > as ? g.away : g.home;
        if (team.teamName === winner && opponents.has(loser)) {
          h2hWins++;
          h2hDecisions++;
        } else if (team.teamName === loser && opponents.has(winner)) {
          h2hDecisions++;
        }
      }
      if (h2hDecisions === 0) return 0;
      return h2hWins / h2hDecisions;
    }
  }
}

/**
 * Build the current standings from final games only.
 */
export function computeStandings(pool: PoolPlayJson): TeamRecord[] {
  const records = new Map<string, TeamRecord>();
  for (const t of pool.teams) records.set(t.name, emptyRecord(t.name));
  for (const g of pool.games) {
    if (g.final && g.homeScore != null && g.awayScore != null) {
      applyGameToRecords(records, g);
    }
  }
  for (const r of records.values()) finalizeRecord(r);
  return sortTeams(Array.from(records.values()), pool.games, effectiveTiebreakers(pool));
}

/**
 * Full scenario simulation.
 */
export function simulatePoolPlay(pool: PoolPlayJson): PoolPlayAnalysis {
  const chain = effectiveTiebreakers(pool);

  // Validate team list against game references — silently drop games
  // that reference unknown teams (UI prevents this but be defensive).
  const teamSet = new Set(pool.teams.map((t) => t.name));
  const validGames = pool.games.filter(
    (g) => teamSet.has(g.home) && teamSet.has(g.away),
  );

  const finalGames = validGames.filter(
    (g) => g.final && g.homeScore != null && g.awayScore != null,
  );
  const remainingGames = validGames.filter((g) => !g.final);

  const truncated = remainingGames.length > REMAINING_GAMES_CAP;
  // When truncated, project on the first N remaining (sorted by id for
  // determinism). The cap is generous enough (14 games = 16k scenarios)
  // that real pool play will never hit it.
  const enumerated = truncated
    ? [...remainingGames].sort((a, b) => a.id.localeCompare(b.id)).slice(0, REMAINING_GAMES_CAP)
    : remainingGames;

  // Standings today (final games only).
  const todayRecords = new Map<string, TeamRecord>();
  for (const t of pool.teams) todayRecords.set(t.name, emptyRecord(t.name));
  for (const g of finalGames) applyGameToRecords(todayRecords, g);
  for (const r of todayRecords.values()) finalizeRecord(r);
  const standingsToday = sortTeams(
    Array.from(todayRecords.values()),
    pool.games,
    chain,
  );

  // Per-team counters across scenarios
  const teamNames = pool.teams.map((t) => t.name);
  const positionCounts = new Map<string, number[]>(); // teamName -> count per position
  for (const name of teamNames) {
    positionCounts.set(
      name,
      Array(teamNames.length).fill(0),
    );
  }

  const advanceCount = pool.advanceCount;
  const byeCount = typeof pool.byeCount === "number" ? pool.byeCount : 0;
  const scenarioTotal = 1 << enumerated.length; // 2^N

  // Enumerate scenarios as N-bit numbers; bit i = "home team wins" for
  // remaining game i.
  for (let bits = 0; bits < scenarioTotal; bits++) {
    // Clone today's records as the starting state
    const records = new Map<string, TeamRecord>();
    for (const r of todayRecords.values()) {
      records.set(r.teamName, { ...r });
    }
    // Apply each remaining game's simulated outcome
    for (let i = 0; i < enumerated.length; i++) {
      const game = enumerated[i];
      const homeWins = (bits & (1 << i)) !== 0;
      applyGameToRecords(records, game, homeWins ? "home" : "away");
    }
    // Recompute winPct (runDiff/runsFor/runsAgainst unchanged — simulated
    // games contribute 0 to runs).
    for (const r of records.values()) finalizeRecord(r);
    // Build the "all games seen so far" list for h2h tiebreakers, treating
    // simulated remaining games as final with 1-0 scores (so h2h works).
    const simGames: PoolPlayGameJson[] = [
      ...finalGames,
      ...enumerated.map((g, i) => {
        const homeWins = (bits & (1 << i)) !== 0;
        return {
          ...g,
          final: true,
          homeScore: homeWins ? 1 : 0,
          awayScore: homeWins ? 0 : 1,
        };
      }),
    ];
    const ranked = sortTeams(
      Array.from(records.values()),
      simGames,
      chain,
    );
    for (let pos = 0; pos < ranked.length; pos++) {
      const arr = positionCounts.get(ranked[pos].teamName)!;
      arr[pos]++;
    }
  }

  // Build per-team projections
  const projections: TeamProjection[] = teamNames.map((name) => {
    const counts = positionCounts.get(name)!;
    const finishProbs = counts.map((c) => c / scenarioTotal);
    const firstCount = counts[0];
    const advanceCountTotal = counts.slice(0, advanceCount).reduce((s, c) => s + c, 0);
    const byeCountTotal =
      byeCount > 0 ? counts.slice(0, byeCount).reduce((s, c) => s + c, 0) : 0;
    return {
      teamName: name,
      finishProbs,
      clinchedFirst: firstCount === scenarioTotal,
      clinchedAdvance: advanceCountTotal === scenarioTotal,
      clinchedBye: byeCount > 0 && byeCountTotal === scenarioTotal,
      eliminatedFirst: firstCount === 0,
      eliminatedAdvance: advanceCountTotal === 0,
      firstProb: firstCount / scenarioTotal,
      advanceProb: advanceCountTotal / scenarioTotal,
      byeProb: byeCount > 0 ? byeCountTotal / scenarioTotal : 0,
    };
  });
  // Sort by advance probability desc, then by first-place probability
  projections.sort((a, b) => {
    if (b.advanceProb !== a.advanceProb) return b.advanceProb - a.advanceProb;
    return b.firstProb - a.firstProb;
  });

  // Build "your team" insights — at most 4 punchy lines for the coach
  const ours = projections.find((p) => p.teamName === pool.ourTeamName);
  const ourTeamInsights: string[] = [];
  if (ours) {
    if (ours.clinchedFirst) {
      ourTeamInsights.push("You've already clinched 1st in the pool.");
    } else if (ours.clinchedBye) {
      ourTeamInsights.push(`You've clinched a top-${byeCount} bye.`);
    } else if (ours.clinchedAdvance) {
      ourTeamInsights.push(
        `You've clinched a spot in the top ${advanceCount}.`,
      );
    } else if (ours.eliminatedAdvance) {
      ourTeamInsights.push(
        `You can no longer finish in the top ${advanceCount}.`,
      );
    } else if (ours.eliminatedFirst) {
      ourTeamInsights.push("You can no longer finish 1st.");
    }
    ourTeamInsights.push(
      `Chance of finishing 1st: ${Math.round(ours.firstProb * 100)}%.`,
    );
    if (!ours.clinchedAdvance && !ours.eliminatedAdvance) {
      ourTeamInsights.push(
        `Chance of advancing (top ${advanceCount}): ${Math.round(ours.advanceProb * 100)}%.`,
      );
    }
    if (byeCount > 0 && !ours.clinchedBye && ours.byeProb > 0) {
      ourTeamInsights.push(
        `Chance of a bye (top ${byeCount}): ${Math.round(ours.byeProb * 100)}%.`,
      );
    }
  }

  return {
    scenarioCount: scenarioTotal,
    truncated,
    remainingGamesCap: REMAINING_GAMES_CAP,
    remainingGames: remainingGames.length,
    standingsToday,
    projections,
    advanceCount,
    byeCount,
    tiebreakers: chain,
    ourTeamInsights: ourTeamInsights.slice(0, 4),
  };
}
