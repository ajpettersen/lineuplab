import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  battingStatsTable,
  gameBattingLinesTable,
  playersTable,
} from "@workspace/db";

/**
 * Per-player season-aggregate batting line. Same shape regardless of
 * whether the totals came from a manual `batting_stats` row, summed
 * `game_batting_lines` rows, or both.
 *
 * Rates (avg/obp/slg/ops) are recomputed from the unioned counts —
 * never trusted from the `batting_stats` row's stored rates because
 * those would only describe the manual portion.
 */
export type BattingTotalsRow = {
  playerId: number;
  playerName: string;
  playerNumber: number | null;
  ab: number;
  hits: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  hbp: number;
  sac: number;
  sb: number;
  runs: number;
  /** Number of distinct games rolled into the per-game portion. 0 if only manual stats. */
  gamesRecorded: number;
  /** True if any portion of these totals came from per-game lines (vs only manual). */
  hasPerGameLines: boolean;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  /** Most recent `updatedAt` across all source rows; null if no source rows. */
  updatedAt: Date | null;
};

function recomputeRates(row: {
  ab: number;
  hits: number;
  doubles: number;
  triples: number;
  hr: number;
  bb: number;
  hbp: number;
  sac: number;
}) {
  const pa = row.ab + row.bb + row.hbp + row.sac;
  if (pa === 0 && row.ab === 0) {
    return { avg: null, obp: null, slg: null, ops: null };
  }
  const avg = row.ab > 0 ? row.hits / row.ab : 0;
  const obp = pa > 0 ? (row.hits + row.bb + row.hbp) / pa : 0;
  // Singles = hits − (2B + 3B + HR). Total bases = 1*S + 2*2B + 3*3B + 4*HR.
  const singles = row.hits - row.doubles - row.triples - row.hr;
  const tb = singles + row.doubles * 2 + row.triples * 3 + row.hr * 4;
  const slg = row.ab > 0 ? tb / row.ab : 0;
  return {
    avg: Math.round(avg * 1000) / 1000,
    obp: Math.round(obp * 1000) / 1000,
    slg: Math.round(slg * 1000) / 1000,
    ops: Math.round((obp + slg) * 1000) / 1000,
  };
}

/**
 * Compute the unioned season batting totals for every player owned by
 * this user. Tenant isolation is enforced via the `players.userId`
 * join (manual side) and the denormalized `userId` column on
 * `game_batting_lines` (per-game side).
 *
 * Returns one row per active+inactive player who has any recorded
 * stats. Players with neither manual nor per-game data are omitted —
 * the stats UI is interested in players who have actually batted.
 */
