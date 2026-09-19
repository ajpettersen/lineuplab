import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Calendar,
  Trophy,
  Info,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { formatOpponentForMatchup } from "@/lib/team-name";
import { useTeamSettings } from "@/hooks/use-team-settings";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type RestTier = { maxPitches: number; daysRest: number };

type Status = "fresh" | "available" | "limited" | "blocked";

interface RestingUntil {
  availableOn: string;
  fromOutingDate: string;
  fromOutingPitches: number;
  daysRest: number;
}

interface UpcomingGame {
  id: number;
  gameDate: string;
  opponent: string;
  location: string | null;
  gameType: string | null;
  tournamentId: number | null;
  tournamentName: string | null;
  effectiveDailyMax: number | null;
  effectiveRestTiers: RestTier[];
  teamPitchesPlanned: number;
}

interface PerGame {
  gameId: number;
  pitchesAlreadyForThisGame: number;
  pitchesAvailable: number | null;
  restingUntil: RestingUntil | null;
  status: Status;
}

interface PitcherRow {
  playerId: number;
  playerName: string;
  playerNumber: string | null;
  recentOutings: { gameId: number; gameDate: string; pitches: number }[];
  perGame: PerGame[];
  todayStatus: Status;
  todayPitchesAvailable: number | null;
  restingUntilToday: RestingUntil | null;
}

interface ArmWatchResponse {
  defaultDailyMax: number | null;
  defaultRestTiers: RestTier[];
  upcomingGames: UpcomingGame[];
  pitchers: PitcherRow[];
  generatedAt: string;
}

