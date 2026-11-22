// Plus/minus by lineup (Statistics → Lineups, coach-only): from each game's
// court display log, the points for and against while each five-player
// group was on court, how long they played together, and each player's +/-.
// Pure functions, tested in test/basketball-lineups.test.ts.

export interface LogScore {
  kind?: "score";
  team: "us" | "them";
  pts: number;
  at: number;
  on: string[];
}

export interface LogLineup {
  kind: "lineup";
  at: number;
  on: string[];
}

export type LogEvent = LogScore | LogLineup;

export interface GameLog {
  gameId: number;
  /** Game length in seconds (end of the last lineup's time). */
  gameSec: number;
  events: LogEvent[];
}

export interface FiveLine {
  key: string;
  ids: string[];
  seconds: number;
  pointsFor: number;
  pointsAgainst: number;
  plusMinus: number;
  games: number;
}

export interface PlayerPlusMinus {
  id: string;
  plusMinus: number;
  pointsFor: number;
  pointsAgainst: number;
}

const keyOf = (ids: string[]) => [...ids].sort().join(",");

export function lineupStats(games: GameLog[]): { fives: FiveLine[]; players: PlayerPlusMinus[] } {
  const fives = new Map<string, FiveLine & { gameIds: Set<number> }>();
  const players = new Map<string, PlayerPlusMinus>();
  const five = (ids: string[], gameId: number) => {
    const key = keyOf(ids);
    let line = fives.get(key);
    if (!line) {
      line = { key, ids: [...ids].sort(), seconds: 0, pointsFor: 0, pointsAgainst: 0, plusMinus: 0, games: 0, gameIds: new Set() };
      fives.set(key, line);
    }
    line.gameIds.add(gameId);
    return line;
  };
  for (const game of games) {
    const lineups = game.events.filter((e): e is LogLineup => e.kind === "lineup").sort((a, b) => a.at - b.at);
    lineups.forEach((l, i) => {
      if (l.on.length !== 5) return;
      const end = i + 1 < lineups.length ? lineups[i + 1].at : Math.max(l.at, game.gameSec);
      five(l.on, game.gameId).seconds += Math.max(0, end - l.at);
    });
    for (const e of game.events) {
      if (e.kind === "lineup") continue;
      const forUs = e.team === "us" ? e.pts : 0;
      const against = e.team === "them" ? e.pts : 0;
      if (e.on.length === 5) {
        const line = five(e.on, game.gameId);
        line.pointsFor += forUs;
        line.pointsAgainst += against;
      }
      for (const id of e.on) {
        const p = players.get(id) ?? { id, plusMinus: 0, pointsFor: 0, pointsAgainst: 0 };
        p.pointsFor += forUs;
        p.pointsAgainst += against;
        p.plusMinus = p.pointsFor - p.pointsAgainst;
        players.set(id, p);
      }
    }
  }
  return {
    fives: [...fives.values()].map(({ gameIds, ...line }) => ({ ...line, games: gameIds.size, plusMinus: line.pointsFor - line.pointsAgainst })),
    players: [...players.values()],
  };
}
