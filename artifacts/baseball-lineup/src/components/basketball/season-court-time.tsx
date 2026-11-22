import { Fragment, useState } from "react";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMinutes, useBasketballSeason, type SeasonGame, type SeasonPlayer } from "@/lib/basketball-season";

type SortKey = "name" | "games" | "starts" | "seconds" | "perGame" | "pct" | "out";
const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: "name", label: "Player" },
  { key: "games", label: "Games" },
  { key: "starts", label: "Starts" },
  { key: "seconds", label: "Minutes" },
  { key: "perGame", label: "Per game" },
  { key: "pct", label: "% avail.", title: "Share of the minutes in games they were available for (missed games don't count against them)" },
  { key: "out", label: "Out", title: "Games they were marked unavailable" },
];

const value = (p: SeasonPlayer, key: SortKey): number | string => {
  switch (key) {
    case "name": return p.name.toLowerCase();
    case "games": return p.games;
    case "starts": return p.starts;
    case "seconds": return p.seconds;
    case "perGame": return p.games ? p.seconds / p.games : 0;
    case "pct": return p.pctAvailable ?? -1;
    case "out": return p.outGames;
  }
};

/** Minutes per game as a tiny line (missed games are gaps). */
function Trend({ player, games }: { player: SeasonPlayer; games: SeasonGame[] }) {
  const points = player.perGame.map((g, i) => ({ i, share: g.available && games[i]?.gameSec ? g.seconds / games[i].gameSec : null }));
  const shown = points.filter((p) => p.share !== null);
  if (shown.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const w = 72;
  const h = 20;
  const x = (i: number) => (points.length === 1 ? w / 2 : (i / (points.length - 1)) * (w - 4) + 2);
  const y = (share: number) => h - 2 - Math.min(1, share) * (h - 4);
  const d = shown.map((p, k) => `${k === 0 ? "M" : "L"} ${x(p.i).toFixed(1)} ${y(p.share!).toFixed(1)}`).join(" ");
  const first = shown[0].share!;
  const last = shown[shown.length - 1].share!;
  const label = last > first + 0.03 ? "trending up" : last < first - 0.03 ? "trending down" : "steady";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Share of each game played, ${label}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary" />
      {shown.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.share!)} r="1.8" className="fill-primary" />)}
    </svg>
  );
}

/**
 * Basketball season playing time on the Rotation Report: sortable, with
 * share of available minutes, a per-game breakdown and a trend per player.
 */
export function SeasonCourtTime() {
  const { data, isLoading } = useBasketballSeason();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "pct", desc: false });
  const [open, setOpen] = useState<Set<number>>(new Set());
  const games = data?.games ?? [];
  const rows = [...(data?.players ?? [])].sort((a, b) => {
    const va = value(a, sort.key);
    const vb = value(b, sort.key);
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return (sort.desc ? -cmp : cmp) || a.name.localeCompare(b.name);
  });
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Playing time &amp; starts</CardTitle>
        <p className="text-sm text-muted-foreground">
          From games run on the court display or loaded in{data ? ` (${data.gamesTracked} so far)` : ""}. Tap a column to sort, a player to see each
          game. % avail. only counts games they were available for.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !data || data.gamesTracked === 0 ? (
          <p className="text-sm text-muted-foreground">No games yet. Open a game's Court Display and tap Start game to begin tracking.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={`py-2 ${c.key === "name" ? "pr-2 text-left" : "px-2 text-right"}`} title={c.title}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 font-semibold uppercase hover:text-foreground"
                        onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : c.key !== "name" && c.key !== "pct" }))}
                      >
                        {c.label}
                        {sort.key === c.key && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                      </button>
                    </th>
                  ))}
                  <th className="py-2 pl-2 text-right">Trend</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.playerId}>
                    <tr className="cursor-pointer border-b hover:bg-muted/40" onClick={() => toggle(r.playerId)}>
                      <td className="py-2 pr-2 font-medium">
                        {open.has(r.playerId) ? <ChevronDown className="mr-1 inline h-3.5 w-3.5" /> : <ChevronRight className="mr-1 inline h-3.5 w-3.5" />}
                        {r.number != null && <span className="mr-1.5 text-muted-foreground">#{r.number}</span>}
                        {r.name}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.games}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.starts}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtMinutes(r.seconds)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{r.games ? fmtMinutes(r.seconds / r.games) : "—"}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{r.pctAvailable === null ? "—" : `${Math.round(r.pctAvailable * 100)}%`}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{r.outGames || ""}</td>
                      <td className="py-2 pl-2 text-right"><Trend player={r} games={games} /></td>
                    </tr>
                    {open.has(r.playerId) && (
                      <tr className="border-b bg-muted/30">
                        <td colSpan={COLUMNS.length + 1} className="px-3 py-2">
                          <table className="w-full text-xs">
                            <tbody>
                              {r.perGame.map((g, i) => {
                                const meta = games[i];
                                return (
                                  <tr key={g.gameId}>
                                    <td className="py-0.5 pr-2 text-muted-foreground">{meta?.date ? format(new Date(meta.date), "MMM d") : ""}</td>
                                    <td className="py-0.5 pr-2">vs. {meta?.opponent ?? "?"}</td>
                                    <td className="py-0.5 pr-2">{g.started ? "Started" : ""}</td>
                                    <td className="py-0.5 pr-2 text-right font-mono tabular-nums">
                                      {g.available ? `${fmtMinutes(g.seconds)} of ${fmtMinutes(meta?.gameSec ?? 0)}` : "Out (unavailable)"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
