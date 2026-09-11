import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { formatOpponentForMatchup } from "@/lib/team-name";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { SprayChart, useSprayChart } from "@/components/spray-chart";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BattingLine {
  ab: number;
  runs: number;
  hits: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  hbp: number;
  sac: number;
  sb: number;
}

interface PitchingLine {
  pitches: number;
  notes: string | null;
}

interface GameLogRow {
  gameId: number;
  gameDate: string;
  opponent: string;
  gameType: string | null;
  ourScore: number | null;
  opponentScore: number | null;
  status: string;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
}

interface GameLogResponse {
  player: { id: number; name: string; number: number | null; canPitch: boolean };
  games: GameLogRow[];
}

function fmtAvg(num: number, denom: number): string {
  if (denom === 0) return "—";
  const v = num / denom;
  // Standard baseball "no leading zero" format (.333 not 0.333).
  return v.toFixed(3).replace(/^0/, "");
}

function gameLine(b: BattingLine): string {
  // Compact "2-for-3, 2B, RBI" style summary for the row at a glance.
  const parts: string[] = [`${b.hits}-for-${b.ab}`];
  const extras: string[] = [];
  if (b.doubles) extras.push(`${b.doubles} 2B`);
  if (b.triples) extras.push(`${b.triples} 3B`);
  if (b.hr) extras.push(`${b.hr} HR`);
  if (b.rbi) extras.push(`${b.rbi} RBI`);
  if (b.runs) extras.push(`${b.runs} R`);
  if (b.bb) extras.push(`${b.bb} BB`);
  if (b.sb) extras.push(`${b.sb} SB`);
  if (extras.length) parts.push(extras.join(", "));
  return parts.join(" · ");
}

function resultBadge(
  ourScore: number | null,
  opponentScore: number | null,
  status: string,
): { label: string; cls: string } | null {
  if (status === "cancelled") return { label: "Cancelled", cls: "bg-muted text-muted-foreground" };
  if (ourScore == null || opponentScore == null) return null;
  if (ourScore > opponentScore)
    return {
      label: `W ${ourScore}-${opponentScore}`,
      cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
    };
  if (ourScore < opponentScore)
    return {
      label: `L ${ourScore}-${opponentScore}`,
      cls: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
    };
  return {
    label: `T ${ourScore}-${opponentScore}`,
    cls: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  };
}

