import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  gamesTable,
  playersTable,
  lineupEntriesTable,
  historicalFieldingTable,
  pitchCountsTable,
} from "@workspace/db";
import { getBattingTotals } from "./batting-totals";
import { isPlayedGame } from "./played-games";

/**
 * Read-only, team-scoped data accessors shared by the season-wide "Ask"
 * assistant (tool-calling loop) and the in-game assistant (inline season
 * context). Every function takes the resolved `ownerUserId` so all data
 * stays inside the calling coach's team — there are NO writes here (the
 * lineup-copy tool only returns a preview link) and no function ever
 * takes a userId from the model. The model only supplies the
 * declared JSON arguments; the executor injects userId server-side.
 */

const POS_TO_GROUP: Record<string, string> = {
  P: "pitcher",
  C: "catcher",
  "1B": "cornerInfield",
  "3B": "cornerInfield",
  "2B": "middleInfield",
  SS: "middleInfield",
  LF: "outfield",
  CF: "outfield",
  RF: "outfield",
};

function posGroupInnings(hist: {
  inningsP: number; inningsC: number; innings1b: number; innings2b: number;
  innings3b: number; inningsSs: number; inningsLf: number; inningsCf: number;
  inningsRf: number; inningsBench: number;
}) {
  return {
    P: hist.inningsP,
    C: hist.inningsC,
    "1B": hist.innings1b,
    "2B": hist.innings2b,
    "3B": hist.innings3b,
    SS: hist.inningsSs,
    LF: hist.inningsLf,
    CF: hist.inningsCf,
    RF: hist.inningsRf,
    Bench: hist.inningsBench,
  };
}

/** Active roster: the pool the coach actually fields. */
export async function getRoster(userId: string) {
  const players = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt)));
  return players
    .filter((p) => p.active)
    .map((p) => ({
      id: p.id,
      name: p.name,
      number: p.number ?? null,
      preferredPositions: p.preferredPositions ?? [],
      canPitch: !!p.canPitch,
    }));
}

/** Games + results. Defaults to actual games (excludes practices/other). */
export async function getGames(
  userId: string,
  opts: { status?: "upcoming" | "completed" | "all"; limit?: number } = {},
) {
  const rows = await db
    .select()
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, userId), isNull(gamesTable.deletedAt)));
  let games = rows.filter((g) => g.type === "game");
  if (opts.status === "upcoming") games = games.filter((g) => g.status === "upcoming");
  else if (opts.status === "completed") games = games.filter((g) => g.status === "completed");
  games.sort((a, b) => b.gameDate.getTime() - a.gameDate.getTime());
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return games.slice(0, limit).map((g) => {
    let result: "W" | "L" | "T" | null = null;
    if (g.status === "completed" && g.ourScore != null && g.opponentScore != null) {
      result = g.ourScore > g.opponentScore ? "W" : g.ourScore < g.opponentScore ? "L" : "T";
    }
    return {
      id: g.id,
      // Local (Central) date/time — a 7 PM game is not "tomorrow" in UTC terms.
      date: g.gameDate.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }),
      time: g.gameDate.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }),
      opponent: g.opponent,
      status: g.status,
      innings: g.innings,
      gameType: g.gameType,
      ourScore: g.ourScore,
      opponentScore: g.opponentScore,
      result,
      isChampionship: g.isChampionship,
      tournamentId: g.tournamentId,
    };
  });
}

/** Season batting totals (manual + per-game lines unioned). */
export async function getSeasonBatting(userId: string) {
  const rows = await getBattingTotals(userId);
  return rows.map((r) => ({
    playerId: r.playerId,
    name: r.playerName,
    ab: r.ab,
    hits: r.hits,
    hr: r.hr,
    rbi: r.rbi,
    bb: r.bb,
    k: r.k,
    sb: r.sb,
    runs: r.runs,
    avg: r.avg,
    obp: r.obp,
    slg: r.slg,
    ops: r.ops,
    gamesRecorded: r.gamesRecorded,
  }));
}

