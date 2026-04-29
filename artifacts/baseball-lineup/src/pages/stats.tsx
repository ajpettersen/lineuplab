import { useGetSeasonStats, useGetPlayerStats, useListPlayers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const POSITION_ORDER = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const CHART_COLORS = [
  "#1e6b3c", "#1e3a6b", "#c0392b", "#e67e22",
  "#16a085", "#8e44ad", "#2980b9", "#27ae60", "#d35400",
];

function FairnessBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-muted-foreground">Fairness Score</span>
        <span className={`text-2xl font-bold ${score >= 80 ? "text-green-700" : score >= 60 ? "text-yellow-600" : "text-red-600"}`}>
          {score}/100
        </span>
      </div>
      <div className="w-full bg-muted rounded-full h-3">
        <div className={`h-3 rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">
        {score >= 80 ? "Excellent — playing time is very equitable" :
         score >= 60 ? "Good — minor imbalances in bench time" :
         "Needs attention — significant playing time differences exist"}
      </p>
    </div>
  );
}

export default function Stats() {
  const { data: seasonStats } = useGetSeasonStats();
  const { data: playerStats = [] } = useGetPlayerStats();
  const { data: players = [] } = useListPlayers();

  const positionData = POSITION_ORDER.map((pos) => ({
    position: pos,
    innings: seasonStats?.positionDistribution?.[pos] ?? 0,
  }));

  const benchData = playerStats
    .filter((p) => p.totalInnings > 0)
    .map((p) => ({
      name: p.playerName.split(" ")[0],
      fullName: p.playerName,
      bench: p.benchInnings,
      field: p.totalInnings - p.benchInnings,
    }))
    .sort((a, b) => b.bench - a.bench);

  const playerPositionData = playerStats
    .filter((p) => p.totalInnings > 0)
    .map((p) => ({
      name: p.playerName.split(" ")[0],
      ...Object.fromEntries(
        POSITION_ORDER.map((pos) => [pos, p.positionInnings[pos] ?? 0])
      ),
    }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Season Stats</h1>
        <p className="text-muted-foreground mt-1">Playing time and position fairness across the season</p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="text-3xl font-bold">{seasonStats?.totalGames ?? 0}</div>
            <div className="text-sm text-muted-foreground mt-0.5">Total Games</div>
            <div className="text-xs text-muted-foreground">{seasonStats?.completedGames ?? 0} completed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-3xl font-bold">{seasonStats?.totalInnings ?? 0}</div>
            <div className="text-sm text-muted-foreground mt-0.5">Total Field Innings</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <FairnessBar score={seasonStats?.fairnessScore ?? 0} />
          </CardContent>
        </Card>
      </div>

      {/* Position Distribution */}
      {seasonStats && seasonStats.totalInnings > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team Position Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={positionData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="position" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  formatter={(v: number) => [`${v} innings`, "Innings"]}
                />
                <Bar dataKey="innings" radius={[4, 4, 0, 0]}>
                  {positionData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Bench Time by Player */}
      {benchData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bench Innings by Player</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(200, benchData.length * 35)}>
              <BarChart
                data={benchData}
                layout="vertical"
                margin={{ top: 5, right: 10, left: 40, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={60} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  formatter={(v: number) => [`${v} innings`]}
                />
                <Bar dataKey="bench" name="Bench" fill="#e67e22" radius={[0, 4, 4, 0]} />
                <Bar dataKey="field" name="Field" fill="#1e6b3c" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground mt-2">Orange = bench innings, Green = field innings</p>
          </CardContent>
        </Card>
      )}

      {/* Per-Player Table */}
      {playerStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Player Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Player</th>
                    <th className="text-center py-2 px-2 font-medium text-muted-foreground">Games</th>
                    <th className="text-center py-2 px-2 font-medium text-muted-foreground">Field Inn.</th>
                    <th className="text-center py-2 px-2 font-medium text-muted-foreground">Bench</th>
                    <th className="text-center py-2 px-2 font-medium text-muted-foreground">Pitched</th>
                    <th className="text-left py-2 pl-4 font-medium text-muted-foreground">Top Positions</th>
                  </tr>
                </thead>
                <tbody>
                  {playerStats
                    .sort((a, b) => b.totalInnings - a.totalInnings)
                    .map((p) => {
                      const topPositions = Object.entries(p.positionInnings)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3);
                      const benchPct = p.totalInnings > 0
                        ? Math.round((p.benchInnings / p.totalInnings) * 100)
                        : 0;
                      return (
                        <tr key={p.playerId} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2.5 pr-4">
                            <div className="font-medium">{p.playerName}</div>
                            {p.playerNumber != null && (
                              <div className="text-xs text-muted-foreground font-mono">#{p.playerNumber}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-center">{p.gamesPlayed}</td>
                          <td className="py-2.5 px-2 text-center">{p.totalInnings - p.benchInnings}</td>
                          <td className="py-2.5 px-2 text-center">
                            <span className={`${benchPct > 30 ? "text-yellow-600 font-medium" : ""}`}>
                              {p.benchInnings}
                              {benchPct > 0 && <span className="text-xs text-muted-foreground ml-1">({benchPct}%)</span>}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-center">{p.inningsPitched || "—"}</td>
                          <td className="py-2.5 pl-4">
                            <div className="flex gap-1 flex-wrap">
                              {topPositions.map(([pos, count]) => (
                                <Badge key={pos} variant="secondary" className="text-xs px-1.5 py-0">
                                  {pos} ({count})
                                </Badge>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {playerStats.length === 0 && (
        <Card className="py-12">
          <CardContent className="text-center text-muted-foreground">
            <p>No game data yet. Generate and save lineups to see stats here.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
