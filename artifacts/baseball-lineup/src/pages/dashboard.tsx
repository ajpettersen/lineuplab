import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGames,
  useGetSeasonStats,
  useGetPlayerStats,
  useGetPreferences,
  useListDashboardTasks,
  useDismissDashboardTask,
  getListDashboardTasksQueryKey,
  type DashboardTask,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, Users, Trophy, TrendingUp, ChevronRight, Shield, Tv, MapPin, ClipboardList, X, Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { BroadcastStatCard } from "@/components/broadcast-stat-card";
import { format, isToday, isTomorrow } from "date-fns";
import { isTrulyUpcoming, isPastUnrecorded } from "@/lib/game-status";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permission";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { shortenTeamName, formatOpponentForMatchup } from "@/lib/team-name";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function ScoreBadge({ our, opp }: { our: number | null | undefined; opp: number | null | undefined }) {
  if (our == null || opp == null) return null;
  // Same score on both sides = tie. We treat 0-0 as a tie too — if a coach
  // recorded the game as completed with no runs (rare but legal in youth
  // ball when called early), it still isn't a loss.
  const tied = our === opp;
  const won = our > opp;
  const cls = tied
    ? "bg-amber-100 text-amber-800"
    : won
      ? "bg-green-100 text-green-800"
      : "bg-red-100 text-red-800";
  const letter = tied ? "T" : won ? "W" : "L";
  return (
    <span className={`text-sm font-bold px-2 py-0.5 rounded ${cls}`}>
      {letter} {our}-{opp}
    </span>
  );
}

