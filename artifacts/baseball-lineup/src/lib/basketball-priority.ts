// Season priority for the planners (Set Lineup and the Bench Sheet): players
// behind on season minutes or starts go to the front of their group's
// starting order. The front of a queue starts and, when shifts don't divide
// evenly, gets the extra shift, so this hands the extra time and the starts
// to whoever is behind, without changing the rotation's own rules.
//
// Pure functions, tested in test/basketball-priority.test.ts.

export interface SeasonStanding {
  /** Seconds played in games they were available for. */
  seconds: number;
  availableGames: number;
  starts: number;
}

export interface PlannedPlayer {
  id: string;
  name: string;
}

/** Per available game: how far each player is behind the team (positive = behind). */
export function seasonGaps(ids: string[], season: Map<string, SeasonStanding>) {
  const withGames = ids.filter((id) => (season.get(id)?.availableGames ?? 0) > 0);
  const rate = (id: string) => season.get(id)!.seconds / season.get(id)!.availableGames;
  const startRate = (id: string) => season.get(id)!.starts / season.get(id)!.availableGames;
  const avgRate = withGames.length ? withGames.reduce((s, id) => s + rate(id), 0) / withGames.length : 0;
  const avgStarts = withGames.length ? withGames.reduce((s, id) => s + startRate(id), 0) / withGames.length : 0;
  return new Map(
    ids.map((id) => {
      const line = season.get(id);
      if (!line || line.availableGames === 0) return [id, { minutesSec: 0, starts: 0 }];
      return [id, { minutesSec: avgRate - rate(id), starts: (avgStarts - startRate(id)) * line.availableGames }];
    }),
  );
}

/**
 * Reorder each group's starting order so whoever is most behind gets the
 * places in the queue that play the most this game (and, among equal ones,
 * the places that start). Which places those are depends on the settings,
 * so the caller passes `positionMinutes[group][place]` from a rotation built
 * with the current order (see positionMinutes); `starters[group]` = how many
 * at the front of that queue start. Without them the front is assumed best.
 */
export function prioritizeGroups(
  groups: string[][],
  season: Map<string, SeasonStanding>,
  positionMinutes: number[][] | null = null,
  starters: number[] | null = null,
): string[][] {
  const gaps = seasonGaps(groups.flat(), season);
  return groups.map((ids, g) => {
    const players = ids
      .map((id, i) => ({ id, i }))
      .sort((a, b) => {
        const ga = gaps.get(a.id)!;
        const gb = gaps.get(b.id)!;
        return Math.round(gb.minutesSec / 30) - Math.round(ga.minutesSec / 30) || gb.starts - ga.starts || a.i - b.i;
      });
    const value = positionMinutes?.[g];
    const startCount = starters?.[g] ?? 0;
    const places = ids
      .map((_, place) => place)
      .sort((a, b) => (value ? (value[b] ?? 0) - (value[a] ?? 0) : 0) || Number(b < startCount) - Number(a < startCount) || a - b);
    const out: string[] = new Array(ids.length);
    places.forEach((place, k) => {
      out[place] = players[k].id;
    });
    return out;
  });
}

/** Planned seconds for each place in each group's queue, from a rotation's minutes. */
export function positionMinutes(groups: string[][], minutesById: Map<string, number>): number[][] {
  return groups.map((ids) => ids.map((id) => minutesById.get(id) ?? 0));
}

/**
 * Short "why" notes for a planned game: who gets an extra shift or a start
 * because they're behind. `plannedSec` = this game's planned minutes.
 */
export function priorityNotes(
  players: PlannedPlayer[],
  plannedSec: Map<string, number>,
  starters: string[],
  season: Map<string, SeasonStanding>,
  shiftSec: number,
  /** Position groups (ids), so extra time is measured against the same group. */
  groups: string[][] = [players.map((p) => p.id)],
): Map<string, string> {
  const gaps = seasonGaps(players.map((p) => p.id), season);
  // Compared with the average planned time in their own group this game.
  const baseOf = new Map<string, number>();
  for (const ids of groups) {
    const here = ids.filter((id) => players.some((p) => p.id === id));
    const avg = here.length ? here.reduce((sum, id) => sum + (plannedSec.get(id) ?? 0), 0) / here.length : 0;
    for (const id of here) baseOf.set(id, avg);
  }
  const notes = new Map<string, string>();
  for (const p of players) {
    const gap = gaps.get(p.id)!;
    const parts: string[] = [];
    const base = baseOf.get(p.id) ?? 0;
    const extra = shiftSec > 0 ? Math.max(0, Math.ceil(((plannedSec.get(p.id) ?? 0) - base) / shiftSec - 0.25)) : 0;
    if (extra > 0 && gap.minutesSec >= 30) {
      parts.push(`+${extra} shift${extra === 1 ? "" : "s"}: ${Math.round(gap.minutesSec / 60)} min a game behind the season average`);
    }
    if (starters.includes(p.id) && gap.starts >= 0.5) {
      parts.push(`starts: ${Math.round(gap.starts)} fewer start${Math.round(gap.starts) === 1 ? "" : "s"} than average`);
    }
    if (parts.length) notes.set(p.id, parts.join("; "));
  }
  return notes;
}
