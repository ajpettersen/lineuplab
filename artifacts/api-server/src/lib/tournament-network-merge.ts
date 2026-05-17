import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  db,
  gamesTable,
  teamSettingsTable,
  tournamentNetworkMembersTable,
  tournamentsTable,
  type PoolPlayJson,
  type PoolPlayGameJson,
} from "@workspace/db";

/**
 * Merge games from OTHER coaches in the same tournament network into
 * the pool-play games list as synthetic `network-<userId>-<gameId>`
 * entries. Same idempotency contract as `mergeRealGamesIntoPool` —
 * every existing `network-*` entry is stripped before re-projecting.
 *
 * Rules:
 *  - Only pulls from members who haven't disabled `shareScores`. A
 *    coach who joins for visibility/standings but doesn't want their
 *    own scores public can leave shareScores=false.
 *  - Only games where BOTH the opponent and the sharing coach's team
 *    name match teams in our pool. Bracket / playoff games whose
 *    opponent is in the pool still get pulled — we trust the per-team
 *    pool round-robin quota to bound duplication.
 *  - `home` is always set to the sharing coach's teamName; the
 *    "homeScore" is their score, "awayScore" is the opponent's.
 *  - If THIS tournament also has a `real-<gameId>` entry from the
 *    same pair on the same day, we skip the network version — the
 *    local coach has authoritative scoring of their own games.
 *
 * Cheap-but-correct: one query to load the network members, one to
 * load their games. Returns the pool unchanged when this tournament
 * isn't in a network or no shared games qualify.
 */
export async function mergeNetworkGamesIntoPool(
  pool: PoolPlayJson,
  tournamentId: number,
): Promise<PoolPlayJson> {
  // Find this tournament's network membership.
  const [membership] = await db
    .select({ networkId: tournamentNetworkMembersTable.networkId })
    .from(tournamentNetworkMembersTable)
    .where(eq(tournamentNetworkMembersTable.tournamentId, tournamentId));
  if (!membership) return pool;

  // Other network members who share their scores.
  const sharers = await db
    .select({
      userId: tournamentNetworkMembersTable.userId,
      tournamentId: tournamentNetworkMembersTable.tournamentId,
      teamName: teamSettingsTable.teamName,
    })
    .from(tournamentNetworkMembersTable)
    .leftJoin(
      teamSettingsTable,
      eq(teamSettingsTable.userId, tournamentNetworkMembersTable.userId),
    )
    .where(
      and(
        eq(tournamentNetworkMembersTable.networkId, membership.networkId),
        eq(tournamentNetworkMembersTable.shareScores, true),
        // Self exclusion handled below since we still need to know our own row
        // to map games → tournament ids; but for game pull we use the others.
      ),
    );
  // The sharer's tournamentId tells us which `games.tournamentId` to
  // filter on for that user. Build a per-user (tournamentId, teamName)
  // map.
  const ourTournamentIds = new Set<number>();
  const others = sharers.filter((s) => {
    if (s.tournamentId === tournamentId) {
      ourTournamentIds.add(s.tournamentId);
      return false;
    }
    return !!s.teamName;
  });
  if (others.length === 0) return pool;

  const poolTeams = new Set(pool.teams.map((t) => t.name));
  const otherTournamentIds = others.map((o) => o.tournamentId);
  const otherUserIds = Array.from(new Set(others.map((o) => o.userId)));

  // One bulk pull of all candidate games across other members'
  // tournaments. Same filter shape as the local merge (non-deleted,
  // matching tournamentId). Defense-in-depth: also pin to the set of
  // sharer userIds — `otherTournamentIds` already only contains
  // shareScores=true tournaments, but if a tournament_id was somehow
  // reassigned across users we'd still refuse to pull a game whose
  // userId isn't in the opted-in sharer set.
  const candidateGames = await db
    .select({
      id: gamesTable.id,
      userId: gamesTable.userId,
      tournamentId: gamesTable.tournamentId,
      opponent: gamesTable.opponent,
      ourScore: gamesTable.ourScore,
      opponentScore: gamesTable.opponentScore,
      gameDate: gamesTable.gameDate,
    })
    .from(gamesTable)
    .where(
      and(
        inArray(gamesTable.tournamentId, otherTournamentIds),
        inArray(gamesTable.userId, otherUserIds),
        isNull(gamesTable.deletedAt),
      ),
    );

  // Skip-set of (yyyy-mm-dd, sortedPair) for games already represented
  // by a local real-* entry — local coach's own scoring wins.
  const localPairKeys = new Set<string>();
  for (const g of pool.games) {
    if (!g.id.startsWith("real-")) continue;
    const dayKey = g.scheduledAt ? g.scheduledAt.slice(0, 10) : "";
    const pair = [g.home, g.away].sort().join("|");
    localPairKeys.add(`${dayKey}|${pair}`);
  }

  // Index sharer teamName by tournamentId for O(1) lookup.
  const teamNameByTid = new Map<number, string>();
  for (const o of others) {
    if (o.teamName) teamNameByTid.set(o.tournamentId, o.teamName);
  }

  const synthetic: PoolPlayGameJson[] = [];
  for (const g of candidateGames) {
    if (g.tournamentId == null) continue;
    const sharerTeam = teamNameByTid.get(g.tournamentId);
    if (!sharerTeam) continue;
    if (!g.opponent) continue;
    if (!poolTeams.has(sharerTeam) || !poolTeams.has(g.opponent)) continue;
    const dayKey = g.gameDate ? g.gameDate.toISOString().slice(0, 10) : "";
    const pair = [sharerTeam, g.opponent].sort().join("|");
    if (localPairKeys.has(`${dayKey}|${pair}`)) continue;
    const ourScore = g.ourScore;
    const oppScore = g.opponentScore;
    const bothSet = ourScore != null && oppScore != null;
    synthetic.push({
      id: `network-${g.userId}-${g.id}`,
      home: sharerTeam,
      away: g.opponent,
      homeScore: ourScore ?? null,
      awayScore: oppScore ?? null,
      final: bothSet,
      scheduledAt: g.gameDate ? g.gameDate.toISOString() : null,
    });
  }

  if (synthetic.length === 0) {
    // Still strip any prior network-* in case sharing was just disabled.
    return { ...pool, games: pool.games.filter((g) => !g.id.startsWith("network-")) };
  }

  return {
    ...pool,
    games: [...pool.games.filter((g) => !g.id.startsWith("network-")), ...synthetic],
  };
}

// `tournamentsTable` is imported for the schema relation graph; not
// referenced here directly but keeps the import linter happy if drizzle
// types ever need the cross-table inferrence.
void tournamentsTable;
