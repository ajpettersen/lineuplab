import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetGamePitchCounts,
  useUpsertGamePitchCount,
  useDeleteGamePitchCount,
  useListPlayers,
  useGetTournament,
  getGetGamePitchCountsQueryKey,
  getGetTournamentQueryKey,
  type Player,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  Loader2,
  Minus,
  Plus,
  Trophy,
  Trash2,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type Game = {
  id: number;
  gameDate: string | Date;
  tournamentId?: number | null;
};


type Props = { gameId: number; game: Game };

/**
 * Per-pitcher pitch count entry for a single game. Lists every pitcher on
 * the roster, lets the coach record a count via a numeric input + quick
 * +1/+5/+10/-1 buttons, and (when the game is part of a tournament) shows
 * each pitcher's "available today" budget computed against the tournament's
 * rolling outings + ruleset.
 *
 * Persistence model: one row per (gameId, playerId) — re-entering a number
 * UPSERTs. Drafts are kept locally until the coach taps Save so they can
 * tap-tap-tap a count without firing a mutation per click.
 */
export function PitchCountsCard({ gameId, game }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: counts = [] } = useGetGamePitchCounts(gameId);
  const { data: players = [] } = useListPlayers();
  const tournamentId = game.tournamentId ?? null;
  const tournamentQuery = useGetTournament(tournamentId ?? 0, {
    query: {
      enabled: tournamentId != null,
      queryKey: getGetTournamentQueryKey(tournamentId ?? 0),
    },
  });

  const upsert = useUpsertGamePitchCount({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getGetGamePitchCountsQueryKey(gameId),
        });
        if (tournamentId != null) {
          void qc.invalidateQueries({
            queryKey: getGetTournamentQueryKey(tournamentId),
          });
        }
      },
      onError: (err) =>
        toast({
          title: "Could not save pitch count",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    },
  });

  const delMutation = useDeleteGamePitchCount({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getGetGamePitchCountsQueryKey(gameId),
        });
        if (tournamentId != null) {
          void qc.invalidateQueries({
            queryKey: getGetTournamentQueryKey(tournamentId),
          });
        }
      },
    },
  });

  const pitchers = useMemo<Player[]>(
    () => players.filter((p) => p.canPitch),
    [players],
  );

  // Local draft state: playerId → string (so the user can clear / type freely).
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  // Hydrate drafts from server state when counts arrive / change. Only set
  // a draft if the user hasn't edited it locally — otherwise we'd stomp
  // their typing on every refetch.
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const c of counts) {
        if (next[c.playerId] === undefined) {
          next[c.playerId] = String(c.pitches);
        }
      }
      return next;
    });
  }, [counts]);

  const countsByPlayer = useMemo(
    () => new Map(counts.map((c) => [c.playerId, c])),
    [counts],
  );

  const availabilityByPlayer = useMemo(() => {
    const map = new Map<
      number,
      NonNullable<typeof tournamentQuery.data>["pitcherAvailability"][number]
    >();
    for (const p of tournamentQuery.data?.pitcherAvailability ?? []) {
      map.set(p.playerId, p);
    }
    return map;
  }, [tournamentQuery.data]);

  const dailyMax = tournamentQuery.data?.effectiveDailyMax ?? null;

  const setDraft = (id: number, value: string) => {
    setDrafts((d) => ({ ...d, [id]: value }));
  };

  const bump = (id: number, delta: number) => {
    setDrafts((d) => {
      const current = parseInt(d[id] ?? "0") || 0;
      const next = Math.max(0, current + delta);
      return { ...d, [id]: String(next) };
    });
  };

  const save = (player: Player) => {
    const raw = drafts[player.id];
    const value = parseInt(raw ?? "0");
    if (Number.isNaN(value) || value < 0) {
      toast({ title: "Pitch count must be a positive number", variant: "destructive" });
      return;
    }
    upsert.mutate(
      {
        id: gameId,
        data: { playerId: player.id, pitches: value },
      },
      {
        // Drop this player's local draft so the hydration effect picks
        // up the freshly-saved value (and any concurrent updates from
        // another coach) on the next refetch — otherwise the draft
        // sticks at the old typed string forever.
        onSuccess: () => {
          setDrafts((d) => {
            const next = { ...d };
            delete next[player.id];
            return next;
          });
        },
      },
    );
  };

  const clear = (playerId: number) => {
    delMutation.mutate(
      { gameId, playerId },
      {
        onSuccess: () => {
          setDrafts((d) => {
            const next = { ...d };
            delete next[playerId];
            return next;
          });
        },
      },
    );
  };

  if (pitchers.length === 0) {
    return null;
  }

  return (
    <Card data-testid="card-pitch-counts">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3">
        <div>
          <CardTitle className="text-base">Pitch Counts</CardTitle>
          {tournamentId != null && tournamentQuery.data && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
              <Trophy className="h-3.5 w-3.5 text-purple-600" />
              <Link
                href={`/tournaments/${tournamentId}`}
                className="text-purple-700 hover:underline font-medium"
              >
                {tournamentQuery.data.name}
              </Link>
              {dailyMax != null && (
                <>
                  <span>·</span>
                  <span>Daily max {dailyMax}</span>
                </>
              )}
            </p>
          )}
          {tournamentId == null && (
            <p className="text-xs text-muted-foreground mt-1">
              Link this game to a tournament from its detail page to track rolling pitch budgets across multiple games.
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {pitchers.map((p) => {
          const saved = countsByPlayer.get(p.id);
          const draft = drafts[p.id] ?? (saved ? String(saved.pitches) : "");
          const draftNum = parseInt(draft) || 0;
          const dirty = saved ? draftNum !== saved.pitches : draft !== "";
          const avail = availabilityByPlayer.get(p.id);
          // "Pitches today" from the tournament view ALREADY includes this
          // game's saved value, so to show what the new total would be we
          // swap in the draft delta vs the persisted value.
          const liveToday = avail
            ? avail.pitchesToday + (draftNum - (saved?.pitches ?? 0))
            : null;
          const exceeded = dailyMax != null && liveToday != null && liveToday > dailyMax;
          const resting = avail?.restingUntil ?? null;

          return (
            <div
              key={p.id}
              className="rounded-md border p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
              data-testid={`row-pitch-count-${p.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{p.name}</span>
                  {p.number != null && (
                    <span className="text-xs text-muted-foreground">#{p.number}</span>
                  )}
                </div>
                {avail && (
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                    <span>
                      Today: <span className={exceeded ? "text-red-600 font-semibold" : ""}>
                        {liveToday}
                      </span>{dailyMax != null ? <> / {dailyMax}</> : null}
                    </span>
                    <span>Tournament total: {avail.totalPitchesInTournament + (draftNum - (saved?.pitches ?? 0))}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => bump(p.id, -1)}
                  data-testid={`button-pitch-minus-${p.id}`}
                  aria-label={`Decrement ${p.name}`}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={500}
                  value={draft}
                  onChange={(e) => setDraft(p.id, e.target.value)}
                  className="h-8 w-16 text-center"
                  data-testid={`input-pitches-${p.id}`}
                  aria-label={`Pitches thrown by ${p.name}`}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => bump(p.id, 1)}
                  data-testid={`button-pitch-plus-${p.id}`}
                  aria-label={`+1 ${p.name}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => bump(p.id, 5)}
                  data-testid={`button-pitch-plus5-${p.id}`}
                >
                  +5
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => bump(p.id, 10)}
                  data-testid={`button-pitch-plus10-${p.id}`}
                >
                  +10
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  onClick={() => save(p)}
                  disabled={!dirty || upsert.isPending}
                  data-testid={`button-save-pitch-${p.id}`}
                >
                  {upsert.isPending && upsert.variables?.data.playerId === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
                {saved && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                    onClick={() => clear(p.id)}
                    aria-label={`Clear ${p.name}`}
                    data-testid={`button-clear-pitch-${p.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {(exceeded || resting) && (
                <div className="basis-full">
                  {exceeded && (
                    <Badge variant="destructive" className="mr-2 text-xs">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Over daily max
                    </Badge>
                  )}
                  {resting && (
                    <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-900">
                      Resting from {format(new Date(resting.fromOutingDate), "EEE")} ({resting.fromOutingPitches} pitches) — back {format(new Date(resting.availableOn), "EEE M/d")}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
