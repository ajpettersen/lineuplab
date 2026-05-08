import { useState } from "react";
import { Pencil, FileText } from "lucide-react";
import {
  useGetBoxScore,
  useListPlayers,
  getGetBoxScoreQueryKey,
  type BattingLine,
  type PitchingLine,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayerGameLogDialog } from "@/components/player-game-log-dialog";
import { usePermission } from "@/hooks/use-permission";

interface Props {
  gameId: number;
  onEdit?: () => void;
}

function fmtAvg(n: number | null): string {
  if (n == null || !isFinite(n)) return "—";
  const s = n.toFixed(3);
  return s.startsWith("0") ? s.slice(1) : s;
}

function gameAvg(b: BattingLine): number | null {
  return b.ab > 0 ? b.hits / b.ab : null;
}

export function BoxScoreDisplayCard({ gameId, onEdit }: Props) {
  const { data: state, isLoading } = useGetBoxScore(gameId, {
    query: { queryKey: getGetBoxScoreQueryKey(gameId) },
  });
  const { data: players = [] } = useListPlayers();
  const { can } = usePermission();
  const canEdit = can("partial");
  const [logPlayerId, setLogPlayerId] = useState<number | null>(null);

  if (isLoading || !state || !state.importedAt) return null;

  const batting = (state.batting ?? []) as BattingLine[];
  const pitching = (state.pitching ?? []) as PitchingLine[];
  if (batting.length === 0 && pitching.length === 0) return null;

  const playerById = new Map(
    players.map((p) => [p.id, { name: p.name, number: p.number ?? null }]),
  );

  const sortedBatting = [...batting].sort((a, b) => {
    const an = playerById.get(a.playerId)?.name ?? a.playerName ?? "";
    const bn = playerById.get(b.playerId)?.name ?? b.playerName ?? "";
    return an.localeCompare(bn);
  });

  const sortedPitching = [...pitching].sort((a, b) => b.pitches - a.pitches);

  const totals = batting.reduce(
    (acc, b) => ({
      ab: acc.ab + b.ab,
      runs: acc.runs + b.runs,
      hits: acc.hits + b.hits,
      doubles: acc.doubles + b.doubles,
      triples: acc.triples + b.triples,
      hr: acc.hr + b.hr,
      rbi: acc.rbi + b.rbi,
      bb: acc.bb + b.bb,
      k: acc.k + b.k,
    }),
    { ab: 0, runs: 0, hits: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, k: 0 },
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-primary" />
              Box Score
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Imported{" "}
              {state.importedAt
                ? new Date(state.importedAt).toLocaleDateString()
                : ""}
              {state.ourScore != null && state.opponentScore != null && (
                <>
                  {" · Final "}
                  <span className="font-mono font-semibold text-foreground">
                    {state.ourScore} – {state.opponentScore}
                  </span>
                </>
              )}
            </p>
          </div>
          {canEdit && onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 flex flex-col gap-5">
        {sortedBatting.length > 0 && (
          <div>
            <div className="eyebrow text-primary/70 mb-2">Batting</div>
            <div className="overflow-x-auto -mx-2 sm:mx-0">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 pl-2 pr-3 font-semibold">Player</th>
                    {(["AB", "R", "H", "2B", "3B", "HR", "RBI", "BB", "K", "AVG"] as const).map(
                      (h) => (
                        <th
                          key={h}
                          className={`px-2 py-2 font-semibold ${h === "AVG" ? "text-right pr-2" : "text-center"}`}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedBatting.map((b) => {
                    const meta = playerById.get(b.playerId);
                    const name = meta?.name ?? b.playerName ?? `Player #${b.playerId}`;
                    return (
                      <tr
                        key={b.playerId}
                        className="border-b border-border/50 hover:bg-muted/30"
                      >
                        <td className="py-2 pl-2 pr-3">
                          <button
                            type="button"
                            onClick={() => setLogPlayerId(b.playerId)}
                            className="font-medium text-left hover:underline focus:underline focus:outline-none"
                            title="View game log"
                          >
                            {name}
                          </button>
                          {meta?.number != null && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              #{meta.number}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center font-mono">{b.ab}</td>
                        <td className="px-2 py-2 text-center font-mono">{b.runs}</td>
                        <td className="px-2 py-2 text-center font-mono font-semibold">
                          {b.hits}
                        </td>
                        <td className="px-2 py-2 text-center font-mono">{b.doubles}</td>
                        <td className="px-2 py-2 text-center font-mono">{b.triples}</td>
                        <td className="px-2 py-2 text-center font-mono">{b.hr}</td>
                        <td className="px-2 py-2 text-center font-mono">{b.rbi}</td>
                        <td className="px-2 py-2 text-center font-mono">{b.bb}</td>
                        <td className="px-2 py-2 text-center font-mono">{b.k}</td>
                        <td className="px-2 py-2 text-right pr-2 font-mono">
                          {fmtAvg(gameAvg(b))}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/40 font-semibold">
                    <td className="py-2 pl-2 pr-3 text-xs uppercase tracking-wider text-muted-foreground">
                      Totals
                    </td>
                    <td className="px-2 py-2 text-center font-mono">{totals.ab}</td>
                    <td className="px-2 py-2 text-center font-mono">{totals.runs}</td>
                    <td className="px-2 py-2 text-center font-mono">{totals.hits}</td>
                    <td className="px-2 py-2 text-center font-mono">{totals.doubles}</td>
                    <td className="px-2 py-2 text-center font-mono">{totals.triples}</td>
                    <td className="px-2 py-2 text-center font-mono">{totals.hr}</td>
                    <td className="px-2 py-2 text-center font-mono">{totals.rbi}</td>
                    <td className="px-2 py-2 text-center font-mono">{totals.bb}</td>
                    <td className="px-2 py-2 text-center font-mono">{totals.k}</td>
                    <td className="px-2 py-2 text-right pr-2 font-mono">
                      {fmtAvg(totals.ab > 0 ? totals.hits / totals.ab : null)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {sortedPitching.length > 0 && (
          <div>
            <div className="eyebrow text-primary/70 mb-2">Pitching</div>
            <div className="flex flex-col gap-2">
              {sortedPitching.map((p) => {
                const meta = playerById.get(p.playerId);
                const name = meta?.name ?? p.playerName ?? `Player #${p.playerId}`;
                return (
                  <div
                    key={p.playerId}
                    className="flex items-center gap-3 flex-wrap rounded-md border border-border/60 bg-muted/20 px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => setLogPlayerId(p.playerId)}
                      className="font-medium hover:underline focus:underline focus:outline-none"
                      title="View game log"
                    >
                      {name}
                    </button>
                    {meta?.number != null && (
                      <span className="text-xs text-muted-foreground">
                        #{meta.number}
                      </span>
                    )}
                    <Badge variant="secondary" className="font-mono">
                      {p.pitches} pitches
                    </Badge>
                    {p.notes && (
                      <span className="text-xs text-muted-foreground italic">
                        {p.notes}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>

      <PlayerGameLogDialog
        playerId={logPlayerId}
        open={logPlayerId != null}
        onOpenChange={(v) => !v && setLogPlayerId(null)}
      />
    </Card>
  );
}
