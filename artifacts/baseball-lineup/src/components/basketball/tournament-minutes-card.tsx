import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

interface Line {
  playerId: number;
  name: string;
  games: number;
  starts: number;
  seconds: number;
}

/**
 * Basketball tournaments: playing time and starts across the tournament's
 * games, so the coach can see who is behind going into the next one.
 */
export function TournamentMinutesCard({ gameIds }: { gameIds: number[] }) {
  const key = [...gameIds].sort((a, b) => a - b).join(",");
  const { data, isLoading } = useQuery({
    queryKey: ["basketball-season", "games", key],
    enabled: gameIds.length > 0,
    queryFn: async (): Promise<{ gamesTracked: number; players: Line[] }> => {
      const r = await fetch(`${BASE}/api/basketball-season?gameIds=${key}`);
      if (!r.ok) throw new Error(`GET /api/basketball-season failed (${r.status})`);
      return r.json();
    },
  });
  const rows = (data?.players ?? []).filter((p) => p.games > 0 || p.seconds > 0).sort((a, b) => b.seconds - a.seconds);
  const played = rows.filter((p) => p.games > 0);
  const avg = played.length ? played.reduce((s, p) => s + p.seconds / p.games, 0) / played.length : 0;

  return (
    <Card data-testid="card-tournament-minutes">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" /> Playing time this tournament</CardTitle>
        <p className="text-xs text-muted-foreground">
          From the court display (or minutes you've loaded) for this tournament's games.
          {data ? ` ${data.gamesTracked} of ${gameIds.length} game${gameIds.length === 1 ? "" : "s"} tracked.` : ""}
        </p>
      </CardHeader>
      <CardContent>
        {gameIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">Link this tournament's games to see playing time here.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No playing time yet. It fills in as you run games on the court display.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-1.5 text-left font-semibold">Player</th>
                <th className="py-1.5 text-right font-semibold">Games</th>
                <th className="py-1.5 text-right font-semibold">Starts</th>
                <th className="py-1.5 text-right font-semibold">Minutes</th>
                <th className="py-1.5 text-right font-semibold">Per game</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const perGame = p.games ? p.seconds / p.games : 0;
                const behind = p.games > 0 && avg - perGame > 60;
                return (
                  <tr key={p.playerId} className="border-b last:border-0">
                    <td className="py-1.5 font-semibold">{p.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.games}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.starts}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{fmt(p.seconds)}</td>
                    <td className={`py-1.5 text-right font-mono tabular-nums ${behind ? "font-bold text-amber-700 dark:text-amber-300" : ""}`}>
                      {fmt(perGame)}
                      {behind && <span className="ml-1 text-[11px] font-sans">behind</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
