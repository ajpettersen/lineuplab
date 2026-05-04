import { Link } from "wouter";
import { useListGames, useGetSeasonStats, useGetPlayerStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, Users, Trophy, TrendingUp, ChevronRight, Shield, Tv, MapPin } from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import { isTrulyUpcoming, isPastUnrecorded } from "@/lib/game-status";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function ScoreBadge({ our, opp }: { our: number | null | undefined; opp: number | null | undefined }) {
  if (our == null || opp == null) return null;
  const won = our > opp;
  return (
    <span className={`text-sm font-bold px-2 py-0.5 rounded ${won ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
      {won ? "W" : "L"} {our}-{opp}
    </span>
  );
}

export default function Dashboard() {
  const { data: games = [] } = useListGames();
  const { data: seasonStats } = useGetSeasonStats();
  const { data: playerStats = [] } = useGetPlayerStats();

  const actualGames = games.filter((g) => g.type === "game");
  const completedGames = actualGames.filter((g) => g.status === "completed");
  // Only games whose scheduled time is still in the future. Past-dated games
  // that were never marked complete fall out of this list (they show on the
  // Games page under "Past" instead).
  const upcomingGames = games.filter((g) => isTrulyUpcoming(g));
  const wins = completedGames.filter((g) => (g.ourScore ?? 0) > (g.opponentScore ?? 0)).length;

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Season Dashboard</h1>
          <p className="text-muted-foreground mt-1">Track your team's progress and fairness</p>
        </div>
        <Link href="/games/new">
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <CalendarDays className="h-4 w-4 mr-2" />
            Add Game
          </Button>
        </Link>
      </div>

      {/*
       * Today / Up Next hero card. Most prominent surface in the app on game
       * day — gives the coach a one-tap launch of the dugout-fence display
       * without having to drill into the game.
       */}
      {heroGame && heroDate && (
        <Card
          className="border-2 border-primary/30 bg-gradient-to-br from-primary/[0.06] via-background to-accent/[0.04] shadow-sm"
          data-testid="card-hero-game"
        >
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <div className="hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <CalendarDays className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.18em] font-semibold text-primary">
                    {heroLabel}
                  </div>
                  <div className="mt-1 text-2xl sm:text-3xl font-bold text-foreground truncate">
                    vs. {heroGame.opponent}
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {format(heroDate, "EEE, MMM d · h:mm a")}
                    </span>
                    {heroGame.location && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" />
                        {heroGame.location}
                      </span>
                    )}
                    <span className="text-xs">{heroGame.innings} innings</span>
                  </div>
                </div>
              </div>
              {/*
               * CTAs swap based on whether the hero is upcoming or a past
               * fallback. Upcoming game day → Field Display is primary (one tap
               * to the dugout iPad). Past-uncompleted fallback → coach needs
               * to score it / cancel it, so Open Game becomes primary and the
               * Field Display button drops out (irrelevant for a played game).
               */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                {!heroIsPast && (
                  <Button
                    size="lg"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
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
                    variant={heroIsPast ? "default" : "outline"}
                    className={
                      heroIsPast
                        ? "w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                        : "w-full sm:w-auto"
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

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Games</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{actualGames.length}</div>
            <p className="text-xs text-muted-foreground mt-1">{completedGames.length} completed</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Record</CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{wins}-{completedGames.length - wins}</div>
            <p className="text-xs text-muted-foreground mt-1">W-L this season</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fairness Score</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${(seasonStats?.fairnessScore ?? 0) >= 80 ? "text-green-700" : (seasonStats?.fairnessScore ?? 0) >= 60 ? "text-yellow-600" : "text-destructive"}`}>
              {seasonStats?.fairnessScore ?? "--"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Playing time equity</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Players</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{playerStats.length}</div>
            <p className="text-xs text-muted-foreground mt-1">On the roster</p>
          </CardContent>
        </Card>
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
                        <div className="font-medium text-sm">vs. {g.opponent}</div>
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
                        <div className="font-medium text-sm">vs. {g.opponent}</div>
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