/** Season pitching totals (pitch counts rolled up per pitcher). */
export async function getSeasonPitching(userId: string) {
  const rows = await db
    .select({
      playerId: playersTable.id,
      playerName: playersTable.name,
      playerNumber: playersTable.number,
      totalPitches: sql<number>`coalesce(sum(${pitchCountsTable.pitches}), 0)::int`,
      outings: sql<number>`count(${pitchCountsTable.id})::int`,
      maxOutingPitches: sql<number>`coalesce(max(${pitchCountsTable.pitches}), 0)::int`,
      lastOutingDate: sql<string | null>`max(${gamesTable.gameDate})`,
    })
    .from(playersTable)
    .leftJoin(
      pitchCountsTable,
      and(eq(pitchCountsTable.playerId, playersTable.id), eq(pitchCountsTable.userId, userId)),
    )
    .leftJoin(gamesTable, eq(gamesTable.id, pitchCountsTable.gameId))
    .where(
      and(
        eq(playersTable.userId, userId),
        eq(playersTable.canPitch, true),
        isNull(playersTable.deletedAt),
      ),
    )
    .groupBy(playersTable.id, playersTable.name, playersTable.number)
    .orderBy(sql`coalesce(sum(${pitchCountsTable.pitches}), 0) desc`);
  return rows.map((r) => ({
    playerId: r.playerId,
    name: r.playerName,
    totalPitches: r.totalPitches,
    outings: r.outings,
    avgPerOuting: r.outings > 0 ? Math.round(r.totalPitches / r.outings) : 0,
    maxOutingPitches: r.maxOutingPitches,
    lastOutingDate: r.lastOutingDate,
  }));
}

type RotationRow = {
  playerId: number;
  name: string;
  gamesPlayed: number;
  totalInnings: number;
  benchInnings: number;
  benchRatePct: number;
  groups: Record<string, number>;
};

/**
 * Per-player rotation report: bench rate + innings-by-position-group across
 * COMPLETED games, combined with imported historical fielding — mirroring the
 * "Rotation Report" page (`GET /stats/players`) so the assistant's fairness
 * suggestions line up with what the coach sees there.
 */
export async function getRotationReport(userId: string): Promise<RotationRow[]> {
  const players = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt)));
  if (players.length === 0) return [];
  const playerIds = players.map((p) => p.id);

  const userGames = await db
    .select({
      id: gamesTable.id,
      innings: gamesTable.innings,
      status: gamesTable.status,
      type: gamesTable.type,
      gameDate: gamesTable.gameDate,
    })
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, userId), isNull(gamesTable.deletedAt)));
  const completedGameIdSet = new Set(userGames.filter((g) => isPlayedGame(g)).map((g) => g.id));
  const inningsByGameId = new Map<number, number>(userGames.map((g) => [g.id, g.innings]));

  const entriesRaw = await db
    .select()
    .from(lineupEntriesTable)
    .where(inArray(lineupEntriesTable.playerId, playerIds));
  const allEntries = entriesRaw.filter((e) => completedGameIdSet.has(e.gameId));
  const allHistorical = await db
    .select()
    .from(historicalFieldingTable)
    .where(inArray(historicalFieldingTable.playerId, playerIds));

  return players.map((p) => {
    const playerEntries = allEntries.filter((e) => e.playerId === p.id);
    const gameIds = new Set(playerEntries.map((e) => e.gameId));
    const liveTotal = playerEntries.length;
    const benchInnings = playerEntries.filter((e) => e.position === "Bench").length;
    const positionInnings: Record<string, number> = {};
    for (const e of playerEntries.filter((e) => e.position !== "Bench")) {
      positionInnings[e.position] = (positionInnings[e.position] ?? 0) + 1;
    }
    let unavailableInnings = 0;
    for (const gameId of gameIds) {
      const gi = inningsByGameId.get(gameId);
      if (gi == null) continue;
      const distinct = new Set(playerEntries.filter((e) => e.gameId === gameId).map((e) => e.inning));
      const missing = gi - distinct.size;
      if (missing > 0) unavailableInnings += missing;
    }
    const hist = allHistorical.filter((h) => h.playerId === p.id);
    const histInnings: Record<string, number> = {};
    let histBench = 0;
    let histTotal = 0;
    for (const h of hist) {
      for (const [pos, count] of Object.entries(posGroupInnings(h))) {
        if (pos === "Bench") histBench += count;
        else histInnings[pos] = (histInnings[pos] ?? 0) + count;
        histTotal += count;
      }
    }
    const combinedBench = benchInnings + histBench;
    const combinedTotal = liveTotal + histTotal + unavailableInnings;
    const groups: Record<string, number> = {
      pitcher: 0, catcher: 0, cornerInfield: 0, middleInfield: 0, outfield: 0,
      bench: combinedBench, unavailable: unavailableInnings,
    };
    const combinedPos: Record<string, number> = { ...histInnings };
    for (const [pos, count] of Object.entries(positionInnings)) {
      combinedPos[pos] = (combinedPos[pos] ?? 0) + count;
    }
    for (const [pos, count] of Object.entries(combinedPos)) {
      const g = POS_TO_GROUP[pos];
      if (g && g in groups) groups[g] += count;
    }
    return {
      playerId: p.id,
      name: p.name,
      gamesPlayed: gameIds.size,
      totalInnings: combinedTotal,
      benchInnings: combinedBench,
      benchRatePct: combinedTotal > 0 ? Math.round((combinedBench / combinedTotal) * 100) : 0,
      groups,
    };
  });
}

