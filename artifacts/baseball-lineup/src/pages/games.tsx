import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  useListGames,
  useDeleteGame,
  useListPlayers,
  getListGamesQueryKey,
} from "@workspace/api-client-react";
import { BoxScoreImportDialog } from "@/components/box-score-import-dialog";
import { EditGameDialog } from "@/components/edit-game-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CalendarDays,
  ChevronRight,
  MapPin,
  Trash2,
  Pencil,
  Link2,
  Tv,
  FileText,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { showUndoToast, restoreEntity } from "@/lib/undo-toast";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";
import { withSync } from "@/lib/sync-envelope";
import { isVersionConflict } from "@/lib/conflict-registry";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { effectiveStatus, type EffectiveStatus } from "@/lib/game-status";
import { shortenTeamName, formatOpponentForMatchup } from "@/lib/team-name";
import { NextGameHero, pickHeroGame } from "@/components/next-game-hero";
import { CalendarSyncBar, ConnectCalendarDialog, useCalendarSync } from "@/components/calendar-sync";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function StatusBadge({ status }: { status: EffectiveStatus }) {
  if (status === "completed") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>;
  if (status === "cancelled") return <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>;
  if (status === "past") return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Past</Badge>;
  return <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Upcoming</Badge>;
}

type Game = {
  id: number;
  opponent: string;
  gameDate: string;
  location: string | null;
  innings: number;
  status: string;
  type?: string;
  gameType?: "league" | "tournament" | null;
  ourScore: number | null;
  opponentScore: number | null;
  notes: string | null;
  boxScoreImportedAt?: string | null;
};

function GameTypeBadge({ gameType }: { gameType?: "league" | "tournament" | null }) {
  if (gameType === "league") return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">League</Badge>;
  if (gameType === "tournament") return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Tournament</Badge>;
  return null;
}

// ── Event type badge ─────────────────────────────────────────
type EventKind = "game" | "practice" | "other";
function TypeBadge({ type }: { type: EventKind | string }) {
  if (type === "practice") {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">Practice</Badge>;
  }
  if (type === "other") {
    return <Badge variant="outline" className="text-muted-foreground">Event</Badge>;
  }
  return null;
}

// ── Edit game dialog: see EditGameDialog imported from @/components/edit-game-dialog ─