export async function getBattingTotals(userId: string): Promise<BattingTotalsRow[]> {
  // Pull both source tables in parallel. We need every active+inactive
  // player so a recently-deactivated kid still shows in the stats view.
  const [manualRows, perGameAgg, allPlayers] = await Promise.all([
    db
      .select({
        playerId: battingStatsTable.playerId,
        ab: battingStatsTable.ab,
        hits: battingStatsTable.hits,
        doubles: battingStatsTable.doubles,
        triples: battingStatsTable.triples,
        hr: battingStatsTable.hr,
        rbi: battingStatsTable.rbi,
        bb: battingStatsTable.bb,
        k: battingStatsTable.k,
        hbp: battingStatsTable.hbp,
        sac: battingStatsTable.sac,
        sb: battingStatsTable.sb,
        updatedAt: battingStatsTable.updatedAt,
      })
      .from(battingStatsTable)
      .innerJoin(playersTable, eq(battingStatsTable.playerId, playersTable.id))
      .where(eq(playersTable.userId, userId)),
    db
      .select({
        playerId: gameBattingLinesTable.playerId,
        ab: sql<number>`coalesce(sum(${gameBattingLinesTable.ab}), 0)::int`,
        hits: sql<number>`coalesce(sum(${gameBattingLinesTable.hits}), 0)::int`,
        doubles: sql<number>`coalesce(sum(${gameBattingLinesTable.doubles}), 0)::int`,
        triples: sql<number>`coalesce(sum(${gameBattingLinesTable.triples}), 0)::int`,
        hr: sql<number>`coalesce(sum(${gameBattingLinesTable.hr}), 0)::int`,
        rbi: sql<number>`coalesce(sum(${gameBattingLinesTable.rbi}), 0)::int`,
        bb: sql<number>`coalesce(sum(${gameBattingLinesTable.bb}), 0)::int`,
        k: sql<number>`coalesce(sum(${gameBattingLinesTable.k}), 0)::int`,
        hbp: sql<number>`coalesce(sum(${gameBattingLinesTable.hbp}), 0)::int`,
        sac: sql<number>`coalesce(sum(${gameBattingLinesTable.sac}), 0)::int`,
        sb: sql<number>`coalesce(sum(${gameBattingLinesTable.sb}), 0)::int`,
        runs: sql<number>`coalesce(sum(${gameBattingLinesTable.runs}), 0)::int`,
        gamesRecorded: sql<number>`count(distinct ${gameBattingLinesTable.gameId})::int`,
        latestUpdate: sql<Date | null>`max(${gameBattingLinesTable.updatedAt})`,
      })
      .from(gameBattingLinesTable)
      .where(eq(gameBattingLinesTable.userId, userId))
      .groupBy(gameBattingLinesTable.playerId),
    db
      .select({
        id: playersTable.id,
        name: playersTable.name,
        number: playersTable.number,
      })
      .from(playersTable)
      .where(
        and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt)),
      ),
  ]);

  const playerMeta = new Map(allPlayers.map((p) => [p.id, p]));

  // Build a map keyed by playerId, summing manual + per-game contributions.
  type Acc = Omit<BattingTotalsRow, "playerName" | "playerNumber" | "avg" | "obp" | "slg" | "ops">;
  const acc = new Map<number, Acc>();

  function addRow(
    playerId: number,
    src: Partial<Omit<Acc, "playerId" | "gamesRecorded" | "hasPerGameLines" | "updatedAt">> & {
      updatedAt?: Date | null;
      gamesRecorded?: number;
      hasPerGameLines?: boolean;
    },
  ) {
    const cur =
      acc.get(playerId) ??
      ({
        playerId,
        ab: 0,
        hits: 0,
        doubles: 0,
        triples: 0,
        hr: 0,
        rbi: 0,
        bb: 0,
        k: 0,
        hbp: 0,
        sac: 0,
        sb: 0,
        runs: 0,
        gamesRecorded: 0,
        hasPerGameLines: false,
        updatedAt: null,
      } as Acc);
    cur.ab += src.ab ?? 0;
    cur.hits += src.hits ?? 0;
    cur.doubles += src.doubles ?? 0;
    cur.triples += src.triples ?? 0;
    cur.hr += src.hr ?? 0;
    cur.rbi += src.rbi ?? 0;
    cur.bb += src.bb ?? 0;
    cur.k += src.k ?? 0;
    cur.hbp += src.hbp ?? 0;
    cur.sac += src.sac ?? 0;
    cur.sb += src.sb ?? 0;
    cur.runs += src.runs ?? 0;
    cur.gamesRecorded += src.gamesRecorded ?? 0;
    cur.hasPerGameLines = cur.hasPerGameLines || (src.hasPerGameLines ?? false);
    if (src.updatedAt) {
      // Drizzle returns timestamp columns as Date for typed fields
      // (manual `batting_stats.updatedAt`) but as a raw ISO string
      // for the per-game aggregate (`max(updatedAt)` via raw sql)
      // — coerce both sides before comparing so we don't crash the
      // whole endpoint on `string.getTime is not a function`.
      const incoming =
        src.updatedAt instanceof Date ? src.updatedAt : new Date(src.updatedAt);
      const current =
        cur.updatedAt == null
          ? null
          : cur.updatedAt instanceof Date
          ? cur.updatedAt
          : new Date(cur.updatedAt);
      if (!current || incoming.getTime() > current.getTime()) {
        cur.updatedAt = incoming;
      }
    }
    acc.set(playerId, cur);
  }

  for (const r of manualRows) addRow(r.playerId, r);
  for (const r of perGameAgg) {
    addRow(r.playerId, {
      ...r,
      hasPerGameLines: true,
      updatedAt: r.latestUpdate ?? null,
    });
  }

  const out: BattingTotalsRow[] = [];
  for (const [playerId, totals] of acc) {
    const meta = playerMeta.get(playerId);
    if (!meta) continue; // player was deleted between the queries; skip
    const rates = recomputeRates(totals);
    out.push({
      ...totals,
      playerName: meta.name,
      playerNumber: meta.number,
      ...rates,
    });
  }
  out.sort((a, b) => a.playerId - b.playerId);
  return out;
}

/**
 * Same totals scoped to a specific player subset. Used by the lineup
 * generator (it only cares about players currently in the available
 * pool).
 */
