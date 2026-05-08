import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListPlayers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BattingTab } from "@/components/batting-tab";
import { PlayerGameLogDialog } from "@/components/player-game-log-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PitchingRow {
  playerId: number;
  playerName: string;
  playerNumber: number | null;
  totalPitches: number;
  outings: number;
  avgPerOuting: number;
  maxOutingPitches: number;
  lastOutingDate: string | null;
}

function usePitchingStats() {
  return useQuery({
    queryKey: ["pitching-stats"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/pitching`);
      return r.json() as Promise<PitchingRow[]>;
    },
  });
}

function PitchingTab() {
  const { data: rows = [], isLoading } = usePitchingStats();
  const withOutings = rows.filter((r) => r.outings > 0);
  // Same click-through as BattingTab — clicking a pitcher's name opens
  // their per-game log (batting + pitching combined).
  const [logPlayerId, setLogPlayerId] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Per-pitcher totals from saved game pitch counts. Use this to balance workloads and watch for arms approaching weekly limits.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Pitching Stats</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : withOutings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recorded outings yet. Pitch counts logged on games (or imported via box scores) will roll up here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Pitcher</th>
                    <th className="text-center px-2 font-medium text-muted-foreground">Outings</th>
                    <th className="text-center px-2 font-medium text-muted-foreground">Total Pitches</th>
                    <th className="text-center px-2 font-medium text-muted-foreground">Avg / Outing</th>
                    <th className="text-center px-2 font-medium text-muted-foreground">Max Outing</th>
                    <th className="text-center px-2 font-medium text-muted-foreground">Last Outing</th>
                  </tr>
                </thead>
                <tbody>
                  {withOutings.map((r) => (
                    <tr key={r.playerId} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2.5 pr-4">
                        <button
                          type="button"
                          onClick={() => setLogPlayerId(r.playerId)}
                          className="font-medium text-left hover:underline focus:underline focus:outline-none"
                          title="View game log"
                        >
                          {r.playerName}
                        </button>
                        {r.playerNumber != null && (
                          <div className="text-xs text-muted-foreground">#{r.playerNumber}</div>
                        )}
                      </td>
                      <td className="text-center px-2 font-mono">{r.outings}</td>
                      <td className="text-center px-2 font-mono font-medium">{r.totalPitches}</td>
                      <td className="text-center px-2 font-mono">{r.avgPerOuting}</td>
                      <td className="text-center px-2 font-mono">{r.maxOutingPitches}</td>
                      <td className="text-center px-2 text-xs text-muted-foreground">
                        {r.lastOutingDate
                          ? new Date(r.lastOutingDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <PlayerGameLogDialog
        playerId={logPlayerId}
        open={logPlayerId != null}
        onOpenChange={(v) => !v && setLogPlayerId(null)}
      />
    </div>
  );
}

export default function SeasonStats() {
  const { data: players = [] } = useListPlayers();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="eyebrow text-primary/70">Season Analytics</div>
        <h1 className="page-title text-foreground mt-1">Season Statistics</h1>
        <p className="text-muted-foreground mt-2 text-sm">Batting and pitching performance across the season.</p>
      </div>

      <Tabs defaultValue="batting">
        <TabsList>
          <TabsTrigger value="batting">Batting</TabsTrigger>
          <TabsTrigger value="pitching">Pitching</TabsTrigger>
        </TabsList>

        <TabsContent value="batting" className="mt-4">
          <BattingTab players={players.map((p) => ({ id: p.id, name: p.name, number: p.number ?? null }))} />
        </TabsContent>

        <TabsContent value="pitching" className="mt-4">
          <PitchingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