// ── Main page ───────────────────────────────────────────────────
export default function Games() {
  const { data: games = [], isLoading } = useListGames();
  const { data: players = [] } = useListPlayers();
  const { teamName } = useTeamSettings();
  const deleteGame = useDeleteGame();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [boxScoreGameId, setBoxScoreGameId] = useState<number | null>(null);
  const [showIcal, setShowIcal] = useState(false);
  const calendar = useCalendarSync();
  const search = useSearch();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (new URLSearchParams(search).get("connect")) {
      setShowIcal(true);
      navigate("/games", { replace: true });
    }
  }, [search, navigate]);
  const [filter, setFilter] = useState<"all" | "game" | "practice" | "other">("all");

  const counts = games.reduce(
    (acc, g) => {
      const k = (g.type ?? "game") as "game" | "practice" | "other";
      acc[k] += 1;
      acc.all += 1;
      return acc;
    },
    { all: 0, game: 0, practice: 0, other: 0 },
  );

  const filtered = filter === "all" ? games : games.filter((g) => (g.type ?? "game") === filter);
  // Bucket by effective status: a stored "upcoming" game whose date has already
  // passed is shown under "Past" so it doesn't pretend to still be on the schedule.
  const upcoming = filtered.filter((g) => effectiveStatus(g) === "upcoming");
  const past = filtered.filter((g) => effectiveStatus(g) !== "upcoming").reverse();
  // Hero card mirrors the dashboard's "Up Next" treatment so the
  // soonest game gets the same broadcast graphic on the schedule
  // too. We pick from the WHOLE games list (not the filtered list)
  // so flipping to Practices / Events doesn't blow the hero away —
  // it stays anchored to the next actual game. We then drop that
  // game from the regular `upcoming` list so it doesn't render
  // twice when the All filter is active.
  const heroGame = pickHeroGame(games);
  const upcomingForList = heroGame
    ? upcoming.filter((g) => g.id !== heroGame.id)
    : upcoming;
  // Hero can fall back to a past-uncompleted game when nothing is
  // upcoming, so also strip it from the past list to avoid double
  // rendering.
  const pastForList = heroGame
    ? past.filter((g) => g.id !== heroGame.id)
    : past;

  const handleDelete = () => {
    if (!deleteId) return;
    const idToDelete = deleteId;
    // Pin the delete to the schedule row's current version — if another
    // coach edited this game since our list loaded, the server 409s and
    // the conflict tray lets us decide instead of silently deleting.
    const rowVersion = games.find((g) => g.id === idToDelete)?.rowVersion;
    deleteGame.mutate(
      withSync({ id: idToDelete }, rowVersion),
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          showUndoToast(toast, {
            title: "Game removed",
            onUndo: async () => {
              try {
                await restoreEntity("games", idToDelete);
                qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
                toast({ title: "Game restored" });
              } catch {
                toast({ title: "Couldn't undo", variant: "destructive" });
              }
            },
          });
        },
        onError: (err) => {
          // 409 conflicts are handled by the global ConflictListener
          // (toast + tray); a second "failed" toast here would read as
          // a bug rather than a resolvable conflict.
          if (isVersionConflict(err)) return;
          toastError(toast, "Failed to delete game", err);
        },
      }
    );
    setDeleteId(null);
  };

  const refresh = () => qc.invalidateQueries({ queryKey: getListGamesQueryKey() });

  // teamName is passed in explicitly (not closed over) because Vite's
  // react-refresh transform hoists inline arrow components to module
  // scope, breaking closure references.
  const GameCard = ({
    g,
    teamName,
    onViewBoxScore,
  }: {
    g: typeof games[0];
    teamName: string;
    onViewBoxScore: (id: number) => void;
  }) => (
    <Card className="border-border hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <Link href={`/games/${g.id}`}>
            <div className="flex-1 cursor-pointer group">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="font-semibold group-hover:text-primary transition-colors"
                  title={g.opponent ?? undefined}
                >
                  {g.type && g.type !== "game"
                    ? (formatOpponentForMatchup(g.opponent, teamName) || g.opponent)
                    : `${shortenTeamName(teamName) || teamName || "Team"} vs. ${formatOpponentForMatchup(g.opponent, teamName) || g.opponent}`}
                </span>
                <TypeBadge type={(g.type ?? "game") as EventKind} />
                <GameTypeBadge gameType={g.gameType as ("league" | "tournament" | null | undefined)} />
                <StatusBadge status={effectiveStatus(g)} />
                {g.status === "completed" && g.ourScore != null && g.opponentScore != null && (() => {
                  // Same-score completed games are ties (T), not losses.
                  // Tournaments routinely end in ties, and miscoding them as
                  // losses inflates the loss column on the dashboard record.
                  const tied = g.ourScore === g.opponentScore;
                  const won = g.ourScore > g.opponentScore;
                  const cls = tied
                    ? "bg-amber-100 text-amber-800"
                    : won
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800";
                  const letter = tied ? "T" : won ? "W" : "L";
                  return (
                    <span className={`text-sm font-bold px-2 py-0.5 rounded ${cls}`}>
                      {letter} {g.ourScore}-{g.opponentScore}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {format(new Date(g.gameDate), "EEE, MMM d, yyyy · h:mm a")}
                </span>
                {g.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {g.location}
                  </span>
                )}
                <span className="text-xs">{g.innings} innings</span>
              </div>
            </div>
          </Link>
          {/*
           * Action cluster. On phones the five-button row was a tap-target
           * mess (32 px buttons packed next to a wrapping title made it
           * easy to mis-tap delete). We now keep the most common actions
           * — Field Display + Open — visible at all sizes and collapse
           * Edit / View box score / Delete into a "…" overflow menu on
           * mobile. From `sm:` up the original five-button row is
           * restored so desktop habits are unchanged.
           */}
          <div className="flex items-center gap-1 ml-2">
            {g.type !== "practice" && g.type !== "other" && g.status !== "cancelled" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-primary"
                onClick={(e) => {
                  e.preventDefault();
                  window.open(`${BASE}/games/${g.id}/display`, "_blank", "noopener");
                }}
                title="Open the dugout / fence-iPad display in a new tab"
                data-testid={`button-game-display-${g.id}`}
              >
                <Tv className="h-4 w-4" />
              </Button>
            )}
            {/* Desktop-only: keep the original "view box score" + "edit"
                + "delete" icon row. On mobile these live in the overflow
                menu below. */}
            <div className="hidden sm:flex items-center gap-1">
              {g.boxScoreImportedAt && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-green-700 hover:text-green-800"
                  onClick={(e) => {
                    e.preventDefault();
                    onViewBoxScore(g.id);
                  }}
                  title="Box score submitted — click to view or edit"
                  data-testid={`button-view-box-score-${g.id}`}
                >
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-primary"
                onClick={(e) => { e.preventDefault(); setEditGame(g as Game); }}
                title="Edit game"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Link href={`/games/${g.id}`}>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => setDeleteId(g.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {/* Mobile-only: Open chevron stays visible, secondary actions
                collapse into an overflow menu so destructive Delete is
                one extra tap away from a thumb-sized target. */}
            <Link href={`/games/${g.id}`} className="sm:hidden">
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <ChevronRight className="h-5 w-5" />
              </Button>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild className="sm:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground"
                  onClick={(e) => e.preventDefault()}
                  aria-label="More actions"
                  data-testid={`button-game-menu-${g.id}`}
                >
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                {g.boxScoreImportedAt && (
                  <DropdownMenuItem
                    onSelect={() => onViewBoxScore(g.id)}
                    data-testid={`menu-view-box-score-${g.id}`}
                  >
                    <FileText className="mr-2 h-4 w-4 text-green-700" />
                    View box score
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => setEditGame(g as Game)}
                  data-testid={`menu-edit-game-${g.id}`}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setDeleteId(g.id)}
                  className="text-destructive focus:text-destructive"
                  data-testid={`menu-delete-game-${g.id}`}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="eyebrow text-primary/70">Game Day</div>
          <h1 className="page-title text-foreground mt-1">Schedule</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {counts.all === 0
              ? "Nothing scheduled yet"
              : `${counts.all} item${counts.all !== 1 ? "s" : ""} this season`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/games/new">
            <Button>
              <CalendarDays className="h-4 w-4 mr-2" />
              Add Game
            </Button>
          </Link>
        </div>
      </div>

      {!isLoading && <CalendarSyncBar onConnect={() => setShowIcal(true)} />}

      {games.length > 0 && !isLoading && (
        <div className="flex flex-wrap gap-1.5 p-1 rounded-lg bg-muted w-fit">
          {([
            { key: "all" as const, label: "All", count: counts.all },
            { key: "game" as const, label: "Games", count: counts.game },
            { key: "practice" as const, label: "Practices", count: counts.practice },
            { key: "other" as const, label: "Events", count: counts.other },
          ]).map((opt) => {
            const active = filter === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFilter(opt.key)}
                disabled={opt.count === 0 && opt.key !== "all"}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                }`}
              >
                {opt.label}
                <span className={`text-xs tabular-nums ${active ? "text-muted-foreground" : ""}`}>
                  ({opt.count})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : games.length === 0 ? (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-3 text-center">
            <CalendarDays className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">No games scheduled yet.</p>
            <div className="flex gap-2">
              {calendar.canManage && !calendar.connected && (
                <Button variant="outline" onClick={() => setShowIcal(true)}>
                  <Link2 className="h-4 w-4 mr-2" /> Connect Calendar
                </Button>
              )}
              <Link href="/games/new">
                <Button><CalendarDays className="h-4 w-4 mr-2" /> Add First Game</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-10">
          <CardContent className="flex flex-col items-center gap-2 text-center">
            <CalendarDays className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No {filter === "game" ? "games" : filter === "practice" ? "practices" : "events"} on the schedule.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setFilter("all")}>Show all items</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {heroGame && filter !== "practice" && filter !== "other" && (
            <NextGameHero game={heroGame} teamName={teamName ?? ""} />
          )}
          {upcomingForList.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</h2>
              {upcomingForList.map((g) => <GameCard key={g.id} g={g} teamName={teamName} onViewBoxScore={setBoxScoreGameId} />)}
            </div>
          )}
          {pastForList.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {filter === "game" ? "Past Games" : "Past"}
              </h2>
              {pastForList.map((g) => <GameCard key={g.id} g={g} teamName={teamName} onViewBoxScore={setBoxScoreGameId} />)}
            </div>
          )}
        </>
      )}

      <ConnectCalendarDialog open={showIcal} onClose={() => setShowIcal(false)} />

      {/* Edit dialog */}
      {editGame && (
        <EditGameDialog
          game={editGame}
          onClose={() => setEditGame(null)}
          onSaved={refresh}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete game?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the game and its lineup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {boxScoreGameId != null && (() => {
        // Pull the game's current scheduled length from the cached
        // games list so the dialog's "Last inning played" picker can
        // bound itself correctly. Falls back to 6 (the app default)
        // for the rare race where the game has been removed from the
        // list but the dialog id is still set.
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
    </div>
  );
}