/**
 * Per-player, per-inning position counts across COMPLETED games — answers
 * questions like "how many times has Dan been on the bench in the 1st inning
 * this season?". `playerName` (case-insensitive substring) narrows to one
 * player; omit it for the whole roster.
 */
export async function getPositionByInning(userId: string, playerName?: string) {
  const players = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt)));
  if (players.length === 0) return { players: [] };
  const needle = playerName?.trim().toLowerCase();
  const matched = needle
    ? players.filter((p) => p.name.toLowerCase().includes(needle))
    : players;
  if (matched.length === 0) {
    return { players: [], note: `No roster player matched "${playerName}".` };
  }
  const matchedIds = matched.map((p) => p.id);

  const userGames = await db
    .select({ id: gamesTable.id, status: gamesTable.status, type: gamesTable.type, gameDate: gamesTable.gameDate })
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, userId), isNull(gamesTable.deletedAt)));
  const completedGameIdSet = new Set(userGames.filter((g) => isPlayedGame(g)).map((g) => g.id));

  const entriesRaw = await db
    .select()
    .from(lineupEntriesTable)
    .where(inArray(lineupEntriesTable.playerId, matchedIds));
  const entries = entriesRaw.filter((e) => completedGameIdSet.has(e.gameId));

  return {
    players: matched.map((p) => {
      const mine = entries.filter((e) => e.playerId === p.id);
      const byInning: Record<string, Record<string, number>> = {};
      for (const e of mine) {
        const key = String(e.inning);
        byInning[key] = byInning[key] ?? {};
        byInning[key][e.position] = (byInning[key][e.position] ?? 0) + 1;
      }
      return { playerId: p.id, name: p.name, byInning };
    }),
  };
}

type CopyParts = "both" | "batting" | "positions";

/**
 * Build a link that opens the target game with the source game's lineup
 * loaded as an UNSAVED preview (game-detail reads ?copyFrom/&copyParts).
 * The coach reviews and taps Save — the assistant itself still writes
 * nothing.
 */