export async function getBattingTotalsForPlayers(
  userId: string,
  playerIds: number[],
): Promise<Map<number, BattingTotalsRow>> {
  if (playerIds.length === 0) return new Map();
  const all = await getBattingTotals(userId);
  const wanted = new Set(playerIds);
  const out = new Map<number, BattingTotalsRow>();
  for (const r of all) if (wanted.has(r.playerId)) out.set(r.playerId, r);
  // Fill in zero-row entries for requested players without recorded
  // stats so the caller can iterate playerIds without checking for
  // undefined — keeps the lineup-generator math simpler.
  for (const id of playerIds) {
    if (!out.has(id)) {
      out.set(id, {
        playerId: id,
        playerName: "",
        playerNumber: null,
        ab: 0,
        hits: 0,
        doubles: 0,
        triples: 0,
        hr: 0,
        rbi: 0,
        bb: 0,
        k: 0,
        hbp: 0,
        sac: 0,
        sb: 0,
        runs: 0,
        gamesRecorded: 0,
        hasPerGameLines: false,
        avg: null,
        obp: null,
        slg: null,
        ops: null,
        updatedAt: null,
      });
    }
  }
  return out;
}

/**
 * Fetch the per-game batting lines for a single game so the import
 * dialog can show "this game already has stats" + populate edits.
 */
export async function getBattingLinesForGame(userId: string, gameId: number) {
  return db
    .select()
    .from(gameBattingLinesTable)
    .where(
      and(
        eq(gameBattingLinesTable.userId, userId),
        eq(gameBattingLinesTable.gameId, gameId),
      ),
    )
    .orderBy(gameBattingLinesTable.playerId);
}

/**
 * Replace ALL batting lines for a given game with the supplied rows.
 * Idempotent — re-importing the same box score never duplicates.
 *
 * Caller is responsible for verifying the game belongs to `userId`
 * and that every `playerId` is owned by the same user.
 */
type BattingLineInput = {
  playerId: number;
  ab?: number;
  hits?: number;
  doubles?: number;
  triples?: number;
  hr?: number;
  rbi?: number;
  bb?: number;
  k?: number;
  hbp?: number;
  sac?: number;
  sb?: number;
  runs?: number;
};

/**
 * Tx-aware variant — caller supplies the transaction handle so the
 * batting wipe/insert can share atomicity with sibling writes
 * (pitch counts, game header). Use this from `POST /box-score` so
 * the whole save is a single transaction.
 */
// Drizzle's tx handle is structurally compatible with `db` for the
// CRUD operations we use here, but TS can't prove the relationship
// between PgTransaction and NodePgDatabase. Accept either via a
// minimal structural interface so callers don't need an unsafe cast.
type DbOrTx = Pick<typeof db, "insert" | "delete" | "update" | "select">;

export async function replaceBattingLinesForGameTx(
  tx: DbOrTx,
  userId: string,
  gameId: number,
  lines: Array<BattingLineInput>,
  sourceNote?: string,
): Promise<void> {
  await tx
    .delete(gameBattingLinesTable)
    .where(
      and(
        eq(gameBattingLinesTable.userId, userId),
        eq(gameBattingLinesTable.gameId, gameId),
      ),
    );
  if (lines.length === 0) return;
  const dedup = new Map<number, BattingLineInput>();
  for (const l of lines) {
    const prev = dedup.get(l.playerId);
    if (!prev || (l.ab ?? 0) > (prev.ab ?? 0)) dedup.set(l.playerId, l);
  }
  await tx.insert(gameBattingLinesTable).values(
    Array.from(dedup.values()).map((l) => ({
      userId,
      gameId,
      playerId: l.playerId,
      ab: l.ab ?? 0,
      hits: l.hits ?? 0,
      doubles: l.doubles ?? 0,
      triples: l.triples ?? 0,
      hr: l.hr ?? 0,
      rbi: l.rbi ?? 0,
      bb: l.bb ?? 0,
      k: l.k ?? 0,
      hbp: l.hbp ?? 0,
      sac: l.sac ?? 0,
      sb: l.sb ?? 0,
      runs: l.runs ?? 0,
      sourceNote: sourceNote ?? null,
    })),
  );
}

export async function replaceBattingLinesForGame(
  userId: string,
  gameId: number,
  lines: Array<BattingLineInput>,
  sourceNote?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await replaceBattingLinesForGameTx(tx, userId, gameId, lines, sourceNote);
  });
}

export async function deleteBattingLinesForGame(
  userId: string,
  gameId: number,
): Promise<void> {
  await db
    .delete(gameBattingLinesTable)
    .where(
      and(
        eq(gameBattingLinesTable.userId, userId),
        eq(gameBattingLinesTable.gameId, gameId),
      ),
    );
}

// Helper used by routes to confirm a list of playerIds is fully owned.
export async function filterToOwnedActivePlayerIds(
  userId: string,
  playerIds: number[],
): Promise<Set<number>> {
  if (playerIds.length === 0) return new Set();
  const rows = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(
      and(
        eq(playersTable.userId, userId),
        inArray(playersTable.id, playerIds),
        isNull(playersTable.deletedAt),
      ),
    );
  return new Set(rows.map((r) => r.id));
}
