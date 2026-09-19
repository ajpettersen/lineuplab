import { AlertTriangle, MapPin, UserRound } from "lucide-react";

/**
 * Schedule extras the calendar sync fills in (see api-server
 * lib/ical-sync.ts + lib/umpires.ts). Not in the generated OpenAPI Game
 * type, so read them through this narrow shape.
 */
export type GameScheduleExtras = {
  gameDate: string;
  location: string | null;
  status: string;
  scheduleChangeNote?: string | null;
  scheduleChangedAt?: string | null;
  umpireOrg?: string | null;
  umpireName?: string | null;
};

export function extras(g: unknown): GameScheduleExtras {
  return g as GameScheduleExtras;
}

const CHANGE_BADGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Recent league-side change to a game that hasn't happened yet ("Moved from 12:00 PM to 1:00 PM"). */
export function ScheduleChangeNotice({ game, className = "" }: { game: GameScheduleExtras; className?: string }) {
  if (!game.scheduleChangeNote || !game.scheduleChangedAt) return null;
  if (Date.now() - new Date(game.scheduleChangedAt).getTime() > CHANGE_BADGE_MS) return null;
  if (new Date(game.gameDate).getTime() < Date.now() - 12 * 60 * 60 * 1000) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 ${className}`}
      title="Updated from your league's schedule"
    >
      <AlertTriangle className="h-3 w-3 shrink-0" />
      {game.scheduleChangeNote}
    </span>
  );
}

/** "Colin Rayner", "Not assigned yet", or just the association when names aren't published. */
export function umpireLabel(game: GameScheduleExtras): string | null {
  if (game.umpireName) return game.umpireName;
  if (game.umpireOrg) return game.umpireOrg;
  return null;
}

export function UmpireInfo({ game }: { game: GameScheduleExtras }) {
  const label = umpireLabel(game);
  if (!label) return null;
  return (
    <span className="flex items-center gap-1" title={game.umpireOrg ?? undefined}>
      <UserRound className="h-3.5 w-3.5" />
      Ump: {label}
    </span>
  );
}

export function mapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/**
 * Field name that opens directions. A button (not a link) because it
 * often sits inside a card that is itself a link to the game.
 */
export function FieldLink({ location }: { location: string }) {
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-primary hover:underline underline-offset-2"
      title="Directions"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(mapsUrl(location), "_blank", "noopener");
      }}
    >
      <MapPin className="h-3.5 w-3.5" />
      {location}
    </button>
  );
}