function useArmWatch() {
  return useQuery({
    queryKey: ["arm-watch"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/arm-watch`);
      if (!r.ok) throw new Error("Failed to load Arm Watch");
      return r.json() as Promise<ArmWatchResponse>;
    },
  });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// Cell color follows the same scale used in the canvas mockups —
// green/yellow/amber/rose so the visual language carries over.
function statusClasses(status: Status, isPlannedAlready: boolean): string {
  if (status === "blocked")
    return "bg-rose-50 border-rose-200 text-rose-700";
  if (status === "limited")
    return "bg-amber-50 border-amber-200 text-amber-800";
  if (isPlannedAlready)
    return "bg-blue-50 border-blue-200 text-blue-800";
  if (status === "fresh")
    return "bg-emerald-50 border-emerald-200 text-emerald-800";
  return "bg-slate-50 border-slate-200 text-slate-700";
}

function statusLabel(status: Status): string {
  if (status === "blocked") return "Resting";
  if (status === "limited") return "Limited";
  if (status === "fresh") return "Fresh";
  return "Available";
}

function statusBadge(status: Status) {
  if (status === "blocked")
    return (
      <Badge
        variant="outline"
        className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] uppercase font-bold"
      >
        Resting
      </Badge>
    );
  if (status === "limited")
    return (
      <Badge
        variant="outline"
        className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] uppercase font-bold"
      >
        Limited
      </Badge>
    );
  if (status === "fresh")
    return (
      <Badge
        variant="outline"
        className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] uppercase font-bold"
      >
        Fresh
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="bg-slate-100 text-slate-600 border-slate-200 text-[10px] uppercase font-bold"
    >
      Available
    </Badge>
  );
}

export default function ArmWatch() {
  const { data, isLoading, error } = useArmWatch();
  const { teamName } = useTeamSettings();

  // Group upcoming games by calendar day so the matrix can render
  // a single "day header" spanning multiple game columns.
  const dayGroups = useMemo(() => {
    if (!data) return [];
    const map = new Map<
      string,
      { dateLabel: string; games: UpcomingGame[]; firstDate: string }
    >();
    for (const g of data.upcomingGames) {
      const k = dayKey(g.gameDate);
      const entry = map.get(k);
      if (entry) {
        entry.games.push(g);
      } else {
        map.set(k, {
          dateLabel: formatShortDate(g.gameDate),
          firstDate: g.gameDate,
          games: [g],
        });
      }
    }
    return Array.from(map.entries()).map(([k, v]) => ({ key: k, ...v }));
  }, [data]);

  // Per-day team pitch totals (sum across that day's games of every
  // recorded pitch). Mirrors the bottom-row totals in the mockup.
  const teamPitchesByDay = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const g of data.upcomingGames) {
      const k = dayKey(g.gameDate);
      m.set(k, (m.get(k) ?? 0) + g.teamPitchesPlanned);
    }
    return m;
  }, [data]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-primary/40" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-4 w-full max-w-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="container mx-auto p-4 sm:p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not load Arm Watch</AlertTitle>
          <AlertDescription>
            Something went wrong fetching pitcher availability. Check your
            connection and try refreshing the page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { upcomingGames, pitchers, defaultDailyMax, defaultRestTiers } = data;

  const freshCount = pitchers.filter((p) => p.todayStatus === "fresh").length;
  const restingCount = pitchers.filter(
    (p) => p.todayStatus === "blocked",
  ).length;

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-display font-bold tracking-tight">
              Arm Watch
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Pitcher availability across the next two weeks. League games use
            your team defaults; tournament games use that tournament's
            overrides. Click any game to jump to it.
          </p>
        </div>

        <Card className="w-full sm:w-auto sm:min-w-[280px]">
          <CardHeader className="py-2 px-3 bg-muted/40 border-b">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> Team Default Rules
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 py-2 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Daily max</span>
              <span className="font-mono font-bold">
                {defaultDailyMax ?? "—"}
              </span>
            </div>
            {defaultRestTiers.length > 0 ? (
              defaultRestTiers.map((t) => (
                <div key={t.maxPitches} className="flex justify-between">
                  <span className="text-muted-foreground">
                    Up to {t.maxPitches === 999 ? "max" : t.maxPitches}
                  </span>
                  <span className="font-mono">
                    {t.daysRest === 0
                      ? "no rest"
                      : `${t.daysRest} day${t.daysRest === 1 ? "" : "s"}`}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-muted-foreground italic">
                No rest tiers configured. Set them in Settings → Defaults.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SUMMARY BAR */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant="outline"
          className="bg-emerald-50 text-emerald-700 border-emerald-200 px-3 py-1"
        >
          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
          {freshCount} fresh today
        </Badge>
        <Badge
          variant="outline"
          className="bg-rose-50 text-rose-700 border-rose-200 px-3 py-1"
        >
          <ShieldAlert className="w-3.5 h-3.5 mr-1.5" />
          {restingCount} resting today
        </Badge>
        <Badge variant="outline" className="px-3 py-1">
          <Calendar className="w-3.5 h-3.5 mr-1.5" />
          {upcomingGames.length} upcoming{" "}
          {upcomingGames.length === 1 ? "game" : "games"}
        </Badge>
      </div>

      {/* MATRIX */}
      {upcomingGames.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No games scheduled in the next two weeks.
          </CardContent>
        </Card>
      ) : pitchers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No pitchers on the roster yet. Mark players as "can pitch" on the
            Roster page.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ScrollArea className="w-full" type="always">
            <div className="min-w-[900px] [--aw-name:9.5rem] sm:[--aw-name:220px]">
              {/* COLUMN HEADERS — two rows: day banner + per-game */}
              <div
                className="grid bg-muted/30 border-b"
                style={{
                  gridTemplateColumns: `var(--aw-name) repeat(${upcomingGames.length}, minmax(150px, 1fr))`,
                }}
              >
                {/* Day banner row */}
                <div className="border-r sticky left-0 z-10 bg-muted" />
                {dayGroups.map((dg) => {
                  const tournamentId = dg.games[0]?.tournamentId ?? null;
                  const tournamentName = dg.games[0]?.tournamentName ?? null;
                  const allSameTournament = dg.games.every(
                    (g) => g.tournamentId === tournamentId,
                  );
                  const banner = (
                    <div className="px-3 py-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      <span>{dg.dateLabel}</span>
                      {allSameTournament && tournamentName && (
                        <span className="flex items-center gap-1 normal-case font-semibold text-amber-700">
                          <Trophy className="w-3 h-3" />
                          {tournamentName}
                        </span>
                      )}
                    </div>
                  );
                  return (
                    <div
                      key={`day-${dg.key}`}
                      className="border-r border-b bg-muted/40 col-span-1"
                      style={{ gridColumn: `span ${dg.games.length}` }}
                    >
                      {allSameTournament && tournamentId ? (
                        <Link
                          href={`/tournaments/${tournamentId}`}
                          className="block hover:bg-muted/60 transition-colors"
                        >
                          {banner}
                        </Link>
                      ) : (
                        banner
                      )}
                    </div>
                  );
                })}

                {/* Per-game header row — pitcher column blank, then each game */}
                <div className="border-r p-3 flex items-end sticky left-0 z-10 bg-muted">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Pitcher
                  </span>
                </div>
                {upcomingGames.map((g) => {
                  const isTour = g.tournamentId != null;
                  return (
                    <Link
                      key={`hdr-${g.id}`}
                      href={`/games/${g.id}`}
                      className="border-r p-2 hover:bg-muted/60 transition-colors flex flex-col gap-0.5"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                          {formatTime(g.gameDate)}
                        </span>
                        {isTour && (
                          <Trophy className="w-3 h-3 text-amber-600" />
                        )}
                      </div>
                      <span className="text-sm font-semibold leading-tight truncate">
                        vs {formatOpponentForMatchup(g.opponent, teamName)}
                      </span>
                      <div className="flex items-center justify-between mt-0.5 text-[10px] text-muted-foreground">
                        <span>
                          Cap:{" "}
                          <span className="font-mono font-semibold">
                            {g.effectiveDailyMax ?? "—"}
                          </span>
                        </span>
                        {g.teamPitchesPlanned > 0 && (
                          <span className="text-blue-700 font-mono font-semibold">
                            {g.teamPitchesPlanned}p
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>

              {/* PITCHER ROWS */}
              {pitchers.map((p, idx) => (
                <div
                  key={p.playerId}
                  className={`grid border-b ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}
                  style={{
                    gridTemplateColumns: `var(--aw-name) repeat(${upcomingGames.length}, minmax(150px, 1fr))`,
                  }}
                >
                  {/* Pitcher header */}
                  <div className="border-r p-3 flex items-center gap-3 sticky left-0 z-10 bg-card">
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-mono font-bold border shrink-0">
                      {p.playerNumber ?? "—"}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-semibold leading-tight truncate">
                        {p.playerName}
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {statusBadge(p.todayStatus)}
                      </div>
                    </div>
                  </div>

                  {/* Per-game cells */}
                  {p.perGame.map((cell) => {
                    const game = upcomingGames.find(
                      (g) => g.id === cell.gameId,
                    );
                    if (!game) return null;
                    const isPlanned = cell.pitchesAlreadyForThisGame > 0;
                    const cellCls = statusClasses(cell.status, isPlanned);
                    return (
                      <Link
                        key={`${p.playerId}-${cell.gameId}`}
                        href={`/games/${cell.gameId}`}
                        className="border-r p-2 hover:opacity-80 transition-opacity"
                      >
                        <HoverCard openDelay={200}>
                          <HoverCardTrigger asChild>
                            <div
                              className={`h-full rounded-md border px-2 py-1.5 flex flex-col justify-center ${cellCls}`}
                            >
                              {isPlanned ? (
                                <>
                                  <span className="text-[9px] uppercase font-bold tracking-wider opacity-70">
                                    Logged
                                  </span>
                                  <span className="text-xl font-mono font-bold leading-none">
                                    {cell.pitchesAlreadyForThisGame}
                                  </span>
                                  <span className="text-[10px] mt-0.5 opacity-80">
                                    {cell.pitchesAvailable === null
                                      ? "no cap"
                                      : `${cell.pitchesAvailable} left`}
                                  </span>
                                </>
                              ) : cell.status === "blocked" ? (
                                <div className="flex items-center gap-1.5">
                                  <ShieldAlert className="w-3.5 h-3.5" />
                                  <span className="text-xs font-semibold">
                                    Resting
                                  </span>
                                </div>
                              ) : (
                                <>
                                  <span className="text-[9px] uppercase font-bold tracking-wider opacity-70">
                                    {statusLabel(cell.status)}
                                  </span>
                                  <span className="text-base font-mono font-bold leading-none">
                                    {cell.pitchesAvailable === null
                                      ? "—"
                                      : cell.pitchesAvailable}
                                    <span className="text-[10px] font-normal opacity-70 ml-1">
                                      avail
                                    </span>
                                  </span>
                                </>
                              )}
                            </div>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-64 text-xs">
                            <div className="font-semibold mb-1">
                              {p.playerName} —{" "}
                              {formatShortDate(game.gameDate)}
                            </div>
                            <div className="text-muted-foreground mb-2">
                              vs{" "}
                              {formatOpponentForMatchup(
                                game.opponent,
                                teamName,
                              )}
                              {game.tournamentName
                                ? ` · ${game.tournamentName}`
                                : ""}
                            </div>
                            {cell.restingUntil ? (
                              <div className="text-rose-700">
                                Resting until{" "}
                                {formatShortDate(
                                  cell.restingUntil.availableOn,
                                )}{" "}
                                — threw{" "}
                                {cell.restingUntil.fromOutingPitches} on{" "}
                                {formatShortDate(
                                  cell.restingUntil.fromOutingDate,
                                )}{" "}
                                ({cell.restingUntil.daysRest}d rest required).
                              </div>
                            ) : (
                              <div>
                                {cell.pitchesAvailable === null
                                  ? "No daily cap configured."
                                  : `Up to ${cell.pitchesAvailable} pitches available under this game's rules.`}
                                {isPlanned && (
                                  <div className="mt-1 text-blue-700">
                                    Already logged{" "}
                                    {cell.pitchesAlreadyForThisGame} for this
                                    game.
                                  </div>
                                )}
                              </div>
                            )}
                          </HoverCardContent>
                        </HoverCard>
                      </Link>
                    );
                  })}
                </div>
              ))}

              {/* TEAM TOTALS ROW */}
              <div
                className="grid bg-muted/40 border-t-2 border-muted-foreground/10"
                style={{
                  gridTemplateColumns: `var(--aw-name) repeat(${upcomingGames.length}, minmax(150px, 1fr))`,
                }}
              >
                <div className="border-r p-3 flex items-center sticky left-0 z-10 bg-muted">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Team Pitches Logged
                  </span>
                </div>
                {upcomingGames.map((g) => {
                  const k = dayKey(g.gameDate);
                  // Only show the day total on the FIRST game of each day,
                  // mirroring how column headers banner the day.
                  const dayTotal = teamPitchesByDay.get(k) ?? 0;
                  const isFirstOfDay =
                    upcomingGames.findIndex(
                      (gg) => dayKey(gg.gameDate) === k,
                    ) === upcomingGames.indexOf(g);
                  return (
                    <div
                      key={`tot-${g.id}`}
                      className="border-r p-2 flex flex-col items-center justify-center"
                    >
                      <span className="text-lg font-mono font-bold text-blue-800">
                        {g.teamPitchesPlanned}
                      </span>
                      {isFirstOfDay && (
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">
                          Day total: {dayTotal}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </Card>
      )}

      {/* LEGEND */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground border-t pt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-emerald-200 border border-emerald-300" />
          <span>Fresh</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-slate-200 border border-slate-300" />
          <span>Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-amber-200 border border-amber-300" />
          <span>Limited (&lt; 25 left)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-rose-200 border border-rose-300" />
          <span>Resting / blocked</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-blue-100 border border-blue-200" />
          <span>Logged outing</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>
            League games use team defaults · Tournament games use overrides
          </span>
        </div>
      </div>
    </div>
  );
}
