import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatClock } from "@/lib/basketball-rotation";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SeasonRow { playerId: number; name: string; number: number | null; games: number; starts: number; seconds: number }
interface SeasonResponse { gamesTracked: number; players: SeasonRow[] }

/**
 * Basketball season totals from the court display: games played, starts,
 * total minutes and minutes per game. Shown on the Rotation Report.
 */
export function SeasonCourtTime() {
  const { data, isLoading } = useQuery({
    queryKey: ["basketball-season"],
    queryFn: async (): Promise<SeasonResponse> => {
      const r = await fetch(`${BASE}/api/basketball-season`);
      if (!r.ok) throw new Error(`GET /api/basketball-season failed (${r.status})`);
      return (await r.json()) as SeasonResponse;
    },
  });
  const rows = [...(data?.players ?? [])].sort(
    (a, b) => b.starts - a.starts || b.seconds - a.seconds || a.name.localeCompare(b.name),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Starts &amp; court time</CardTitle>
        <p className="text-sm text-muted-foreground">
          From games run on the court display{data ? ` (${data.gamesTracked} so far)` : ""}. A start counts when a player is on the floor when you tap Start game.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !data || data.gamesTracked === 0 ? (
          <p className="text-sm text-muted-foreground">No games yet. Open a game's Field Display and tap Start game to begin tracking.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-2">Player</th>
                  <th className="px-2 py-2 text-right">Games</th>
                  <th className="px-2 py-2 text-right">Starts</th>
                  <th className="px-2 py-2 text-right">Minutes</th>
                  <th className="py-2 pl-2 text-right">Per game</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.playerId} className="border-b last:border-0">
                    <td className="py-2 pr-2 font-medium">
                      {r.number != null && <span className="mr-1.5 text-muted-foreground">#{r.number}</span>}
                      {r.name}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.games}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{r.starts}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatClock(r.seconds / 60)}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">{r.games ? formatClock(r.seconds / 60 / r.games) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
