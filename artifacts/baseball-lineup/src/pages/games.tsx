import { useState } from "react";
import { Link } from "wouter";
import {
  useListGames,
  useDeleteGame,
  getListGamesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
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
import { CalendarDays, ChevronRight, MapPin, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>;
  if (status === "cancelled") return <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>;
  return <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Upcoming</Badge>;
}

export default function Games() {
  const { data: games = [], isLoading } = useListGames();
  const deleteGame = useDeleteGame();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const upcoming = games.filter((g) => g.status === "upcoming");
  const past = games.filter((g) => g.status !== "upcoming").reverse();

  const handleDelete = () => {
    if (!deleteId) return;
    deleteGame.mutate(
      { id: deleteId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          toast({ title: "Game removed" });
          setDeleteId(null);
        },
        onError: () => toast({ title: "Failed to delete game", variant: "destructive" }),
      }
    );
  };

  const GameCard = ({ g }: { g: typeof games[0] }) => (
    <Card className="border-border hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <Link href={`/games/${g.id}`}>
            <div className="flex-1 cursor-pointer group">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold group-hover:text-primary transition-colors">
                  vs. {g.opponent}
                </span>
                <StatusBadge status={g.status} />
                {g.status === "completed" && g.ourScore != null && g.opponentScore != null && (
                  <span className={`text-sm font-bold px-2 py-0.5 rounded ${g.ourScore > g.opponentScore ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                    {g.ourScore > g.opponentScore ? "W" : "L"} {g.ourScore}-{g.opponentScore}
                  </span>
                )}
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
          <div className="flex items-center gap-1 ml-2">
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
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Schedule</h1>
          <p className="text-muted-foreground mt-1">{games.length} games this season</p>
        </div>
        <Link href="/games/new">
          <Button>
            <CalendarDays className="h-4 w-4 mr-2" />
            Add Game
          </Button>
        </Link>
      </div>

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
            <Link href="/games/new">
              <Button><CalendarDays className="h-4 w-4 mr-2" /> Add First Game</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</h2>
              {upcoming.map((g) => <GameCard key={g.id} g={g} />)}
            </div>
          )}
          {past.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Past Games</h2>
              {past.map((g) => <GameCard key={g.id} g={g} />)}
            </div>
          )}
        </>
      )}

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
    </div>
  );
}