export function PlayerGameLogDialog({
  playerId,
  open,
  onOpenChange,
}: {
  playerId: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { teamName } = useTeamSettings();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["player-game-log", playerId],
    queryFn: async (): Promise<GameLogResponse> => {
      const r = await fetch(`${BASE}/api/players/${playerId}/game-log`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: open && playerId != null,
    staleTime: 30_000,
  });

  const { data: sprayEvents = [] } = useSprayChart(playerId, open);

  // Season summary across the rows (bat + pitch). Computed client-side
  // from the same rows shown below so the totals always match what the
  // table is rendering — no risk of a roll-up endpoint disagreeing.
  const summary = (() => {
    if (!data) return null;
    const acc = {
      g: 0, ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, rbi: 0,
      bb: 0, k: 0, hbp: 0, sac: 0, sb: 0, runs: 0, pitches: 0, outings: 0,
    };
    for (const g of data.games) {
      acc.g++;
      if (g.batting) {
        acc.ab += g.batting.ab;
        acc.hits += g.batting.hits;
        acc.doubles += g.batting.doubles;
        acc.triples += g.batting.triples;
        acc.hr += g.batting.hr;
        acc.rbi += g.batting.rbi;
        acc.bb += g.batting.bb;
        acc.k += g.batting.k;
        acc.hbp += g.batting.hbp;
        acc.sac += g.batting.sac;
        acc.sb += g.batting.sb;
        acc.runs += g.batting.runs;
      }
      if (g.pitching) {
        acc.pitches += g.pitching.pitches;
        acc.outings++;
      }
    }
    const pa = acc.ab + acc.bb + acc.hbp + acc.sac;
    const singles = acc.hits - acc.doubles - acc.triples - acc.hr;
    const tb = singles + acc.doubles * 2 + acc.triples * 3 + acc.hr * 4;
    return {
      ...acc,
      avg: fmtAvg(acc.hits, acc.ab),
      obp: fmtAvg(acc.hits + acc.bb + acc.hbp, pa),
      slg: fmtAvg(tb, acc.ab),
    };
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[calc(100vw-1rem)] max-h-[90dvh] overflow-y-auto p-3 sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {data?.player
              ? `${data.player.name}${data.player.number != null ? ` #${data.player.number}` : ""}`
              : "Game log"}
          </DialogTitle>
          <DialogDescription>
            Per-game batting and pitching for this player.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading game log…
          </div>
        )}
        {isError && (
          <p className="text-sm text-destructive py-4">
            Couldn't load this player's game log. Try again.
          </p>
        )}

        {data && summary && (
          <>
            {/* Season totals — same numbers as the Season Stats tables, but rolled
                up from this player's per-game lines so a quick eyeball check
                always matches the per-row breakdown below. */}
            <div className="rounded border bg-muted/40 p-3 text-sm grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Games</div>
                <div className="font-mono font-semibold">{summary.g}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">AVG / OBP / SLG</div>
                <div className="font-mono font-semibold">
                  {summary.avg} / {summary.obp} / {summary.slg}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Hits · HR · RBI</div>
                <div className="font-mono font-semibold">
                  {summary.hits} · {summary.hr} · {summary.rbi}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Pitches · Outings</div>
                <div className="font-mono font-semibold">
                  {summary.pitches} · {summary.outings}
                </div>
              </div>
            </div>

            {sprayEvents.length > 0 && (
              <div className="mt-4">
                <div className="text-xs uppercase text-muted-foreground mb-2">Spray Chart</div>
                <SprayChart events={sprayEvents} />
              </div>
            )}

            {data.games.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-6 text-center">
                No batting lines or pitch counts recorded for this player yet.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {data.games.map((g) => {
                  const result = resultBadge(g.ourScore, g.opponentScore, g.status);
                  const opp = formatOpponentForMatchup(g.opponent, teamName);
                  return (
                    <a
                      key={g.gameId}
                      href={`${BASE}/games/${g.gameId}`}
                      className="block rounded border bg-background p-2 sm:p-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="text-xs font-mono text-muted-foreground shrink-0">
                            {new Date(g.gameDate).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          <span className="font-medium truncate">vs {opp}</span>
                          {g.gameType === "tournament" && (
                            <span className="text-[10px] uppercase tracking-wide rounded bg-primary/10 text-primary px-1.5 py-0.5 shrink-0">
                              Tourney
                            </span>
                          )}
                        </div>
                        {result && (
                          <span
                            className={`text-xs font-mono rounded px-2 py-0.5 shrink-0 ${result.cls}`}
                          >
                            {result.label}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 text-sm">
                        {g.batting && g.batting.ab + g.batting.bb + g.batting.hbp + g.batting.sac > 0 && (
                          <div className="text-muted-foreground">
                            <span className="text-foreground font-medium">Bat:</span>{" "}
                            {gameLine(g.batting)}
                            {g.batting.k > 0 && (
                              <span className="text-muted-foreground"> · {g.batting.k} K</span>
                            )}
                          </div>
                        )}
                        {g.pitching && (
                          <div className="text-muted-foreground">
                            <span className="text-foreground font-medium">Pitch:</span>{" "}
                            {g.pitching.pitches} {g.pitching.pitches === 1 ? "pitch" : "pitches"}
                            {g.pitching.notes && (
                              <span className="italic"> — {g.pitching.notes}</span>
                            )}
                          </div>
                        )}
                        {!g.batting && !g.pitching && (
                          <div className="text-muted-foreground italic">No recorded line.</div>
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
