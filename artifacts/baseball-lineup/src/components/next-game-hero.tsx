import { Link } from "wouter";
import { format, isToday, isTomorrow } from "date-fns";
import { CalendarDays, ChevronRight, MapPin, Tv } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isPastUnrecorded, isTrulyUpcoming } from "@/lib/game-status";
import {
  shortenTeamName,
  formatOpponentForMatchup,
} from "@/lib/team-name";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type HeroGame = {
  id: number;
  opponent: string | null | undefined;
  gameDate: string | Date;
  location?: string | null;
  innings: number;
  type?: string | null;
  status?: string | null;
};

/**
 * Pick the soonest truly-upcoming game; if none, fall back to the
 * MOST RECENT past-uncompleted game (so the coach can close it out).
 * Mirrors the original dashboard logic so both surfaces agree on
 * which game is "next".
 */
export function pickHeroGame<T extends HeroGame>(games: T[]): T | null {
  const actualGames = games.filter((g) => (g.type ?? "game") === "game");
  const upcoming = actualGames
    .filter((g) => isTrulyUpcoming(g as never))
    .map((g) => ({ g, when: new Date(g.gameDate).getTime() }))
    .sort((a, b) => a.when - b.when);
  if (upcoming[0]) return upcoming[0].g;
  const pastUnfinished = actualGames
    .filter((g) => isPastUnrecorded(g as never))
    .map((g) => ({ g, when: new Date(g.gameDate).getTime() }))
    .sort((a, b) => b.when - a.when);
  return pastUnfinished[0]?.g ?? null;
}

export function getHeroLabel(date: Date, isPast: boolean) {
  if (isPast) return "Needs Result";
  if (isToday(date)) return "Today's Game";
  if (isTomorrow(date)) return "Tomorrow's Game";
  return "Up Next";
}

/**
 * Broadcast "lower-third" hero card. Used by the dashboard and the
 * schedule page so the soonest game gets the same TV-graphic
 * treatment everywhere it appears. Stateless — caller picks the game
 * and supplies the team name.
 */
export function NextGameHero({
  game,
  teamName,
  testId = "card-hero-game",
}: {
  game: HeroGame;
  teamName: string;
  testId?: string;
}) {
  const date = new Date(game.gameDate);
  const isPast = isPastUnrecorded(game as never);
  const label = getHeroLabel(date, isPast);

  return (
    <Card
      className="relative overflow-hidden border-0 p-0 shadow-[0_8px_32px_rgba(15,23,42,0.18)]"
      data-testid={testId}
    >
      {/* Gold stripe — broadcast accent. */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-broadcast-gold z-10" />
      {/* Navy backdrop with subtle radial highlight. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at top left, var(--brand-ll) 0%, var(--brand-d) 55%, var(--brand-dd) 100%)",
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
              <span className="eyebrow text-broadcast-gold">{label}</span>
              <span className="h-px w-10 bg-broadcast-gold/40" />
            </div>
            <div className="mt-2 flex items-baseline gap-2 sm:gap-3 min-w-0 flex-wrap">
              <span
                className="font-broadcast uppercase tracking-wider text-3xl sm:text-5xl font-bold text-white truncate leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
                title={teamName || undefined}
              >
                {shortenTeamName(teamName) || teamName || "Team"}
              </span>
              <span className="text-white/60 font-broadcast uppercase tracking-widest text-base sm:text-lg leading-none">
                vs.
              </span>
              <span
                className="font-broadcast uppercase tracking-wider text-3xl sm:text-5xl font-bold text-broadcast-gold truncate leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
                title={game.opponent ?? undefined}
              >
                {formatOpponentForMatchup(game.opponent ?? null, teamName) ||
                  game.opponent}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-4 sm:gap-6 flex-wrap">
              <span className="flex items-center gap-2 text-white">
                <CalendarDays className="h-4 w-4 text-broadcast-gold/80" />
                <span className="font-numeric text-sm sm:text-base">
                  {format(date, "EEE · MMM d · h:mm a")}
                </span>
              </span>
              {game.location && (
                <span className="flex items-center gap-2 text-white/85">
                  <MapPin className="h-4 w-4 text-broadcast-gold/80" />
                  <span className="text-sm sm:text-base">{game.location}</span>
                </span>
              )}
              <span className="flex items-center gap-2 px-2.5 py-0.5 rounded-sm bg-white/10 border border-white/20">
                <span className="font-numeric text-sm text-white">
                  {game.innings}
                </span>
                <span className="eyebrow text-white/60">innings</span>
              </span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
            {!isPast && (
              <Button
                size="lg"
                className="bg-broadcast-gold text-broadcast-navy hover:bg-amber-300 font-broadcast uppercase tracking-wider shadow-[0_4px_16px_rgba(251,191,36,0.35)] border-0"
                onClick={() =>
                  window.open(
                    `${BASE}/games/${game.id}/display`,
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
            <Link href={`/games/${game.id}`}>
              <Button
                size="lg"
                variant="outline"
                className={
                  isPast
                    ? "w-full sm:w-auto bg-broadcast-gold text-broadcast-navy hover:bg-amber-300 border-0 font-broadcast uppercase tracking-wider shadow-[0_4px_16px_rgba(251,191,36,0.35)]"
                    : "w-full sm:w-auto bg-transparent text-white border-white/40 hover:bg-white/10 hover:text-white font-broadcast uppercase tracking-wider"
                }
                data-testid="button-hero-open-game"
              >
                {isPast ? "Record Result" : "Open Game"}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
