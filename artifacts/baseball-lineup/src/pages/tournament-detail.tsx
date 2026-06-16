import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { showUndoToast, restoreEntity } from "@/lib/undo-toast";
import {
  useGetTournament,
  useUpdateTournament,
  useDeleteTournament,
  useListGames,
  useUpdateGame,
  useGetTeamSettings,
  getGetTournamentQueryKey,
  getListTournamentsQueryKey,
  getListGamesQueryKey,
  getGetGameQueryKey,
  type TournamentDetail,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  CalendarDays,
  MapPin,
  Trophy,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  X,
  AlertCircle,
  Timer,
  Flag,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { RestTiersEditor } from "@/components/rest-tiers-editor";
import type { RestTier } from "@/lib/pitch-rulesets";
import { tournamentDateAsLocal, safeFormatDate } from "@/lib/tournament-date";
import { PoolPlayCard } from "@/components/pool-play-card";
import { TournamentNetworkCard } from "@/components/tournament-network-card";
import {
  computeTournamentStatus,
  computeTournamentRecord,
  formatRecord,
  type TournamentStatusKind,
} from "@/lib/tournament-status";

// Mirrors the listing-page palette so the same status reads the same on
// both surfaces. Kept inline rather than re-exported because the hero
// uses a slightly larger pill and we want the freedom to evolve the two
// in different directions later (e.g. add a sub-label only on the hero).
const HERO_STATUS_STYLES: Record<
  TournamentStatusKind,
  { chip: string; dot: string }
> = {
  live: {
    chip: "border-emerald-300/70 bg-emerald-50 text-emerald-900",
    dot: "bg-emerald-500 motion-safe:animate-pulse",
  },
  upcoming: {
    chip: "border-amber-300/70 bg-amber-50 text-amber-900",
    dot: "bg-amber-500",
  },
  completed: {
    chip: "border-slate-300 bg-slate-100 text-slate-700",
    dot: "bg-slate-400",
  },
};

function parseOptionalInt(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function TournamentDetail() {
  const [, params] = useRoute("/tournaments/:id");
  const tournamentId = parseInt(params?.id ?? "0");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: tournament, isLoading } = useGetTournament(tournamentId, {
    query: {
      enabled: !!tournamentId,
      queryKey: getGetTournamentQueryKey(tournamentId),
    },
  });
  const { data: allGames = [] } = useListGames();
  const { data: teamSettings } = useGetTeamSettings();

  const updateTournament = useUpdateTournament({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getGetTournamentQueryKey(tournamentId),
        });
        void qc.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        toast({ title: "Tournament updated" });
        setEditOpen(false);
      },
    },
  });

  const deleteTournament = useDeleteTournament({
    mutation: {
      onSuccess: (_data, vars) => {
        void qc.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        const idToRestore = vars?.id ?? tournamentId;
        showUndoToast(toast, {
          title: "Tournament deleted",
          onUndo: async () => {
            try {
              await restoreEntity("tournaments", idToRestore);
              void qc.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
              toast({ title: "Tournament restored" });
            } catch {
              toast({ title: "Couldn't undo", variant: "destructive" });
            }
          },
        });
        window.history.back();
      },
    },
  });

  const updateGame = useUpdateGame({
    mutation: {
      onSuccess: (_d, vars) => {
        void qc.invalidateQueries({
          queryKey: getGetTournamentQueryKey(tournamentId),
        });
        void qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
        if (vars.id) {
          void qc.invalidateQueries({ queryKey: getGetGameQueryKey(vars.id) });
        }
      },
    },
  });

  const [editOpen, setEditOpen] = useState(false);
  const [addGameOpen, setAddGameOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // "fresh" answers the pre-game question "who CAN I pitch today?"
  // (most-rested first). "workhorse" is the analytical view (totals
  // desc). Default is "fresh" because the surface is most useful
  // before a game; the workhorse sort was the legacy default.
  const [availabilitySort, setAvailabilitySort] = useState<"fresh" | "workhorse">("fresh");

  const linkedGameIds = useMemo(
    () => new Set((tournament?.games ?? []).map((g) => g.id)),
    [tournament],
  );
  const availableGames = useMemo(
    () => allGames.filter((g) => !linkedGameIds.has(g.id)),
    [allGames, linkedGameIds],
  );

  // Roll up per-game pitch totals + per-pitcher breakdown from the
  // outings the tournament endpoint already ships. The Games card
  // shows "Pitcher: N" chips per linked game plus a tournament total
  // footer so a coach doesn't have to drill into each game.
  const pitchesByGame = useMemo(() => {
    const map = new Map<
      number,
      {
        totalPitches: number;
        perPitcher: {
          playerId: number;
          playerName: string;
          playerNumber: number | null;
          pitches: number;
        }[];
      }
    >();
    for (const p of tournament?.pitcherAvailability ?? []) {
      for (const o of p.outings) {
        const cur = map.get(o.gameId) ?? { totalPitches: 0, perPitcher: [] };
        cur.totalPitches += o.pitches;
        cur.perPitcher.push({
          playerId: p.playerId,
          playerName: p.playerName,
          playerNumber: p.playerNumber ?? null,
          pitches: o.pitches,
        });
        map.set(o.gameId, cur);
      }
    }
    // Sort each game's breakdown high-to-low so the workhorse appears first.
    for (const v of map.values()) {
      v.perPitcher.sort((a, b) => b.pitches - a.pitches);
    }
    return map;
  }, [tournament?.pitcherAvailability]);

  const tournamentPitchTotal = useMemo(() => {
    let total = 0;
    for (const v of pitchesByGame.values()) total += v.totalPitches;
    return total;
  }, [pitchesByGame]);

  // Pre-sorted availability rows for the table. "fresh" sort puts the
  // pitchers a coach can actually use today first: most pitches left
  // → fewest left → tapped out (0) → resting (sunk to the bottom).
  // "No cap" rows (null) are treated as fully available and float
  // alongside maximum-cap pitchers. Ties break by least-thrown today
  // so a totally fresh arm beats one who already has 12 pitches even
  // when their remaining is identical.
  const sortedAvailability = useMemo(() => {
    const rows = (tournament?.pitcherAvailability ?? []).slice();
    if (availabilitySort === "workhorse") {
      rows.sort((a, b) => b.totalPitchesInTournament - a.totalPitchesInTournament);
      return rows;
    }
    // freshness score: resting → -Infinity (always last). null cap →
    // treat as Number.MAX_SAFE_INTEGER so they sort above anyone with
    // a numeric cap but stay deterministic.
    const score = (p: typeof rows[number]) => {
      if (p.restingUntil) return Number.NEGATIVE_INFINITY;
      if (p.pitchesAvailableToday == null) return Number.MAX_SAFE_INTEGER;
      return p.pitchesAvailableToday;
    };
    rows.sort((a, b) => {
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      // tie-break: fewer pitches today wins (truly-fresh > used-once)
      return a.pitchesToday - b.pitchesToday;
    });
    return rows;
  }, [tournament?.pitcherAvailability, availabilitySort]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!tournament) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <p className="text-sm text-muted-foreground">Tournament not found.</p>
        <Link href="/tournaments">
          <Button variant="link" className="mt-3">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to tournaments
          </Button>
        </Link>
      </div>
    );
  }

  const dailyLabel =
    tournament.effectiveDailyMax != null
      ? `daily max ${tournament.effectiveDailyMax}`
      : "no daily max";
  const tournamentLabel =
    tournament.effectiveTournamentMax != null
      ? `tournament max ${tournament.effectiveTournamentMax}`
      : null;
  const restTiersLabel =
    (tournament.effectiveRestTiers ?? []).length === 0
      ? "no rest rules"
      : `${(tournament.effectiveRestTiers ?? []).length} rest tiers`;

  // Hero status: live (pulsing dot) > upcoming (gold) > completed (slate).
  // Record is W-L-T across completed games — same source as the dashboard.
  const status = computeTournamentStatus(tournament.startDate, tournament.endDate);
  const statusStyles = HERO_STATUS_STYLES[status.kind];
  const record = computeTournamentRecord(tournament.games);
  const recordLabel = formatRecord(record);
  // Compact time-limits summary — shown as a Timer chip so it's
  // discoverable at a glance instead of buried inside the Edit dialog.
  // We surface up to two pairs (Pool / Bracket) but only when at least
  // one minute field is set; otherwise the chip is hidden entirely.
  const tlPoolNoNew = tournament.poolPlayNoNewInningMinutes;
  const tlPoolHard = tournament.poolPlayHardStopMinutes;
  const tlBracketNoNew = tournament.bracketNoNewInningMinutes;
  const tlBracketHard = tournament.bracketHardStopMinutes;
  const hasAnyTimeLimit =
    tlPoolNoNew != null ||
    tlPoolHard != null ||
    tlBracketNoNew != null ||
    tlBracketHard != null;
  // "{no-new}/{hard}" when both set (compact pair reads as a known
  // ratio), otherwise spell out which side is configured so a coach
  // who only filled in one field isn't left guessing which it was.
  const fmtPair = (noNew: number | null | undefined, hard: number | null | undefined) =>
    noNew != null && hard != null
      ? `${noNew}/${hard}m`
      : noNew != null
        ? `no-new ${noNew}m`
        : hard != null
          ? `hard ${hard}m`
          : "—";

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link href="/tournaments">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 h-8">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            All tournaments
          </Button>
        </Link>
        {/* Broadcast-style hero (May 2026 Phase 2 redesign): status pill
         *  on top, big title in the middle, and a stat strip at the
         *  bottom that puts record + games-played + total pitches + time
         *  limits side-by-side so the coach can size up "where are we in
         *  this weekend" before scrolling. Edit / Delete sit in the
         *  upper-right so the destructive button stays out of the
         *  primary glance path. */}
        <div
          className="relative overflow-hidden rounded-xl border border-white/10 shadow-lg shadow-black/20"
          style={{
            background:
              "linear-gradient(135deg, var(--brand-l) 0%, var(--brand-d) 55%, var(--brand-dd) 100%)",
          }}
          data-testid="tournament-hero"
        >
          {/* Gold broadcast lower-third stripe — uses the team accent token so
           *  custom teams theme it; default teams keep trophy gold. */}
          <div className="absolute inset-x-0 top-0 h-[3px] bg-accent" aria-hidden="true" />
          <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1 space-y-2">
            <Badge
              variant="outline"
              className={`text-[10px] font-display font-semibold tracking-[0.18em] px-2 py-0.5 ${statusStyles.chip}`}
              aria-label={status.detail}
              data-testid="badge-tournament-status"
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${statusStyles.dot}`}
                aria-hidden="true"
              />
              {status.label}
            </Badge>
            <h1 className="page-title text-white flex items-center gap-3">
              <Trophy className="h-7 w-7 text-accent shrink-0" />
              <span className="truncate">{tournament.name}</span>
            </h1>
            <div className="text-sm text-white/70 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                {format(tournamentDateAsLocal(tournament.startDate), "MMM d")} –{" "}
                {format(tournamentDateAsLocal(tournament.endDate), "MMM d, yyyy")}
              </span>
              {tournament.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {tournament.location}
                </span>
              )}
            </div>
            {tournament.notes && (
              <p className="text-sm text-white/70">{tournament.notes}</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditOpen(true)}
              className="text-white/85 hover:text-white hover:bg-white/10"
              data-testid="button-edit-tournament"
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-300 hover:text-red-200 hover:bg-white/10"
              onClick={() => setConfirmDelete(true)}
              data-testid="button-delete-tournament"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
          </div>
        </div>

        {/* Stat strip — broadcast scoreboard vibe. Big Roboto-Mono
         *  numerals on a tinted panel, with the rules chips on the
         *  right. Grid collapses to 2 cols on phone so each stat still
         *  has breathing room. */}
        <div
          className="mt-4 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-3 sm:px-4 sm:py-3 backdrop-blur-sm"
          data-testid="tournament-hero-stats"
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div>
              <div className="text-[10px] uppercase font-display font-semibold tracking-[0.18em] text-white/55">
                Record
              </div>
              <div
                className="text-xl sm:text-2xl font-bold font-['Roboto_Mono'] tabular-nums mt-0.5 text-accent"
                data-testid="text-tournament-record"
              >
                {recordLabel}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-display font-semibold tracking-[0.18em] text-white/55">
                Games
              </div>
              <div
                className="text-xl sm:text-2xl font-bold font-['Roboto_Mono'] tabular-nums mt-0.5 text-white"
                data-testid="text-tournament-games-progress"
              >
                {record.played}
                <span className="text-base text-white/50">/{record.total}</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-display font-semibold tracking-[0.18em] text-white/55">
                Pitches
              </div>
              <div
                className="text-xl sm:text-2xl font-bold font-['Roboto_Mono'] tabular-nums mt-0.5 text-white"
                data-testid="text-tournament-total-pitches"
              >
                {tournamentPitchTotal}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-display font-semibold tracking-[0.18em] text-white/55">
                Pitchers
              </div>
              <div className="text-xl sm:text-2xl font-bold font-['Roboto_Mono'] tabular-nums mt-0.5 text-white">
                {tournament.pitcherAvailability.length}
              </div>
            </div>
          </div>
          {/* Rules row — collapses naturally on small widths. Each chip
           *  exposes the same info that used to live in a single dense
           *  "{dailyLabel} · {tournamentLabel} · {restTiersLabel}"
           *  outline badge — now split so each is independently
           *  scannable and the time-limit chip can sit alongside. */}
          <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs border-white/20 text-white/80">
              {dailyLabel}
            </Badge>
            {tournamentLabel && (
              <Badge variant="outline" className="text-xs border-white/20 text-white/80">
                {tournamentLabel}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs border-white/20 text-white/80">
              {restTiersLabel}
            </Badge>
            {hasAnyTimeLimit && (
              <Badge
                variant="outline"
                className="text-xs gap-1 flex items-center border-white/20 text-white/80"
                data-testid="badge-tournament-time-limits"
                aria-label="Time limits: pool no-new / hard, bracket no-new / hard"
              >
                <Timer className="h-3 w-3" aria-hidden="true" />
                Pool {fmtPair(tlPoolNoNew, tlPoolHard)} · Bracket{" "}
                {fmtPair(tlBracketNoNew, tlBracketHard)}
              </Badge>
            )}
          </div>
          </div>
          </div>
        </div>
      </div>

      <Card data-testid="card-pitcher-availability">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="text-base">Pitcher Availability</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Rolling totals across this tournament + how many pitches each
              pitcher has left today after league rest rules.
            </p>
            {/* Status roll-up — answers the pre-game question
             *  ("who can I send out today?") at one glance so the coach
             *  doesn't have to scan the table to count. Hidden when the
             *  roster has no pitchers. */}
            {tournament.pitcherAvailability.length > 0 && (
              <div
                className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]"
                data-testid="pitcher-availability-summary"
              >
                {(() => {
                  let fresh = 0;
                  let used = 0;
                  let done = 0;
                  let resting = 0;
                  for (const p of tournament.pitcherAvailability) {
                    if (p.restingUntil) {
                      resting++;
                    } else if (p.pitchesAvailableToday == null) {
                      // No cap configured — count as fresh since they
                      // can throw without restriction.
                      fresh++;
                    } else if (p.pitchesAvailableToday === 0) {
                      done++;
                    } else if (p.pitchesToday > 0) {
                      used++;
                    } else {
                      fresh++;
                    }
                  }
                  return (
                    <>
                      <Badge
                        variant="outline"
                        className="border-emerald-300 bg-emerald-50 text-emerald-900 font-mono"
                        data-testid="summary-fresh"
                      >
                        {fresh} fresh
                      </Badge>
                      {used > 0 && (
                        <Badge variant="outline" className="font-mono" data-testid="summary-used">
                          {used} used
                        </Badge>
                      )}
                      {done > 0 && (
                        <Badge
                          variant="outline"
                          className="border-red-300 bg-red-50 text-red-900 font-mono"
                          data-testid="summary-done"
                        >
                          {done} tapped out
                        </Badge>
                      )}
                      {resting > 0 && (
                        <Badge
                          variant="outline"
                          className="border-amber-300 bg-amber-50 text-amber-900 font-mono"
                          data-testid="summary-resting"
                        >
                          {resting} resting
                        </Badge>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
          {/* Sort toggle. Defaults to "fresh" because the pre-game
           *  question is "who CAN I pitch right now" — workhorse-first
           *  totals are the post-game/analytical view. Toggle is hidden
           *  when there are no pitchers so the header stays clean. */}
          {tournament.pitcherAvailability.length > 0 && (
            <div className="shrink-0 inline-flex rounded-md border bg-muted/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setAvailabilitySort("fresh")}
                className={`px-2 py-1 rounded ${availabilitySort === "fresh" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="sort-availability-fresh"
              >
                Fresh today
              </button>
              <button
                type="button"
                onClick={() => setAvailabilitySort("workhorse")}
                className={`px-2 py-1 rounded ${availabilitySort === "workhorse" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="sort-availability-workhorse"
              >
                Workhorse
              </button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {tournament.pitcherAvailability.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No pitchers on the roster yet. Mark players as pitchers from the Roster page.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs">
                    <th className="text-left py-2 pr-3 font-medium">Pitcher</th>
                    <th className="text-right py-2 px-2 font-medium">Today</th>
                    <th className="text-right py-2 px-2 font-medium">Remaining today</th>
                    <th className="text-right py-2 px-2 font-medium">Remaining tournament</th>
                    <th className="text-left py-2 pl-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAvailability
                    .map((p) => {
                      // dailyMax may be null (no cap configured) — in that
                      // case "exceeded" is meaningless and we render the
                      // total as just "Today: N".
                      const exceeded =
                        p.dailyMax != null && p.pitchesToday > p.dailyMax;
                      const resting = p.restingUntil;
                      return (
                        <tr
                          key={p.playerId}
                          className="border-t"
                          data-testid={`row-availability-${p.playerId}`}
                        >
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/players/${p.playerId}`}
                                className="font-medium hover:underline"
                              >
                                {p.playerName}
                              </Link>
                              {p.playerNumber != null && (
                                <span className="text-xs text-muted-foreground">
                                  #{p.playerNumber}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={`text-right py-2 px-2 tabular-nums ${exceeded ? "text-red-600 font-semibold" : ""}`}>
                            {p.pitchesToday}
                          </td>
                          <td className="text-right py-2 px-2 tabular-nums">
                            {p.pitchesAvailableToday == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className={p.pitchesAvailableToday === 0 ? "text-muted-foreground" : "font-semibold text-emerald-700"}>
                                {p.pitchesAvailableToday}
                              </span>
                            )}
                          </td>
                          <td className="text-right py-2 px-2 tabular-nums">
                            {p.pitchesAvailableInTournament == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className={p.pitchesAvailableInTournament === 0 ? "text-muted-foreground" : "font-semibold"}>
                                {p.pitchesAvailableInTournament}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pl-3">
                            {resting ? (
                              <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-900">
                                Rest until {safeFormatDate(resting.availableOn, "EEE M/d", "soon")}
                              </Badge>
                            ) : exceeded ? (
                              <Badge variant="destructive" className="text-xs">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Over max
                              </Badge>
                            ) : p.pitchesAvailableToday == null ? (
                              <Badge variant="outline" className="text-xs">
                                No cap
                              </Badge>
                            ) : p.pitchesAvailableToday > 0 ? (
                              <Badge variant="outline" className="text-xs border-emerald-300 bg-emerald-50 text-emerald-900">
                                Available
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                Done today
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <TournamentNetworkCard tournamentId={tournamentId} />

      <PoolPlayCard
        tournamentId={tournamentId}
        poolPlay={tournament.poolPlay ?? null}
        analysis={tournament.poolPlayAnalysis ?? null}
      />

      <Card data-testid="card-tournament-games">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3">
          <div>
            <CardTitle className="text-base">Games</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Linked games' pitch counts feed availability above.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddGameOpen(true)}
            data-testid="button-add-game-to-tournament"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add game
          </Button>
        </CardHeader>
        <CardContent>
          {tournament.games.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No games linked yet. Use "Add game" above.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {tournament.games.map((g) => {
                const usage = pitchesByGame.get(g.id);
                // Defensive `?? []`: an old persisted cache rehydrated
                // from IndexedDB can be missing newly-added fields like
                // `gameSuggestions`. Without the guard, the first render
                // after rehydrate throws and trips the ErrorBoundary
                // until the coach hits "Reload".
                const suggestion = (tournament.gameSuggestions ?? []).find(
                  (s) => s.gameId === g.id,
                );
                // Score chip — only show when completed AND we have both
                // sides. "W"/"L"/"T" prefix mirrors the dashboard pill so
                // a coach scanning the grid recognizes the outcome at a
                // glance. Phase 2 redesign: each game gets its own card
                // instead of a divider row, with the stage badge tucked
                // into the upper-right corner so POOL/BRACKET reads as
                // metadata, not a primary action.
                const hasFinalScore =
                  g.status === "completed" &&
                  g.ourScore != null &&
                  g.opponentScore != null;
                const outcome = hasFinalScore
                  ? g.ourScore! > g.opponentScore!
                    ? "W"
                    : g.ourScore! < g.opponentScore!
                      ? "L"
                      : "T"
                  : null;
                const stageLabel =
                  g.bracketStage === "bracket"
                    ? "BRACKET"
                    : g.bracketStage === "pool"
                      ? "POOL"
                      : null;
                return (
                <div
                  key={g.id}
                  className="relative rounded-lg border bg-card p-3 transition-colors hover:border-primary/40"
                  data-testid={`row-tournament-game-${g.id}`}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1 right-1 h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                    onClick={() =>
                      updateGame.mutate({ id: g.id, data: { tournamentId: null } })
                    }
                    aria-label="Remove from tournament"
                    data-testid={`button-remove-game-${g.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 pr-7">
                    {stageLabel && (
                      <Badge
                        variant="outline"
                        className={`text-[9px] font-display font-semibold tracking-[0.18em] px-1.5 py-0 mb-1.5 ${
                          g.bracketStage === "bracket"
                            ? "border-amber-300/70 bg-amber-50 text-amber-900"
                            : "border-slate-300 bg-slate-50 text-slate-700"
                        }`}
                        data-testid={`badge-game-stage-${g.id}`}
                      >
                        <Flag className="h-2.5 w-2.5 mr-1" aria-hidden="true" />
                        {stageLabel}
                      </Badge>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/games/${g.id}`}
                        className="font-semibold hover:underline truncate"
                      >
                        vs {g.opponent}
                      </Link>
                      {outcome && (
                        <Badge
                          variant="outline"
                          className={`text-xs font-display font-bold tabular-nums ${
                            outcome === "W"
                              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                              : outcome === "L"
                                ? "border-rose-300 bg-rose-50 text-rose-900"
                                : "border-slate-300 bg-slate-100 text-slate-700"
                          }`}
                          data-testid={`badge-game-score-${g.id}`}
                          aria-label={`Final ${outcome === "W" ? "win" : outcome === "L" ? "loss" : "tie"} ${g.ourScore} to ${g.opponentScore}`}
                        >
                          {outcome} {g.ourScore}-{g.opponentScore}
                        </Badge>
                      )}
                      {usage && usage.totalPitches > 0 ? (
                        <Badge
                          variant="secondary"
                          className="text-xs font-mono"
                          data-testid={`badge-game-pitches-${g.id}`}
                        >
                          {usage.totalPitches} pitches
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-xs text-muted-foreground"
                          data-testid={`badge-game-pitches-${g.id}`}
                        >
                          No pitches logged
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {safeFormatDate(g.gameDate, "EEE, MMM d · h:mm a", "Date TBD")}
                      {g.location ? ` · ${g.location}` : ""}
                    </div>
                    {usage && usage.perPitcher.length > 0 && (
                      <div
                        className="mt-2 flex flex-wrap gap-1.5"
                        data-testid={`pitcher-breakdown-${g.id}`}
                      >
                        {usage.perPitcher.map((pp) => (
                          <Badge
                            key={pp.playerId}
                            variant="outline"
                            className="text-xs font-normal"
                            data-testid={`chip-game-${g.id}-pitcher-${pp.playerId}`}
                          >
                            <span className="truncate max-w-[10rem]">
                              {pp.playerNumber != null ? `#${pp.playerNumber} ` : ""}
                              {pp.playerName}
                            </span>
                            <span className="ml-1.5 font-mono tabular-nums text-foreground">
                              {pp.pitches}
                            </span>
                          </Badge>
                        ))}
                      </div>
                    )}
                    {suggestion && suggestion.pitchers.length > 0 && (
                      <div
                        className="mt-2"
                        data-testid={`suggested-pitchers-${g.id}`}
                      >
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          Suggested from depth chart
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {suggestion.pitchers.map((sp) => {
                            const isStarter = sp.role === "starter";
                            const remaining =
                              sp.pitchesAvailableToday != null
                                ? `${sp.pitchesAvailableToday} today`
                                : "no cap";
                            return (
                              <Badge
                                key={sp.playerId}
                                variant="outline"
                                className={
                                  "text-xs font-normal " +
                                  (isStarter
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                                    : "")
                                }
                                data-testid={`chip-suggested-game-${g.id}-pitcher-${sp.playerId}`}
                              >
                                <span className="font-medium mr-1">
                                  {isStarter ? "Start" : `#${sp.depthRank}`}
                                </span>
                                <span className="truncate max-w-[10rem]">
                                  {sp.playerNumber != null ? `#${sp.playerNumber} ` : ""}
                                  {sp.playerName}
                                </span>
                                <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                                  {remaining}
                                </span>
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
          {tournament.games.length > 0 && (
            <div
              className="mt-3 pt-3 border-t flex items-center justify-between text-sm"
              data-testid="tournament-pitch-total"
            >
              <span className="text-muted-foreground">
                Tournament total
                {tournament.effectiveTournamentMax != null
                  ? ` · cap ${tournament.effectiveTournamentMax}`
                  : ""}
              </span>
              <span className="font-mono tabular-nums font-semibold">
                {tournamentPitchTotal} pitches
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <EditTournamentDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        tournament={tournament}
        teamDailyDefault={teamSettings?.defaultDailyPitchMax ?? null}
        teamTournamentDefault={teamSettings?.defaultTournamentPitchMax ?? null}
        onSubmit={(data) => updateTournament.mutate({ id: tournamentId, data })}
        isPending={updateTournament.isPending}
      />

      {/* Add game dialog */}
      <Dialog open={addGameOpen} onOpenChange={setAddGameOpen}>
        <DialogContent className="max-w-md max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add a game</DialogTitle>
            <DialogDescription>
              Create a new game for this tournament, or link one that's already on your schedule.
            </DialogDescription>
          </DialogHeader>
          {/* Always-available "create new" CTA so a coach can build a
              tournament's schedule from scratch without bouncing through
              the main Schedule page first. The new-game form reads the
              ?tournamentId query param, pre-selects gameType=tournament,
              and links the game back to this tournament on save. */}
          <Link href={`/games/new?tournamentId=${tournamentId}`}>
            <Button
              className="w-full justify-center"
              data-testid="button-create-game-for-tournament"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Create new game
            </Button>
          </Link>
          {availableGames.length > 0 && (
            <>
              <div className="text-xs text-muted-foreground text-center">
                or link an existing game
              </div>
              <ul className="divide-y border rounded-md max-h-[40dvh] overflow-y-auto">
                {availableGames.map((g) => (
                  <li
                    key={g.id}
                    className="p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">vs {g.opponent}</div>
                      <div className="text-xs text-muted-foreground">
                        {safeFormatDate(g.gameDate, "EEE, MMM d · h:mm a", "Date TBD")}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        updateGame.mutate(
                          { id: g.id, data: { tournamentId } },
                          { onSuccess: () => setAddGameOpen(false) },
                        );
                      }}
                      disabled={updateGame.isPending}
                      data-testid={`button-link-game-${g.id}`}
                    >
                      Link
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddGameOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this tournament?</DialogTitle>
            <DialogDescription>
              The {tournament.games.length} linked game{tournament.games.length === 1 ? "" : "s"} and their pitch counts will be kept — only the tournament container is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTournament.mutate({ id: tournamentId })}
              disabled={deleteTournament.isPending}
              data-testid="button-confirm-delete-tournament"
            >
              {deleteTournament.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete tournament"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditTournamentDialog({
  open,
  onOpenChange,
  tournament,
  teamDailyDefault,
  teamTournamentDefault,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tournament: TournamentDetail;
  teamDailyDefault: number | null;
  teamTournamentDefault: number | null;
  onSubmit: (data: {
    name?: string;
    startDate?: string;
    endDate?: string;
    location?: string | null;
    dailyPitchMax?: number | null;
    tournamentPitchMax?: number | null;
    restTiers?: RestTier[] | null;
    poolPlayNoNewInningMinutes?: number | null;
    poolPlayHardStopMinutes?: number | null;
    bracketNoNewInningMinutes?: number | null;
    bracketHardStopMinutes?: number | null;
  }) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(tournament.name);
  const [startDate, setStartDate] = useState(
    new Date(tournament.startDate).toISOString().slice(0, 10),
  );
  const [endDate, setEndDate] = useState(
    new Date(tournament.endDate).toISOString().slice(0, 10),
  );
  const [location, setLocation] = useState(tournament.location ?? "");
  const [dailyMax, setDailyMax] = useState<string>(
    tournament.dailyPitchMax != null ? String(tournament.dailyPitchMax) : "",
  );
  const [tournamentMax, setTournamentMax] = useState<string>(
    tournament.tournamentPitchMax != null ? String(tournament.tournamentPitchMax) : "",
  );
  const [restTiers, setRestTiers] = useState<RestTier[] | null>(
    (tournament.restTiers as RestTier[] | null | undefined) ?? null,
  );
  // Time-limit rules — pool play and bracket play get independent pairs
  // because pool play often runs a tighter clock than bracket play. Empty
  // string = no rule. Server-side validators clamp to 1-360 minutes.
  const [poolNoNew, setPoolNoNew] = useState<string>(
    tournament.poolPlayNoNewInningMinutes != null
      ? String(tournament.poolPlayNoNewInningMinutes)
      : "",
  );
  const [poolHardStop, setPoolHardStop] = useState<string>(
    tournament.poolPlayHardStopMinutes != null
      ? String(tournament.poolPlayHardStopMinutes)
      : "",
  );
  const [bracketNoNew, setBracketNoNew] = useState<string>(
    tournament.bracketNoNewInningMinutes != null
      ? String(tournament.bracketNoNewInningMinutes)
      : "",
  );
  const [bracketHardStop, setBracketHardStop] = useState<string>(
    tournament.bracketHardStopMinutes != null
      ? String(tournament.bracketHardStopMinutes)
      : "",
  );

  // Re-seed local form state when the tournament prop changes — happens
  // after a successful save invalidates the query and refetches.
  useEffect(() => {
    setName(tournament.name);
    setStartDate(new Date(tournament.startDate).toISOString().slice(0, 10));
    setEndDate(new Date(tournament.endDate).toISOString().slice(0, 10));
    setLocation(tournament.location ?? "");
    setDailyMax(
      tournament.dailyPitchMax != null ? String(tournament.dailyPitchMax) : "",
    );
    setTournamentMax(
      tournament.tournamentPitchMax != null
        ? String(tournament.tournamentPitchMax)
        : "",
    );
    setRestTiers((tournament.restTiers as RestTier[] | null | undefined) ?? null);
    setPoolNoNew(
      tournament.poolPlayNoNewInningMinutes != null
        ? String(tournament.poolPlayNoNewInningMinutes)
        : "",
    );
    setPoolHardStop(
      tournament.poolPlayHardStopMinutes != null
        ? String(tournament.poolPlayHardStopMinutes)
        : "",
    );
    setBracketNoNew(
      tournament.bracketNoNewInningMinutes != null
        ? String(tournament.bracketNoNewInningMinutes)
        : "",
    );
    setBracketHardStop(
      tournament.bracketHardStopMinutes != null
        ? String(tournament.bracketHardStopMinutes)
        : "",
    );
  }, [tournament]);

  const submit = () => {
    onSubmit({
      name: name.trim(),
      startDate,
      endDate,
      location: location.trim() || null,
      dailyPitchMax: parseOptionalInt(dailyMax),
      tournamentPitchMax: parseOptionalInt(tournamentMax),
      restTiers,
      poolPlayNoNewInningMinutes: parseOptionalInt(poolNoNew),
      poolPlayHardStopMinutes: parseOptionalInt(poolHardStop),
      bracketNoNewInningMinutes: parseOptionalInt(bracketNoNew),
      bracketHardStopMinutes: parseOptionalInt(bracketHardStop),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit tournament</DialogTitle>
          <DialogDescription>
            Leave a pitch field blank to inherit your team default.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="e-name">Name</Label>
            <Input
              id="e-name"
              data-testid="input-edit-tournament-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="e-start">Start</Label>
              <Input
                id="e-start"
                data-testid="input-edit-tournament-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-end">End</Label>
              <Input
                id="e-end"
                data-testid="input-edit-tournament-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-location">Location</Label>
            <Input
              id="e-location"
              data-testid="input-edit-tournament-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="e-daily-max" className="text-xs">Pitches / day</Label>
              <Input
                id="e-daily-max"
                type="number"
                inputMode="numeric"
                min={0}
                max={500}
                value={dailyMax}
                onChange={(e) => setDailyMax(e.target.value)}
                placeholder={
                  teamDailyDefault != null
                    ? `Team default: ${teamDailyDefault}`
                    : "Optional"
                }
                data-testid="input-edit-tournament-daily-max"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-tournament-max" className="text-xs">Pitches / tournament</Label>
              <Input
                id="e-tournament-max"
                type="number"
                inputMode="numeric"
                min={0}
                max={2000}
                value={tournamentMax}
                onChange={(e) => setTournamentMax(e.target.value)}
                placeholder={
                  teamTournamentDefault != null
                    ? `Team default: ${teamTournamentDefault}`
                    : "Optional"
                }
                data-testid="input-edit-tournament-total-max"
              />
            </div>
          </div>
          <div className="space-y-2 border rounded-md p-3">
            <div>
              <Label className="text-xs uppercase tracking-wider font-display">
                Time Limits
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Pool and bracket play often use different clocks. Field
                Display shows warnings — games are never auto-finalized.
                Leave blank for no rule.
              </p>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Pool Play</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="e-pool-no-new" className="text-xs">
                    No new inning (min)
                  </Label>
                  <Input
                    id="e-pool-no-new"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={360}
                    value={poolNoNew}
                    onChange={(e) => setPoolNoNew(e.target.value)}
                    placeholder="e.g. 75"
                    data-testid="input-edit-tournament-pool-no-new"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="e-pool-hard" className="text-xs">
                    Hard stop (min)
                  </Label>
                  <Input
                    id="e-pool-hard"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={360}
                    value={poolHardStop}
                    onChange={(e) => setPoolHardStop(e.target.value)}
                    placeholder="e.g. 90"
                    data-testid="input-edit-tournament-pool-hard"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Bracket Play</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="e-bracket-no-new" className="text-xs">
                    No new inning (min)
                  </Label>
                  <Input
                    id="e-bracket-no-new"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={360}
                    value={bracketNoNew}
                    onChange={(e) => setBracketNoNew(e.target.value)}
                    placeholder="e.g. 90"
                    data-testid="input-edit-tournament-bracket-no-new"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="e-bracket-hard" className="text-xs">
                    Hard stop (min)
                  </Label>
                  <Input
                    id="e-bracket-hard"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={360}
                    value={bracketHardStop}
                    onChange={(e) => setBracketHardStop(e.target.value)}
                    placeholder="e.g. 105"
                    data-testid="input-edit-tournament-bracket-hard"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Rest tiers</Label>
            <p className="text-xs text-muted-foreground -mt-1">
              Leave empty to inherit your team default.
            </p>
            <RestTiersEditor
              value={restTiers}
              onChange={setRestTiers}
              testIdPrefix="edit-tournament-rest-tier"
              placeholder="Inheriting team default — add rows here to override."
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-edit-tournament-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={isPending}
            data-testid="button-edit-tournament-save"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
