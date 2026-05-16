import type { PoolPlayJson, PoolPlayGameJson } from "@workspace/db";

/**
 * Pool-play scenario simulator.
 *
 * Enumerates every possible W/L outcome of the remaining (non-final)
 * games and produces:
 *  - today's standings (computed from final games only)
 *  - per-team finish-position probabilities
 *  - clinch / elimination flags (relative to the pool's advanceCount)
 *
 * Run differential is computed from final games only — we don't try to
 * predict future scores. As a result the runDiff tiebreaker, if it
 * applies, uses today's actual diffs and treats remaining games as
 * contributing 0. That's a reasonable lower bound for "what we've
 * already established" and avoids inventing scores.
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
  /** True in NO enumerated scenario the team finishes 1st. */
  eliminatedFirst: boolean;
  /** True in NO enumerated scenario the team is in the top `advanceCount`. */
  eliminatedAdvance: boolean;
  /** Probability of advancing (finishing in top `advanceCount`). */
  advanceProb: number;
  /** Probability of finishing first. */
  firstProb: number;
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
  /** Human-readable summary lines for the coach's own team (top 3 most useful). */
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
 * Sort teams using the configured tiebreaker chain. Resolves multi-way
 * ties by recursively re-applying tiebreakers within the tied group.
 */
function sortTeams(
  records: TeamRecord[],
  allGames: PoolPlayGameJson[],
  tiebreaker: PoolPlayJson["tiebreaker"],
): TeamRecord[] {
  // Group by win% then break ties.
  const sorted = [...records].sort((a, b) => b.winPct - a.winPct);
  // Within equal-winPct groups, apply chain.
  const result: TeamRecord[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].winPct === sorted[i].winPct) j++;
    const group = sorted.slice(i, j);
    if (group.length === 1) {
      result.push(group[0]);
    } else {
      result.push(...breakTie(group, allGames, tiebreaker));
    }
    i = j;
  }
  return result;
}

/**
 * Break a multi-team tie. Walks the tiebreaker chain in order: at each
 * step, if it produces a unique winner (or a smaller subgroup) it
 * recurses; if it doesn't separate anyone, falls through to the next
 * step.
 */
function breakTie(
  group: TeamRecord[],
  allGames: PoolPlayGameJson[],
  tiebreaker: PoolPlayJson["tiebreaker"],
): TeamRecord[] {
  const chain = tiebreakerChain(tiebreaker);
  return resolveGroup(group, allGames, chain);
}

function tiebreakerChain(
  tiebreaker: PoolPlayJson["tiebreaker"],
): TiebreakerStep[] {
  switch (tiebreaker) {
    case "winPct_runDiff_h2h":
      return ["runDiff", "h2h"];
    case "winPct_h2h":
      return ["h2h", "runDiff"]; // runDiff still used as last-ditch
    case "winPct_h2h_runDiff":
    default:
      return ["h2h", "runDiff"];
  }
}

type TiebreakerStep = "h2h" | "runDiff";

function resolveGroup(
  group: TeamRecord[],
  allGames: PoolPlayGameJson[],
  chain: TiebreakerStep[],
): TeamRecord[] {
  if (group.length <= 1) return group;
  for (let s = 0; s < chain.length; s++) {
    const step = chain[s];
    const scored = group.map((t) => ({
      team: t,
      score: scoreTeam(t, group, allGames, step),
    }));
    // Sort by step score desc
    scored.sort((a, b) => b.score - a.score);
    // Re-group by equal score and recurse with remaining chain on
    // subgroups that are still tied.
    const out: TeamRecord[] = [];
    let i = 0;
    while (i < scored.length) {
      let j = i + 1;
      while (j < scored.length && scored[j].score === scored[i].score) j++;
      const sub = scored.slice(i, j).map((x) => x.team);
      if (sub.length === 1 || s === chain.length - 1) {
        // Either uniquely placed, or we've exhausted the chain — stop.
        out.push(...sub);
      } else {
        out.push(...resolveGroup(sub, allGames, chain.slice(s + 1)));
      }
      i = j;
    }
    // If this step changed the ordering at all (i.e. produced any subgroup
    // smaller than the input), accept it. Otherwise continue to next step.
    const anyProgress = out.some(
      (t, idx) => group.findIndex((g) => g.teamName === t.teamName) !== idx,
    );
    if (anyProgress) return out;
  }
  // Stable fallback: original order (then by name for total ordering).
  return [...group].sort((a, b) => a.teamName.localeCompare(b.teamName));
}

function scoreTeam(
  team: TeamRecord,
  group: TeamRecord[],
  allGames: PoolPlayGameJson[],
  step: TiebreakerStep,
): number {
  if (step === "runDiff") return team.runDiff;
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
  return sortTeams(Array.from(records.values()), pool.games, pool.tiebreaker);
}

/**
 * Full scenario simulation.
 */
export function simulatePoolPlay(pool: PoolPlayJson): PoolPlayAnalysis {
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
  const skipped = truncated ? remainingGames.length - enumerated.length : 0;

  // Standings today (final games only).
  const todayRecords = new Map<string, TeamRecord>();
  for (const t of pool.teams) todayRecords.set(t.name, emptyRecord(t.name));
  for (const g of finalGames) applyGameToRecords(todayRecords, g);
  for (const r of todayRecords.values()) finalizeRecord(r);
  const standingsToday = sortTeams(
    Array.from(todayRecords.values()),
    pool.games,
    pool.tiebreaker,
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
    // Recompute winPct (runDiff unchanged — simulated games contribute 0)
    for (const r of records.values()) finalizeRecord(r);
    // Build the "all games seen so far" list for tiebreakers, treating
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
      pool.tiebreaker,
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
    return {
      teamName: name,
      finishProbs,
      clinchedFirst: firstCount === scenarioTotal,
      clinchedAdvance: advanceCountTotal === scenarioTotal,
      eliminatedFirst: firstCount === 0,
      eliminatedAdvance: advanceCountTotal === 0,
      firstProb: firstCount / scenarioTotal,
      advanceProb: advanceCountTotal / scenarioTotal,
    };
  });
  // Sort by advance probability desc, then by first-place probability
  projections.sort((a, b) => {
    if (b.advanceProb !== a.advanceProb) return b.advanceProb - a.advanceProb;
    return b.firstProb - a.firstProb;
  });

  // Build "your team" insights — at most 3 punchy lines for the coach
  const ours = projections.find((p) => p.teamName === pool.ourTeamName);
  const ourTeamInsights: string[] = [];
  if (ours) {
    if (ours.clinchedFirst) {
      ourTeamInsights.push("You've already clinched 1st in the pool.");
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
  }

  return {
    scenarioCount: scenarioTotal,
    truncated,
    remainingGamesCap: REMAINING_GAMES_CAP,
    remainingGames: remainingGames.length,
    standingsToday,
    projections,
    advanceCount,
    ourTeamInsights: ourTeamInsights.slice(0, 4),
  };
}
