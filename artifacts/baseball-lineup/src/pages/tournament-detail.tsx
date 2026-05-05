import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { RestTiersEditor } from "@/components/rest-tiers-editor";
import type { RestTier } from "@/lib/pitch-rulesets";

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
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        toast({ title: "Tournament deleted" });
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

  const linkedGameIds = useMemo(
    () => new Set((tournament?.games ?? []).map((g) => g.id)),
    [tournament],
  );
  const availableGames = useMemo(
    () => allGames.filter((g) => !linkedGameIds.has(g.id)),
    [allGames, linkedGameIds],
  );

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

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link href="/tournaments">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 h-8">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            All tournaments
          </Button>
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Trophy className="h-6 w-6 text-purple-600" />
              {tournament.name}
            </h1>
            <div className="text-sm text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                {format(new Date(tournament.startDate), "MMM d")} –{" "}
                {format(new Date(tournament.endDate), "MMM d, yyyy")}
              </span>
              {tournament.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {tournament.location}
                </span>
              )}
              <Badge variant="outline" className="text-xs">
                {dailyLabel}
                {tournamentLabel ? ` · ${tournamentLabel}` : ""} · {restTiersLabel}
              </Badge>
            </div>
            {tournament.notes && (
              <p className="text-sm mt-2 text-muted-foreground">{tournament.notes}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              data-testid="button-edit-tournament"
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700"
              onClick={() => setConfirmDelete(true)}
              data-testid="button-delete-tournament"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      <Card data-testid="card-pitcher-availability">
        <CardHeader>
          <CardTitle className="text-base">Pitcher Availability</CardTitle>
          <p className="text-xs text-muted-foreground">
            Rolling totals across this tournament + how many pitches each
            pitcher has left today after league rest rules.
          </p>
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
                    <th className="text-right py-2 px-2 font-medium">Available</th>
                    <th className="text-right py-2 px-2 font-medium">Tournament</th>
                    <th className="text-left py-2 pl-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tournament.pitcherAvailability
                    .slice()
                    .sort((a, b) => b.totalPitchesInTournament - a.totalPitchesInTournament)
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
                            {p.dailyMax != null ? ` / ${p.dailyMax}` : ""}
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
                            {p.totalPitchesInTournament}
                            {tournament.effectiveTournamentMax != null
                              ? ` / ${tournament.effectiveTournamentMax}`
                              : ""}
                          </td>
                          <td className="py-2 pl-3">
                            {resting ? (
                              <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-900">
                                Rest until {format(new Date(resting.availableOn), "EEE M/d")}
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
            <ul className="divide-y">
              {tournament.games.map((g) => (
                <li
                  key={g.id}
                  className="py-2.5 flex items-center justify-between gap-3"
                  data-testid={`row-tournament-game-${g.id}`}
                >
                  <div className="min-w-0">
                    <Link
                      href={`/games/${g.id}`}
                      className="font-medium hover:underline"
                    >
                      vs {g.opponent}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(g.gameDate), "EEE, MMM d · h:mm a")}
                      {g.location ? ` · ${g.location}` : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                    onClick={() =>
                      updateGame.mutate({ id: g.id, data: { tournamentId: null } })
                    }
                    aria-label="Remove from tournament"
                    data-testid={`button-remove-game-${g.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
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
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add a game</DialogTitle>
            <DialogDescription>
              Pick an existing game to link, or create a new one from the Schedule page first.
            </DialogDescription>
          </DialogHeader>
          {availableGames.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No unlinked games to add. <Link href="/games/new" className="text-primary hover:underline">Create a new game</Link>.
            </p>
          ) : (
            <ul className="divide-y border rounded-md">
              {availableGames.map((g) => (
                <li
                  key={g.id}
                  className="p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">vs {g.opponent}</div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(g.gameDate), "EEE, MMM d · h:mm a")}
                    </div>
                  </div>
                  <Button
                    size="sm"
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
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
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