export async function prepareLineupCopy(
  userId: string,
  args: { sourceGameId?: number; targetGameId?: number; parts?: CopyParts },
) {
  const games = await db
    .select({ id: gamesTable.id, opponent: gamesTable.opponent, gameDate: gamesTable.gameDate, type: gamesTable.type })
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, userId), isNull(gamesTable.deletedAt)));
  const byId = new Map(games.map((g) => [g.id, g]));
  const source = args.sourceGameId != null ? byId.get(args.sourceGameId) : undefined;
  const target = args.targetGameId != null ? byId.get(args.targetGameId) : undefined;
  if (!source || !target) return { error: "Couldn't find one of those games. Call get_games for the right ids." };
  if (source.id === target.id) return { error: "Source and target are the same game." };
  const [hasLineup] = await db
    .select({ id: lineupEntriesTable.id })
    .from(lineupEntriesTable)
    .where(eq(lineupEntriesTable.gameId, source.id))
    .limit(1);
  if (!hasLineup) return { error: `The ${source.opponent} game has no saved lineup to copy.` };
  const parts: CopyParts = args.parts ?? "both";
  const label = (g: typeof source) => `vs ${g.opponent} (${g.gameDate.toISOString().slice(0, 10)})`;
  return {
    link: `/games/${target.id}?copyFrom=${source.id}&copyParts=${parts}`,
    source: label(source),
    target: label(target),
    parts,
    note: "Opening the link loads the lineup as a preview on the target game; the coach reviews it and taps Save.",
  };
}

/** OpenAI tool (function) definitions exposed to the season-wide assistant. */
export const ASSISTANT_TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "get_roster",
      description:
        "List the team's active players with jersey number, preferred positions, and whether they can pitch.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_games",
      description:
        "List the team's games with date, opponent, score, and W/L/T result. Use for schedule and results questions.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["upcoming", "completed", "all"],
            description: "Filter by game status. Defaults to all.",
          },
          limit: { type: "number", description: "Max games to return (1-200, default 50)." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_season_batting",
      description:
        "Season batting totals per player (AB, hits, HR, RBI, BB, K, SB, runs, AVG/OBP/SLG/OPS).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_season_pitching",
      description:
        "Season pitching totals per pitcher (total pitches, outings, average and max pitches per outing, last outing date).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_rotation_report",
      description:
        "Per-player fairness/rotation report across completed games: games played, total innings, bench innings, bench rate %, and innings by position group (pitcher/catcher/cornerInfield/middleInfield/outfield/bench/unavailable). Use for playing-time fairness questions.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_position_by_inning",
      description:
        "Per-player, per-inning counts of each position played across completed games. Use to answer questions like 'how many times has Dan been benched in the 1st inning this season?'. position 'Bench' means the player sat that inning.",
      parameters: {
        type: "object",
        properties: {
          playerName: {
            type: "string",
            description: "Case-insensitive name match to narrow to one player. Omit for the whole roster.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "prepare_lineup_copy",
      description:
        "Prepare copying one game's saved lineup onto another game. Returns a link that opens the target game with the copied lineup loaded as a preview for the coach to review and save. Use when the coach asks to reuse / copy / repeat a lineup or batting order from another game. Get game ids from get_games first.",
      parameters: {
        type: "object",
        properties: {
          sourceGameId: { type: "number", description: "Game to copy the lineup FROM." },
          targetGameId: { type: "number", description: "Game to copy the lineup ONTO." },
          parts: {
            type: "string",
            enum: ["both", "batting", "positions"],
            description:
              "'batting' = batting order only (keeps the target's defense), 'positions' = defensive positions only, 'both' = the whole lineup. Default both.",
          },
        },
        required: ["sourceGameId", "targetGameId"],
        additionalProperties: false,
      },
    },
  },
];

/** Execute a tool by name with model-supplied args, injecting userId server-side. */
export async function executeAssistantTool(
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "get_roster":
      return getRoster(userId);
    case "get_games":
      return getGames(userId, {
        status: args.status as "upcoming" | "completed" | "all" | undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
    case "get_season_batting":
      return getSeasonBatting(userId);
    case "get_season_pitching":
      return getSeasonPitching(userId);
    case "get_rotation_report":
      return getRotationReport(userId);
    case "get_position_by_inning":
      return getPositionByInning(
        userId,
        typeof args.playerName === "string" ? args.playerName : undefined,
      );
    case "prepare_lineup_copy":
      return prepareLineupCopy(userId, {
        sourceGameId: typeof args.sourceGameId === "number" ? args.sourceGameId : undefined,
        targetGameId: typeof args.targetGameId === "number" ? args.targetGameId : undefined,
        parts: args.parts === "batting" || args.parts === "positions" ? args.parts : "both",
      });
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
