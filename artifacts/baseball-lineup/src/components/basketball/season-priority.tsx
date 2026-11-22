import { useMemo } from "react";
import { Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildRotation, groupedQueues, type BasketballPlayer, type BasketballSettings } from "@/lib/basketball-rotation";
import { positionMinutes, priorityNotes, prioritizeGroups, type SeasonStanding } from "@/lib/basketball-priority";
import { useBasketballSeason } from "@/lib/basketball-season";

/**
 * Season priority for a planned game (Set Lineup, Bench Sheet): a button
 * that reorders each group so whoever is behind on season minutes or starts
 * gets the places that play most and start, plus short "why" notes for the
 * current order.
 */
export function useSeasonPriority(players: BasketballPlayer[], settings: BasketballSettings | null, order: string[], absentIds: string[]) {
  const { data: season } = useBasketballSeason();
  const standings = useMemo(() => {
    if (!season || season.gamesTracked === 0) return null;
    return new Map<string, SeasonStanding>(
      season.players.map((p) => [String(p.playerId), { seconds: p.seconds, availableGames: p.availableGames, starts: p.starts }]),
    );
  }, [season]);

  const prioritize = (): string[] | null => {
    if (!standings || !settings) return null;
    const queues = groupedQueues(players, settings, order, absentIds);
    const ids = queues.map((q) => q.players.map((p) => p.id));
    const trial = buildRotation({ players, settings, order, absentIds });
    const value = positionMinutes(ids, new Map(trial.minutes.map((m) => [m.id, m.minutes])));
    const next = prioritizeGroups(ids, standings, value, queues.map((q) => q.group.spots.length));
    const flat = next.flat();
    return [...flat, ...order.filter((id) => !flat.includes(id))];
  };

  const notes = useMemo(() => {
    if (!standings || !settings || players.length === 0) return [];
    const r = buildRotation({ players, settings, order, absentIds });
    const first = r.halves[0]?.rows[0];
    if (!first) return [];
    const absent = new Set(absentIds);
    const here = players.filter((p) => !absent.has(p.id));
    const planned = new Map(r.minutes.map((m) => [m.id, m.minutes * 60]));
    const starters = first.groups.flatMap((g) => g.ids);
    const groups = groupedQueues(players, settings, order, absentIds).map((q) => q.players.map((p) => p.id));
    const map = priorityNotes(here, planned, starters, standings, settings.shiftMinutes * 60, groups);
    return here.filter((p) => map.has(p.id)).map((p) => ({ name: p.name, note: map.get(p.id)! }));
  }, [standings, players, settings, order, absentIds]);

  return { ready: !!standings && !!settings, prioritize, notes };
}

export function SeasonPriorityButton({ ready, onClick, label = "Prioritize who's behind" }: { ready: boolean; onClick: () => void; label?: string }) {
  if (!ready) return null;
  return (
    <Button type="button" variant="outline" size="sm" className="gap-1" onClick={onClick} title="Give the starts and the extra time to whoever is behind on season minutes or starts">
      <Scale className="h-4 w-4" /> {label}
    </Button>
  );
}

export function SeasonPriorityNotes({ notes }: { notes: { name: string; note: string }[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 rounded-md bg-muted/50 px-3 py-2 text-xs">
      {notes.map((n) => (
        <li key={n.name}>
          <span className="font-semibold">{n.name}</span>: {n.note}
        </li>
      ))}
    </ul>
  );
}