export default function Dashboard() {
  const { data: games = [] } = useListGames();
  const { teamName } = useTeamSettings();
  const { data: seasonStats } = useGetSeasonStats();
  const { data: playerStats = [] } = useGetPlayerStats();
  // Default true — coaches who haven't toggled it yet see the score, matching
  // legacy behavior. While prefs are loading we err on the side of showing.
  const { data: prefs } = useGetPreferences();
  const showFairness = prefs?.showFairnessScore ?? true;

  const actualGames = games.filter((g) => g.type === "game");
  const completedGames = actualGames.filter((g) => g.status === "completed");
  // Only games whose scheduled time is still in the future. Past-dated games
  // that were never marked complete fall out of this list (they show on the
  // Games page under "Past" instead).
  const upcomingGames = games.filter((g) => isTrulyUpcoming(g));
  // Win/loss/tie tally. A completed game whose recorded scores are equal
  // counts as a tie (T) — important for tournaments where a 7-7 game IS a
  // legitimate result, not a loss. Record displays as "W-L" when there are
  // no ties, "W-L-T" once any tie exists, matching standard baseball usage.
  const scoredGames = completedGames.filter(
    (g) => g.ourScore != null && g.opponentScore != null,
  );
  const wins = scoredGames.filter((g) => (g.ourScore ?? 0) > (g.opponentScore ?? 0)).length;
  const losses = scoredGames.filter((g) => (g.ourScore ?? 0) < (g.opponentScore ?? 0)).length;
  const ties = scoredGames.filter((g) => (g.ourScore ?? 0) === (g.opponentScore ?? 0)).length;
  const recordText = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  const recordSubtext = ties > 0 ? "W-L-T this season" : "W-L this season";

  // "Today / Up Next" hero card. Picks the soonest FUTURE game so loading the
  // app on game day surfaces the right game with one tap to the Field Display.
  //
  // Two-tier strategy so a forgotten un-completed game from last week doesn't
  // hijack the hero slot away from a real upcoming game:
  //  1) Prefer the soonest truly-upcoming game (date >= now). Sorted ascending
  //     so today's game beats next week's.
  //  2) Only if nothing is scheduled going forward, fall back to the MOST
  //     RECENT past-uncompleted game so the coach can close it out (score it,
  //     mark cancelled, etc.). Sorted descending here.
  const heroGame = (() => {
    const upcoming = actualGames
      .filter((g) => isTrulyUpcoming(g))
      .map((g) => ({ g, when: new Date(g.gameDate).getTime() }))
      .sort((a, b) => a.when - b.when);
    if (upcoming[0]) return upcoming[0].g;

    const pastUnfinished = actualGames
      .filter((g) => isPastUnrecorded(g))
      .map((g) => ({ g, when: new Date(g.gameDate).getTime() }))
      .sort((a, b) => b.when - a.when);
    return pastUnfinished[0]?.g ?? null;
  })();
  const heroDate = heroGame ? new Date(heroGame.gameDate) : null;
  // If we fell back to a past-uncompleted game (because there are no future
  // ones), call it out instead of mis-labeling it "Up Next" — the coach needs
  // to either record a result or cancel it.
  const heroIsPast = heroGame ? isPastUnrecorded(heroGame) : false;
  const heroLabel = heroDate
    ? heroIsPast
      ? "Needs Result"
      : isToday(heroDate)
        ? "Today's Game"
        : isTomorrow(heroDate)
          ? "Tomorrow's Game"
          : "Up Next"
    : "";

  const mostBenchPlayer = playerStats
    .filter((p) => p.totalInnings > 0)
    .sort((a, b) => b.benchInnings / (b.totalInnings || 1) - a.benchInnings / (a.totalInnings || 1))[0];

  const { data: tasks = [] } = useListDashboardTasks();
  // Game creation is a write — partial+ tiers see the button. View-only
  // coaches don't (it would 403 anyway).
  const { can } = usePermission();
  const canCreateGame = can("partial");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow text-primary/70">Coach Console</div>
          <h1 className="page-title text-foreground mt-1">Season Dashboard</h1>
          <p className="text-muted-foreground mt-2 text-sm">Track your team's progress and fairness</p>
        </div>
        {canCreateGame && (
          <Link href="/games/new">
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-broadcast uppercase tracking-wider shadow-md"
              data-testid="button-add-game"
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              Add Game
            </Button>
          </Link>
        )}
      </div>

      {/*
       * Today / Up Next hero — broadcast "lower-third" treatment. Deep navy
       * panel, gold top strip, Oswald uppercase opponent name, Roboto Mono
       * numeric date. Mirrors the Field Display chrome so the dashboard
       * feels like part of the same broadcast product on game day.
       */}
      {heroGame && heroDate && (
        <Card
          className="relative overflow-hidden border-0 p-0 shadow-[0_8px_32px_rgba(15,23,42,0.18)]"
          data-testid="card-hero-game"
        >
          {/* Gold stripe — broadcast accent. */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-broadcast-gold z-10" />
          {/* Navy backdrop with subtle radial highlight. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at top left, hsl(220 85% 28%) 0%, hsl(220 85% 18%) 55%, hsl(220 85% 14%) 100%)",
            }}
          />
          {/* Subtle diagonal grid overlay for sports-graphic texture. */}
          <div
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, transparent 0 14px, #fff 14px 15px)",
            }}
          />
          <CardContent className="relative p-6 sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="eyebrow text-broadcast-gold">{heroLabel}</span>
                  <span className="h-px w-10 bg-broadcast-gold/40" />
                </div>
                <div className="mt-2 flex items-baseline gap-2 sm:gap-3 min-w-0 flex-wrap">
                  {/* Full settings team name on the left, "vs." separator,
                      auto-shortened opponent (city) on the right. Tooltip
                      preserves the full official opponent name so coaches
                      can confirm the matchup. */}
                  <span
                    className="font-broadcast uppercase tracking-wider text-3xl sm:text-5xl font-bold text-white truncate leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
                    title={teamName || undefined}
                  >
                    {teamName || "Team"}
                  </span>
                  <span className="text-white/60 font-broadcast uppercase tracking-widest text-base sm:text-lg leading-none">
                    vs.
                  </span>
                  <span
                    className="font-broadcast uppercase tracking-wider text-3xl sm:text-5xl font-bold text-broadcast-gold truncate leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
                    title={heroGame.opponent ?? undefined}
                  >
                    {formatOpponentForMatchup(heroGame.opponent, teamName) || heroGame.opponent}
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-4 sm:gap-6 flex-wrap">
                  <span className="flex items-center gap-2 text-white">
                    <CalendarDays className="h-4 w-4 text-broadcast-gold/80" />
                    <span className="font-numeric text-sm sm:text-base">
                      {format(heroDate, "EEE · MMM d · h:mm a")}
                    </span>
                  </span>
                  {heroGame.location && (
                    <span className="flex items-center gap-2 text-white/85">
                      <MapPin className="h-4 w-4 text-broadcast-gold/80" />
                      <span className="text-sm sm:text-base">{heroGame.location}</span>
                    </span>
                  )}
                  <span className="flex items-center gap-2 px-2.5 py-0.5 rounded-sm bg-white/10 border border-white/20">
                    <span className="font-numeric text-sm text-white">{heroGame.innings}</span>
                    <span className="eyebrow text-white/60">innings</span>
                  </span>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                {!heroIsPast && (
                  <Button
                    size="lg"
                    className="bg-broadcast-gold text-broadcast-navy hover:bg-amber-300 font-broadcast uppercase tracking-wider shadow-[0_4px_16px_rgba(251,191,36,0.35)] border-0"
                    onClick={() =>
                      window.open(
                        `${BASE}/games/${heroGame.id}/display`,
                        "_blank",
                        "noopener",
                      )
                    }
                    data-testid="button-hero-field-display"
                    title="Open the dugout / fence-iPad display in a new tab"
                  >
                    <Tv className="h-5 w-5 mr-2" />
                    Open Field Display
                  </Button>
                )}
                <Link href={`/games/${heroGame.id}`}>
                  <Button
                    size="lg"
                    variant="outline"
                    className={
                      heroIsPast
                        ? "w-full sm:w-auto bg-broadcast-gold text-broadcast-navy hover:bg-amber-300 border-0 font-broadcast uppercase tracking-wider shadow-[0_4px_16px_rgba(251,191,36,0.35)]"
                        : "w-full sm:w-auto bg-transparent text-white border-white/40 hover:bg-white/10 hover:text-white font-broadcast uppercase tracking-wider"
                    }
                    data-testid="button-hero-open-game"
                  >
                    {heroIsPast ? "Record Result" : "Open Game"}
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Coaching tasks (only renders when the coach has open items, so a
          fresh account stays clean). */}
      {tasks.length > 0 && <TasksCard tasks={tasks} />}

      {/*
       * Broadcast-style stat cards. Big Roboto Mono numerals, Oswald uppercase
       * labels, thin gold top stripe — feels like a TV-graphics scorebug
       * dashboard rather than a generic admin panel.
       */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <BroadcastStatCard
          label="Total Games"
          value={actualGames.length}
          subtext={`${completedGames.length} completed`}
          icon={CalendarDays}
        />
        <BroadcastStatCard
          label="Record"
          value={recordText}
          subtext={recordSubtext}
          icon={Trophy}
          accent={wins > losses ? "win" : "neutral"}
        />
        {showFairness && (
          <BroadcastStatCard
            label="Fairness Score"
            value={seasonStats?.fairnessScore ?? "--"}
            subtext="Playing time equity"
            icon={Shield}
            accent={
              (seasonStats?.fairnessScore ?? 0) >= 80
                ? "win"
                : (seasonStats?.fairnessScore ?? 0) >= 60
                  ? "warn"
                  : "loss"
            }
            testId="card-fairness-score"
            info={
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="How is the Fairness Score calculated?"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="tooltip-fairness-info"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-left leading-relaxed">
                  <p className="font-semibold mb-1">How this is calculated</p>
                  <p>
                    For every active player we compute their bench rate
                    (innings sat ÷ innings played) across all completed
                    games. The score is{" "}
                    <span className="font-mono">100 − stddev × 200</span>.
                    100 means every player has been benched the same
                    fraction of the time. The score drops as some players
                    sit noticeably more than others. Practices and
                    uncompleted games don't count.
                  </p>
                </TooltipContent>
              </Tooltip>
            }
          />
        )}
        <BroadcastStatCard
          label="Active Players"
          value={playerStats.length}
          subtext="On the roster"
          icon={Users}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming Games */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Upcoming Games</CardTitle>
            <Link href="/games">
              <Button variant="ghost" size="sm" className="text-primary text-xs gap-1">
                View all <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {upcomingGames.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">No upcoming games scheduled</p>
            ) : (
              <div className="flex flex-col gap-3">
                {upcomingGames.slice(0, 4).map((g) => (
                  <Link key={g.id} href={`/games/${g.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer border border-border/50">
                      <div>
                        <div className="font-medium text-sm truncate" title={g.opponent ?? undefined}>{shortenTeamName(teamName) || teamName || "Team"} vs. {formatOpponentForMatchup(g.opponent, teamName) || g.opponent}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(g.gameDate), "EEE, MMM d")} {g.location ? `· ${g.location}` : ""}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">{g.innings} inn.</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Results */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Recent Results</CardTitle>
            <Link href="/stats">
              <Button variant="ghost" size="sm" className="text-primary text-xs gap-1">
                Stats <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {completedGames.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">No completed games yet</p>
            ) : (
              <div className="flex flex-col gap-3">
                {[...completedGames].reverse().slice(0, 4).map((g) => (
                  <Link key={g.id} href={`/games/${g.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer border border-border/50">
                      <div>
                        <div className="font-medium text-sm truncate" title={g.opponent ?? undefined}>{shortenTeamName(teamName) || teamName || "Team"} vs. {formatOpponentForMatchup(g.opponent, teamName) || g.opponent}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{format(new Date(g.gameDate), "MMM d, yyyy")}</div>
                      </div>
                      <ScoreBadge our={g.ourScore} opp={g.opponentScore} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Playing Time Alert */}
        {mostBenchPlayer && mostBenchPlayer.benchInnings > 0 && (
          <Card className="border-yellow-200 bg-yellow-50 lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-yellow-800 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Playing Time Heads Up
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-yellow-700">
                <strong>{mostBenchPlayer.playerName}</strong> has sat on the bench the most this season 
                ({mostBenchPlayer.benchInnings} innings). Consider prioritizing their field time in the next game.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

const TASK_LABEL: Record<DashboardTask["type"], string> = {
  score: "Score not logged",
  pitch_counts: "Pitch counts not logged",
  box_score: "Box score not imported",
};

/**
 * Open coaching tasks list. Each row links to the relevant game (with a
 * deep-link hash for pitch-count tasks) and offers an Ignore button that
 * permanently hides the row from this dashboard.
 *
 * Optimistic remove: dismissing toggles the row out of the list before
 * the server responds, so the card feels instant. The query refetches on
 * success to reconcile the canonical state.
 */
function TasksCard({ tasks }: { tasks: DashboardTask[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { teamName } = useTeamSettings();

  const dismiss = useDismissDashboardTask({
    mutation: {
      onMutate: async (vars) => {
        await qc.cancelQueries({ queryKey: getListDashboardTasksQueryKey() });
        const prev = qc.getQueryData<DashboardTask[]>(
          getListDashboardTasksQueryKey(),
        );
        qc.setQueryData<DashboardTask[]>(
          getListDashboardTasksQueryKey(),
          (old) =>
            (old ?? []).filter(
              (t) =>
                !(t.gameId === vars.data.gameId && t.type === vars.data.taskType),
            ),
        );
        return { prev };
      },
      onError: (err, _vars, ctx) => {
        if (ctx?.prev) {
          qc.setQueryData(getListDashboardTasksQueryKey(), ctx.prev);
        }
        toast({
          title: "Could not dismiss task",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      },
      onSettled: () => {
        void qc.invalidateQueries({
          queryKey: getListDashboardTasksQueryKey(),
        });
      },
    },
  });

  return (
    <Card data-testid="card-dashboard-tasks">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          Tasks
          <span className="text-xs font-normal text-muted-foreground">
            ({tasks.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/60 hover:border-border transition-colors"
            data-testid={`row-task-${t.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate" title={t.opponent ?? undefined}>
                {shortenTeamName(teamName) || teamName || "Team"} vs. {formatOpponentForMatchup(t.opponent, teamName) || t.opponent}
                <span className="text-xs text-muted-foreground font-normal ml-2">
                  {format(new Date(t.gameDate), "MMM d, yyyy")}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {TASK_LABEL[t.type]}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                // Use navigate so the hash fragment (#pitch-counts-card) is
                // preserved — wouter's <Link> drops the hash on `href`.
                onClick={() => navigate(t.link)}
                data-testid={`button-task-open-${t.id}`}
              >
                Open
                <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  dismiss.mutate({
                    data: { gameId: t.gameId, taskType: t.type },
                  })
                }
                disabled={dismiss.isPending}
                title="Hide this task permanently"
                data-testid={`button-task-ignore-${t.id}`}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Ignore
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
