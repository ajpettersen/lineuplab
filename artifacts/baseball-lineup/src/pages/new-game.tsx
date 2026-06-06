import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useCreateGame,
  useUpdateGame,
  useListTournaments,
  useCreateTournament,
  getListGamesQueryKey,
  getGetTournamentQueryKey,
  getListTournamentsQueryKey,
  useGetPreferences,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Loader2, Plus, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";
import { useTeamSettings } from "@/hooks/use-team-settings";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewGame() {
  const [location_, navigate] = useLocation();
  const createGame = useCreateGame();
  const updateGame = useUpdateGame();
  const qc = useQueryClient();
  const { toast } = useToast();
  const prefsQuery = useGetPreferences();
  const { usesTournaments, sportProfile } = useTeamSettings();
  const tournamentsEnabled = usesTournaments && sportProfile.features.tournaments;

  // When the coach lands on this page from a tournament's "Create new
  // game" CTA, the tournament id rides along as ?tournamentId=N. We
  // pre-select gameType=tournament, link the new game to that
  // tournament on save, and bounce back to the tournament page so they
  // don't have to re-navigate.
  const tournamentIdFromQuery = useMemo(() => {
    const qs = typeof window === "undefined"
      ? ""
      : window.location.search;
    const n = Number(new URLSearchParams(qs).get("tournamentId"));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [location_]);

  const [opponent, setOpponent] = useState("");
  const [gameDate, setGameDate] = useState("");
  const [location, setLocation] = useState("");
  const [innings, setInnings] = useState("6");
  const [inningsTouched, setInningsTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [gameType, setGameType] = useState<"none" | "league" | "tournament">(
    tournamentIdFromQuery != null && tournamentsEnabled ? "tournament" : "none",
  );

  // Tournament attachment for tournament-type games. When the coach
  // picks gameType=tournament we require them to either pick an
  // existing tournament or quick-create one inline (otherwise a
  // tournament-type game wouldn't roll up into the right
  // tournament's pitch counts / rest tracking, defeating the point of
  // tagging it tournament in the first place).
  const tournamentsQuery = useListTournaments({
    query: { enabled: tournamentsEnabled, queryKey: getListTournamentsQueryKey() },
  });
  const tournaments = tournamentsQuery.data ?? [];
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(
    tournamentIdFromQuery,
  );
  const [newTournamentOpen, setNewTournamentOpen] = useState(false);
  const [newTournamentName, setNewTournamentName] = useState("");
  const [newTournamentStart, setNewTournamentStart] = useState(todayISO());
  const [newTournamentEnd, setNewTournamentEnd] = useState(todayISO());
  const [newTournamentLocation, setNewTournamentLocation] = useState("");

  // When the coach types a game date, default the quick-create
  // tournament dates to that day (one-day tournament) so the dialog
  // opens with sensible values instead of "today".
  useEffect(() => {
    if (!gameDate) return;
    const day = gameDate.slice(0, 10);
    setNewTournamentStart(day);
    setNewTournamentEnd(day);
  }, [gameDate]);

  const createTournament = useCreateTournament({
    mutation: {
      onSuccess: (t) => {
        void qc.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        setSelectedTournamentId(t.id);
        setNewTournamentOpen(false);
        setNewTournamentName("");
        setNewTournamentLocation("");
        toast({ title: "Tournament created" });
      },
      onError: (err) =>
        toast({
          title: "Could not create tournament",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    },
  });

  const submitNewTournament = () => {
    const trimmed = newTournamentName.trim();
    if (!trimmed) {
      toast({ title: "Tournament name required", variant: "destructive" });
      return;
    }
    if (new Date(newTournamentEnd) < new Date(newTournamentStart)) {
      toast({ title: "End date can't be before start date", variant: "destructive" });
      return;
    }
    createTournament.mutate({
      data: {
        name: trimmed,
        startDate: newTournamentStart,
        endDate: newTournamentEnd,
        location: newTournamentLocation.trim() || null,
        notes: null,
        dailyPitchMax: null,
        tournamentPitchMax: null,
        restTiers: null,
      },
    });
  };

  // Apply the coach's preferred default once preferences load,
  // unless the coach has already manually changed the field.
  useEffect(() => {
    if (prefsQuery.data && !inningsTouched) {
      setInnings(String(prefsQuery.data.defaultInnings));
    }
  }, [prefsQuery.data, inningsTouched]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!opponent.trim()) {
      toast({ title: "Opponent name is required", variant: "destructive" });
      return;
    }
    if (!gameDate) {
      toast({ title: "Game date is required", variant: "destructive" });
      return;
    }
    const linkTournamentId = selectedTournamentId ?? tournamentIdFromQuery;
    if (gameType === "tournament" && linkTournamentId == null) {
      toast({
        title: "Pick a tournament",
        description:
          "Choose an existing tournament or create one so this game's pitch counts roll up correctly.",
        variant: "destructive",
      });
      return;
    }
    createGame.mutate(
      {
        data: {
          opponent: opponent.trim(),
          gameDate: new Date(gameDate).toISOString(),
          location: location.trim() || null,
          innings: parseInt(innings) || 6,
          notes: notes.trim() || null,
          gameType: gameType === "none" ? null : gameType,
        },
      },
      {
        onSuccess: (game) => {
          qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          // If a tournament was either pre-linked via ?tournamentId=
          // or picked / created in the form, link the freshly-created
          // game to it via PATCH (the create endpoint doesn't accept
          // tournamentId). When the link came from the URL we bounce
          // back to the tournament page; when it came from the form
          // selector we drop the coach on the new game so they can set
          // up the lineup right away. (linkTournamentId is recomputed
          // here from the same fallback as the validation check above.)
          const linkTournamentId = selectedTournamentId ?? tournamentIdFromQuery;
          if (linkTournamentId != null) {
            updateGame.mutate(
              { id: game.id, data: { tournamentId: linkTournamentId } },
              {
                onSuccess: () => {
                  qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
                  qc.invalidateQueries({
                    queryKey: getGetTournamentQueryKey(linkTournamentId),
                  });
                  qc.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
                  toast({ title: "Game added to tournament" });
                  if (tournamentIdFromQuery != null) {
                    navigate(`/tournaments/${tournamentIdFromQuery}`);
                  } else {
                    navigate(`/games/${game.id}`);
                  }
                },
                onError: () => {
                  // Game was created successfully; tournament link
                  // failed. Surface the partial success and drop the
                  // coach on the game page so they can re-link manually.
                  toast({
                    title: "Game added, but couldn't link to tournament",
                    variant: "destructive",
                  });
                  navigate(`/games/${game.id}`);
                },
              },
            );
            return;
          }
          toast({ title: "Game added" });
          navigate(`/games/${game.id}`);
        },
        onError: (err) => toastError(toast, "Failed to add game", err),
      }
    );
  };

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div className="flex items-center gap-3">
        <Link
          href={
            tournamentIdFromQuery != null
              ? `/tournaments/${tournamentIdFromQuery}`
              : "/games"
          }
        >
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />{" "}
            {tournamentIdFromQuery != null ? "Tournament" : "Schedule"}
          </Button>
        </Link>
      </div>
      <div>
        <div className="eyebrow text-primary/70">New Matchup</div>
        <h1 className="page-title text-foreground mt-1">Add New Game</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Enter your opponent, date, and location to put a game on the schedule.
        </p>
      </div>
      <Card className="relative overflow-hidden broadcast-stripe">
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="opponent">Opponent</Label>
              <Input
                id="opponent"
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
                placeholder="Team name"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gameDate">Date & Time</Label>
                <Input
                  id="gameDate"
                  type="datetime-local"
                  value={gameDate}
                  onChange={(e) => setGameDate(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="innings">Innings</Label>
                <Input
                  id="innings"
                  type="number"
                  min="1"
                  max="9"
                  value={innings}
                  onChange={(e) => {
                    setInningsTouched(true);
                    setInnings(e.target.value);
                  }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="location">Location (optional)</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Field name or address"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Game Type</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {([
                  { v: "none" as const, label: "Unspecified", hint: "Use my fairness setting" },
                  { v: "league" as const, label: "League", hint: "Even out plate appearances" },
                  // Tournament option only shown when the team's
                  // tournament feature flag is on (Settings →
                  // Defaults → "We play tournaments").
                  ...(tournamentsEnabled
                    ? [{ v: "tournament" as const, label: "Tournament", hint: "Most competitive" }]
                    : []),
                ]).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => {
                      setGameType(opt.v);
                      // Switching away from tournament clears the
                      // form-picked attachment so the PATCH-after-create
                      // doesn't accidentally link a league/unspecified
                      // game. The deep-link `?tournamentId=` survives
                      // because it lives in `tournamentIdFromQuery`,
                      // not `selectedTournamentId` — so a coach who
                      // arrived from a tournament page, toggled to
                      // League, then back to Tournament, still sees the
                      // "added to the tournament you came from" hint.
                      if (opt.v !== "tournament") setSelectedTournamentId(null);
                    }}
                    className={`flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      gameType === opt.v
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <span className="font-medium">{opt.label}</span>
                    <span className="text-xs text-muted-foreground">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>
            {gameType === "tournament" && tournamentsEnabled && (
              <div className="flex flex-col gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-3">
                <Label className="flex items-center gap-1.5 text-foreground">
                  <Trophy className="h-4 w-4 text-purple-600" />
                  Tournament
                </Label>
                <p className="text-xs text-muted-foreground -mt-0.5">
                  Pitch counts and rest tracking roll up to whichever
                  tournament you pick here.
                </p>
                {tournamentIdFromQuery != null ? (
                  <p className="text-sm text-muted-foreground italic">
                    This game will be added to the tournament you came from.
                  </p>
                ) : tournamentsQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading tournaments…
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex-1 min-w-0">
                      <Select
                        value={
                          selectedTournamentId != null
                            ? String(selectedTournamentId)
                            : ""
                        }
                        onValueChange={(v) =>
                          setSelectedTournamentId(v ? Number(v) : null)
                        }
                      >
                        <SelectTrigger data-testid="select-tournament">
                          <SelectValue
                            placeholder={
                              tournaments.length === 0
                                ? "No tournaments yet — create one →"
                                : "Choose a tournament"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {tournaments.map((t) => (
                            <SelectItem key={t.id} value={String(t.id)}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setNewTournamentName("");
                        setNewTournamentLocation(location.trim());
                        setNewTournamentOpen(true);
                      }}
                      data-testid="button-new-tournament-inline"
                    >
                      <Plus className="h-4 w-4 mr-1" /> New tournament
                    </Button>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about this game"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Link href="/games">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" disabled={createGame.isPending}>
                {createGame.isPending ? "Adding..." : "Add Game"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog
        open={newTournamentOpen}
        onOpenChange={(o) => {
          setNewTournamentOpen(o);
          if (!o) setNewTournamentName("");
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New tournament</DialogTitle>
            <DialogDescription>
              Just the basics — pitch limits and rest tiers fall back to
              your team defaults. You can fine-tune them later from the
              Tournaments page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="qt-name">Name</Label>
              <Input
                id="qt-name"
                value={newTournamentName}
                onChange={(e) => setNewTournamentName(e.target.value)}
                placeholder="e.g. Memorial Day Classic"
                maxLength={120}
                data-testid="input-quick-tournament-name"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="qt-start">Start</Label>
                <Input
                  id="qt-start"
                  type="date"
                  value={newTournamentStart}
                  onChange={(e) => setNewTournamentStart(e.target.value)}
                  data-testid="input-quick-tournament-start"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qt-end">End</Label>
                <Input
                  id="qt-end"
                  type="date"
                  value={newTournamentEnd}
                  onChange={(e) => setNewTournamentEnd(e.target.value)}
                  data-testid="input-quick-tournament-end"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qt-location">Location (optional)</Label>
              <Input
                id="qt-location"
                value={newTournamentLocation}
                onChange={(e) => setNewTournamentLocation(e.target.value)}
                placeholder="e.g. Riverside Sports Complex"
                data-testid="input-quick-tournament-location"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewTournamentOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={submitNewTournament}
              disabled={createTournament.isPending}
              data-testid="button-create-quick-tournament"
            >
              {createTournament.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
