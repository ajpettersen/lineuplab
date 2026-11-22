import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { lineupStats, type FiveLine, type GameLog } from "@/lib/basketball-lineups";
import { fmtMinutes } from "@/lib/basketball-season";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LineupsResponse {
  games: (GameLog & { date: string; opponent: string })[];
  players: { id: string; name: string }[];
}

type SortKey = "plusMinus" | "seconds" | "pointsFor" | "pointsAgainst" | "games";
const COLS: { key: SortKey; label: string }[] = [
  { key: "plusMinus", label: "+/-" },
  { key: "seconds", label: "Minutes" },
  { key: "pointsFor", label: "PF" },
  { key: "pointsAgainst", label: "PA" },
  { key: "games", label: "Games" },
];
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Statistics → Lineups (coaches only): plus/minus, minutes together and
 * points for/against for each five-player group, and each player's +/-,
 * for the season or one game. From the score buttons on the court display.
 */
export function LineupStats() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["basketball-lineups"],
    queryFn: async (): Promise<LineupsResponse> => {
      const r = await fetch(`${BASE}/api/basketball-lineups`);
      if (!r.ok) throw new Error(`GET /api/basketball-lineups failed (${r.status})`);
      const body = (await r.json()) as Partial<LineupsResponse>;
      return { games: body.games ?? [], players: body.players ?? [] };
    },
  });
  const [gameId, setGameId] = useState<number | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "plusMinus", desc: true });
  const [minMinutes, setMinMinutes] = useState(1);
  const games = data?.games ?? [];
  const nameOf = (id: string) => data?.players.find((p) => p.id === id)?.name.split(" ")[0] ?? "?";
  const stats = useMemo(() => lineupStats(gameId === "all" ? games : games.filter((g) => g.gameId === gameId)), [games, gameId]);
  const fives = stats.fives
    .filter((f) => f.seconds >= minMinutes * 60 || f.pointsFor + f.pointsAgainst > 0)
    .sort((a, b) => (sort.desc ? -1 : 1) * ((a[sort.key] as number) - (b[sort.key] as number)) || b.seconds - a.seconds);
  const players = [...stats.players].sort((a, b) => b.plusMinus - a.plusMinus);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lineups (coaches only)</CardTitle>
        <p className="text-sm text-muted-foreground">
          Plus/minus while each five was on court, from the score buttons on the court display. Tap a column to sort.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-muted-foreground">Lineup stats are for coaches.</p>
        ) : games.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scored games yet. Use the +1/+2/+3 buttons on the court display and lineup stats fill in here.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Show</span>
                <select
                  className="h-9 rounded-md border bg-background px-2"
                  value={gameId}
                  onChange={(e) => setGameId(e.target.value === "all" ? "all" : Number(e.target.value))}
                >
                  <option value="all">Full season ({games.length} games)</option>
                  {games.map((g) => (
                    <option key={g.gameId} value={g.gameId}>
                      {format(new Date(g.date), "MMM d")} vs. {g.opponent}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">At least</span>
                <select className="h-9 rounded-md border bg-background px-2" value={minMinutes} onChange={(e) => setMinMinutes(Number(e.target.value))}>
                  {[0, 1, 2, 4, 6].map((n) => <option key={n} value={n}>{n} min together</option>)}
                </select>
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-2 text-left">Five</th>
                    {COLS.map((c) => (
                      <th key={c.key} className="px-2 py-2 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 font-semibold uppercase hover:text-foreground"
                          onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}
                        >
                          {c.label}
                          {sort.key === c.key && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fives.slice(0, 25).map((f: FiveLine) => (
                    <tr key={f.key} className="border-b last:border-0">
                      <td className="py-1.5 pr-2">{f.ids.map(nameOf).sort().join(", ")}</td>
                      <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${f.plusMinus > 0 ? "text-green-700 dark:text-green-400" : f.plusMinus < 0 ? "text-red-700 dark:text-red-400" : ""}`}>
                        {signed(f.plusMinus)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtMinutes(f.seconds)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{f.pointsFor}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{f.pointsAgainst}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{f.games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fives.length > 25 && <p className="mt-1 text-xs text-muted-foreground">Showing the top 25 of {fives.length} groups.</p>}
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Player +/-</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                {players.map((p) => (
                  <div key={p.id} className="flex justify-between gap-2">
                    <span className="truncate">{data?.players.find((x) => x.id === p.id)?.name ?? "?"}</span>
                    <span className={`font-bold tabular-nums ${p.plusMinus > 0 ? "text-green-700 dark:text-green-400" : p.plusMinus < 0 ? "text-red-700 dark:text-red-400" : ""}`}>
                      {signed(p.plusMinus)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
