import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  getGetGameQueryKey,
  getListGamesQueryKey,
  useGetGame,
  useUpdateGame,
} from "@workspace/api-client-react";
import { ArrowLeft, ClipboardList, Edit, MapPin, MonitorPlay, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EditGameDialog } from "@/components/edit-game-dialog";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permission";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { toastError } from "@/lib/toast-error";
import { withSync } from "@/lib/sync-envelope";
import { isVersionConflict } from "@/lib/conflict-registry";
import { effectiveStatus } from "@/lib/game-status";
import { formatClock } from "@/lib/basketball-rotation";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface GameStatsRow { playerId: number; name: string; number: number | null; started: boolean; seconds: number }

/**
 * A basketball team's game page. Basketball rotations come from the Bench
 * Sheet and run on the court display, so instead of the baseball lineup
 * builder this shows the game, links to both, the final score, and the
 * starters and minutes recorded on the court display.
 */
export default function BasketballGame() {
  const [, params] = useRoute("/games/:id");
  const id = parseInt(params?.id ?? "0");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermission();
  const canEdit = can("partial");
  const { teamName } = useTeamSettings();
  const { data: game, isLoading } = useGetGame(id, { query: { enabled: !!id, queryKey: getGetGameQueryKey(id) } });
  const { data: stats } = useQuery({
    queryKey: ["basketball-game-stats", id],
    enabled: !!id,
    queryFn: async (): Promise<{ tracked: boolean; players: GameStatsRow[] }> => {
      const r = await fetch(`${BASE}/api/basketball-games/${id}/stats`);
      if (!r.ok) throw new Error(`GET /api/basketball-games/${id}/stats failed (${r.status})`);
      return r.json();
    },
  });
  const updateGame = useUpdateGame();
  const [editOpen, setEditOpen] = useState(false);
  const [ourScore, setOurScore] = useState("");
  const [opponentScore, setOpponentScore] = useState("");

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!game) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Game not found.</p>
        <Link href="/games"><Button variant="link">Back to Schedule</Button></Link>
      </div>
    );
  }

  const status = effectiveStatus(game);
  const date = new Date(game.gameDate);
  const final = game.status === "completed" && game.ourScore != null && game.opponentScore != null;

  const saveScore = () => {
    updateGame.mutate(
      withSync(
        {
          id,
          data: { status: "completed", ourScore: parseInt(ourScore) || 0, opponentScore: parseInt(opponentScore) || 0 },
        },
        game.rowVersion,
      ),
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGameQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          toast({ title: "Final score saved" });
        },
        onError: (err) => {
          if (isVersionConflict(err)) return;
          toastError(toast, "Couldn't save the score", err);
        },
      },
    );
  };

  const players = [...(stats?.players ?? [])].sort(
    (a, b) => Number(b.started) - Number(a.started) || b.seconds - a.seconds || a.name.localeCompare(b.name),
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href="/games">
        <Button variant="ghost" size="sm" className="gap-1"><ArrowLeft className="h-4 w-4" /> Schedule</Button>
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow text-primary/70">Game</div>
          <h1 className="page-title mt-1 text-2xl text-foreground sm:text-3xl">
            {teamName || "Us"} vs. {game.opponent}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {format(date, "EEEE, MMMM d, yyyy · h:mm a")}
            {game.location && (
              <span className="ml-2 inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{game.location}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status === "cancelled" ? (
            <Badge variant="outline">Cancelled</Badge>
          ) : final ? (
            <Badge className={game.ourScore! > game.opponentScore! ? "bg-green-600" : game.ourScore === game.opponentScore ? "" : "bg-red-600"}>
              {game.ourScore! > game.opponentScore! ? "W" : game.ourScore === game.opponentScore ? "T" : "L"} {game.ourScore}–{game.opponentScore}
            </Badge>
          ) : (
            <Badge className="bg-primary/10 text-primary hover:bg-primary/10">{status === "upcoming" ? "Upcoming" : "Needs score"}</Badge>
          )}
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1"><Edit className="h-4 w-4" /> Edit</Button>
          )}
        </div>
      </div>

      {game.notes && <p className="whitespace-pre-wrap text-sm">{game.notes}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Game plan</CardTitle>
          <p className="text-sm text-muted-foreground">
            The rotation comes from the Bench Sheet. Run the game on the court display: it keeps the clock, tells you when to sub, and counts playing time.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href={`/games/${id}/display`}>
            <Button className="gap-2"><MonitorPlay className="h-4 w-4" /> Open court display</Button>
          </Link>
          <Link href="/bench-sheet">
            <Button variant="outline" className="gap-2"><ClipboardList className="h-4 w-4" /> Bench Sheet</Button>
          </Link>
        </CardContent>
      </Card>

      {canEdit && status !== "cancelled" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4" /> {final ? "Final score" : "Record the final score"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveScore();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ourScore">{teamName || "Us"}</Label>
                <Input id="ourScore" type="number" min="0" inputMode="numeric" className="w-24" value={ourScore} placeholder={game.ourScore != null ? String(game.ourScore) : "0"} onChange={(e) => setOurScore(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="opponentScore">{game.opponent}</Label>
                <Input id="opponentScore" type="number" min="0" inputMode="numeric" className="w-24" value={opponentScore} placeholder={game.opponentScore != null ? String(game.opponentScore) : "0"} onChange={(e) => setOpponentScore(e.target.value)} />
              </div>
              <Button type="submit" disabled={updateGame.isPending || (ourScore === "" && opponentScore === "")}>
                {final ? "Update score" : "Save final score"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Starters &amp; minutes</CardTitle>
        </CardHeader>
        <CardContent>
          {!stats?.tracked ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet. Open the court display and tap Start game; the starting five and everyone's minutes are saved as you go.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-2">Player</th>
                  <th className="px-2 py-2">Started</th>
                  <th className="py-2 pl-2 text-right">Minutes</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.playerId} className="border-b last:border-0">
                    <td className="py-2 pr-2 font-medium">
                      {p.number != null && <span className="mr-1.5 text-muted-foreground">#{p.number}</span>}
                      {p.name}
                    </td>
                    <td className="px-2 py-2">{p.started ? "Yes" : ""}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">{formatClock(p.seconds / 60)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {editOpen && (
        <EditGameDialog
          game={{
            id: game.id,
            opponent: game.opponent,
            gameDate: game.gameDate,
            location: game.location ?? null,
            innings: game.innings,
            status: game.status,
            gameType: game.gameType ?? null,
            competitiveness: game.competitiveness ?? null,
            tournamentId: game.tournamentId ?? null,
            bracketStage: null,
            isChampionship: null,
            notes: game.notes ?? null,
          }}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            qc.invalidateQueries({ queryKey: getGetGameQueryKey(id) });
            qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          }}
        />
      )}
    </div>
  );
}
