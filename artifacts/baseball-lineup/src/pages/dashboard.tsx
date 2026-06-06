import { Link, useLocation } from "wouter";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGames,
  useListPlayers,
  useGetSeasonStats,
  useGetPlayerStats,
  useGetPreferences,
  useListDashboardTasks,
  useDismissDashboardTask,
  useDismissTournamentNetworkSuggestions,
  getListDashboardTasksQueryKey,
  type DashboardTask,
  type Game,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BoxScoreImportDialog } from "@/components/box-score-import-dialog";
import { CalendarDays, Users, Trophy, TrendingUp, ChevronRight, Shield, Tv, ClipboardList, X, Info, FileText, Check, Circle, Sparkles, Wand2 } from "lucide-react";
import { NextGameHero } from "@/components/next-game-hero";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { BroadcastStatCard } from "@/components/broadcast-stat-card";
import { HelpCard } from "@/components/help-card";
import { format } from "date-fns";
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
  const { data: playerStats = [], isSuccess: playerStatsLoaded } =
    useGetPlayerStats();
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
  // <NextGameHero/> computes its own label + isPast badge from the
  // game it receives, so we just need to know whether to render it.

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="eyebrow text-primary/70">Coach Console</div>
          <h1 className="page-title text-foreground mt-1">Season Dashboard</h1>
          <p className="text-muted-foreground mt-2 text-sm">Track your team's progress and fairness</p>
        </div>
        {canCreateGame && (
          <Link href="/games/new" className="shrink-0">
            <Button
              className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 font-broadcast uppercase tracking-wider shadow-md"
              data-testid="button-add-game"
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              Add Game
            </Button>
          </Link>
        )}
      </div>

      {/*
       * Today / Up Next hero — broadcast "lower-third" treatment. Shared
       * with the Schedule page so the soonest game gets the same TV-graphic
       * treatment everywhere it appears. See <NextGameHero/>.
       */}
      {heroGame && (
        <NextGameHero game={heroGame} teamName={teamName ?? ""} />
      )}

      {/* "Get started" checklist — auto-disappears once the coach
          has a roster, at least one game on the books, AND at
          least one completed game (= they've actually used the app
          for what it's for). Serves two audiences:
            1) Brand-new coaches who just signed up — the empty
               dashboard has nothing to do, so this is their map.
               First step deep-links to /welcome so they get the
               full guided wizard, not a bare /players page.
            2) Coaches who signed up but stalled (e.g. added roster
               but never scheduled a game) — every dashboard visit
               re-surfaces the exact next step instead of leaving
               them to guess.
          The single inline "Do it now" button is wired to the
          first INCOMPLETE step so the call to action is always
          unambiguous. The card hides itself the moment all three
          rows are checked — we don't want lifelong nagging once
          they're in the flow. */}
      {canCreateGame && playerStatsLoaded && (() => {
        const hasRoster = playerStats.length > 0;
        const hasGames = actualGames.length > 0;
        const hasCompleted = completedGames.length > 0;
        if (hasRoster && hasGames && hasCompleted) return null;
        // Pick the most useful destination for the "Play your first
        // game" step:
        //  - past-unrecorded game → score it (closes the loop)
        //  - upcoming game → open Field Display (next thing they'll do)
        //  - nothing yet → no link, just hint copy
        const pastUnrecorded = actualGames
          .filter((g) => isPastUnrecorded(g))
          .sort(
            (a, b) =>
              new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime(),
          )[0];
        const nextUpcoming = actualGames
          .filter((g) => isTrulyUpcoming(g))
          .sort(
            (a, b) =>
              new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime(),
          )[0];
        type Step = {
          done: boolean;
          label: string;
          hint: string;
          cta: { href: string; label: string } | null;
        };
        const steps: Step[] = [
          {
            done: hasRoster,
            label: "Add your roster",
            hint: "Type a list, paste from a doc, or upload a screenshot — the AI splits names, numbers, and positions for you.",
            cta: { href: "/welcome", label: "Start setup" },
          },
          {
            done: hasGames,
            label: "Schedule your first game",
            hint: "Add one manually, or paste your league's iCal/webcal URL to import the whole season.",
            cta: { href: "/games/new", label: "Add a game" },
          },
          {
            done: hasCompleted,
            label: "Play and score a game",
            hint: pastUnrecorded
              ? "Looks like you've got a past game without a score yet — close the loop."
              : nextUpcoming
                ? "Use Field Display to manage positions inning by inning, then record the score."
                : "Once a game is on the books, you'll generate lineups and score it from here.",
            cta: pastUnrecorded
              ? { href: `/games/${pastUnrecorded.id}`, label: "Score it" }
              : nextUpcoming
                ? {
                    href: `/games/${nextUpcoming.id}/display`,
                    label: "Open Field Display",
                  }
                : null,
          },
        ];
        const doneCount = steps.filter((s) => s.done).length;
        // The CTA button is bound to the FIRST incomplete step. If
        // none has a destination (e.g. step 3 with no games yet
        // when step 1 is already complete), the card still shows
        // the checklist — it's a status surface, not just a CTA.
        const firstUndone = steps.find((s) => !s.done && s.cta != null);
        return (
          <Card
            className="border-primary/30 bg-primary/5"
            data-testid="card-get-started"
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Get started with Lineup Lab
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  ({doneCount} of {steps.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Use a proper group + checkbox roles so screen
                  readers announce "Add your roster, checked" /
                  "unchecked" for each step instead of just reading
                  the label and silently ignoring the visual
                  check-mark / line-through. The list itself is the
                  group; each row is a non-interactive checkbox
                  (these aren't toggleable — completion is derived
                  from app state — but `aria-checked` + `role` is
                  still the most accurate semantics for "binary
                  status per row"). */}
              <ul
                role="group"
                aria-label="Getting started steps"
                className="space-y-2.5"
              >
                {steps.map((s, i) => (
                  <li
                    key={s.label}
                    role="checkbox"
                    aria-checked={s.done}
                    aria-label={`${s.label}, ${s.done ? "completed" : "not yet completed"}`}
                    className="flex items-start gap-2.5"
                    data-testid={`getstarted-step-${i}`}
                  >
                    {s.done ? (
                      <span
                        aria-hidden="true"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    ) : (
                      <Circle
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 text-muted-foreground/60"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className={
                          s.done
                            ? "text-sm font-medium text-muted-foreground line-through"
                            : "text-sm font-medium text-foreground"
                        }
                      >
                        {s.label}
                      </div>
                      {!s.done && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {s.hint}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-3 pt-1">
                {/* "Guided tour" escape hatch — even if step 1 is
                    done, a stalled coach can still revisit the full
                    7-step wizard for invites, colors, etc. */}
                <Link href="/welcome">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs gap-1 text-muted-foreground hover:text-foreground"
                    data-testid="button-getstarted-tour"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    Take the guided tour
                  </Button>
                </Link>
                {firstUndone?.cta && (
                  <Link href={firstUndone.cta.href}>
                    <Button size="sm" data-testid="button-getstarted-cta">
                      {firstUndone.cta.label}
                      <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                    </Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Coaching tasks (only renders when the coach has open items, so a
          fresh account stays clean). */}
      {tasks.length > 0 && <TasksCard tasks={tasks} games={actualGames} />}

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
                  <div
                    key={g.id}
                    className="flex items-center gap-2 p-3 rounded-lg hover:bg-accent/50 transition-colors border border-border/50"
                  >
                    <Link
                      href={`/games/${g.id}`}
                      className="flex-1 min-w-0 cursor-pointer"
                    >
                      <div className="font-medium text-sm truncate" title={g.opponent ?? undefined}>{shortenTeamName(teamName) || teamName || "Team"} vs. {formatOpponentForMatchup(g.opponent, teamName) || g.opponent}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(g.gameDate), "EEE, MMM d")} {g.location ? `· ${g.location}` : ""}
                      </div>
                    </Link>
                    <div className="text-xs text-muted-foreground hidden sm:block shrink-0">{g.innings} inn.</div>
                    {/* Quick Field Display launcher — opens the live dugout
                     *  display in a new tab without leaving the dashboard.
                     *  Sibling to (not nested in) the Link so the click
                     *  doesn't navigate to /games/:id first. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-8 px-2 text-muted-foreground hover:text-broadcast-navy"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`${BASE}/games/${g.id}/display`, "_blank", "noopener");
                      }}
                      data-testid={`button-upcoming-field-display-${g.id}`}
                      title="Open Field Display in a new tab"
                      aria-label="Open Field Display"
                    >
                      <Tv className="h-4 w-4" />
                    </Button>
                  </div>
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

        {/* Ask-the-app FAQ — sits at the bottom so it's a discoverable
            "I'm stuck" escape hatch without competing with the primary
            dashboard cards above. Spans both columns on large screens. */}
        <div className="lg:col-span-2">
          <HelpCard />
        </div>

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
  tournament_network: "Other coaches added this tournament",
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
function TasksCard({ tasks, games }: { tasks: DashboardTask[]; games: Game[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { teamName } = useTeamSettings();
  // Box-score import dialog state — opened inline from a `box_score`
  // task row so coaches don't have to navigate into the game first.
  // Players list is fetched lazily (only when a row is opened) since
  // most dashboard sessions never touch this card.
  const [boxScoreGameId, setBoxScoreGameId] = useState<number | null>(null);
  // Players list is needed for the import dialog's name-matching UI;
  // we keep the fetch always-on (cheap, already cached by other pages
  // most of the time) so opening the dialog is instant.
  const { data: players = [] } = useListPlayers();

  // Tournament-network task rows dismiss through the per-tournament
  // network dismiss endpoint, not the shared dashboard dismiss (which
  // is gameId-scoped). Both share the same optimistic-remove pattern.
  const dismissTournamentNetwork = useDismissTournamentNetworkSuggestions();

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
                !(t.gameId != null && t.gameId === vars.data.gameId && t.type === vars.data.taskType),
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
            className="flex flex-col gap-2 p-3 rounded-lg border border-border/60 hover:border-border transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            data-testid={`row-task-${t.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate" title={t.opponent ?? undefined}>
                {/* Tournament-network rows reuse the `opponent` field to
                    carry the tournament name — render it bare instead
                    of the "<team> vs. <opponent>" format used for game
                    tasks. */}
                {t.type === "tournament_network" ? (
                  <>{t.opponent}</>
                ) : (
                  <>
                    {shortenTeamName(teamName) || teamName || "Team"} vs.{" "}
                    {formatOpponentForMatchup(t.opponent, teamName) || t.opponent}
                  </>
                )}
                <span className="text-xs text-muted-foreground font-normal ml-2">
                  {format(new Date(t.gameDate), "MMM d, yyyy")}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {TASK_LABEL[t.type]}
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 flex-wrap shrink-0">
              {t.type === "score" && t.gameId != null && (
                // One-tap "enter the final score" — drops the coach
                // straight into the score-entry dialog on the game page
                // (via `?complete=1`) so the missing score is the first
                // thing they see.
                <Button
                  size="sm"
                  variant="default"
                  className="h-8"
                  onClick={() => navigate(`/games/${t.gameId}?complete=1`)}
                  data-testid={`button-task-score-${t.id}`}
                >
                  Score it
                </Button>
              )}
              {t.type === "box_score" && (
                // One-tap import — opens the existing GameChanger dialog
                // right here on the dashboard so a coach finishing a game
                // can clear the reminder without first navigating into
                // the game detail page.
                <Button
                  size="sm"
                  variant="default"
                  className="h-8"
                  onClick={() => t.gameId != null && setBoxScoreGameId(t.gameId)}
                  data-testid={`button-task-import-box-score-${t.id}`}
                >
                  <FileText className="h-3.5 w-3.5 mr-1" />
                  Import
                </Button>
              )}
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
                onClick={() => {
                  if (t.type === "tournament_network" && t.tournamentId != null) {
                    // Tournament tasks dismiss through the network
                    // endpoint (stamps `networkPromptDismissedAt` on
                    // the tournament row) — task_dismissals is gameId-
                    // scoped and can't represent these.
                    dismissTournamentNetwork.mutate(
                      { id: t.tournamentId },
                      {
                        onSuccess: () =>
                          void qc.invalidateQueries({
                            queryKey: getListDashboardTasksQueryKey(),
                          }),
                      },
                    );
                  } else if (t.gameId != null && t.type !== "tournament_network") {
                    dismiss.mutate({
                      data: { gameId: t.gameId, taskType: t.type },
                    });
                  }
                }}
                disabled={dismiss.isPending || dismissTournamentNetwork.isPending}
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
      {boxScoreGameId != null && (() => {
        // Look up the game's scheduled length so the dialog's
        // "Last inning played" picker is bounded correctly. Falls
        // back to 6 (app default) if the game isn't in the cached
        // list — should be vanishingly rare since `box_score` tasks
        // are derived from the same query.
        const innings =
          games.find((g) => g.id === boxScoreGameId)?.innings ?? 6;
        return (
          <BoxScoreImportDialog
            gameId={boxScoreGameId}
            gameInnings={innings}
            players={players}
            open={boxScoreGameId != null}
            onOpenChange={(o) => !o && setBoxScoreGameId(null)}
          />
        );
      })()}
    </Card>
  );
}
