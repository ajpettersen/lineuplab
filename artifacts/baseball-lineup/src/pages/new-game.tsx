import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useCreateGame,
  getListGamesQueryKey,
  useGetPreferences,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTeamSettings } from "@/hooks/use-team-settings";

export default function NewGame() {
  const [, navigate] = useLocation();
  const createGame = useCreateGame();
  const qc = useQueryClient();
  const { toast } = useToast();
  const prefsQuery = useGetPreferences();
  const { usesTournaments } = useTeamSettings();
  const [opponent, setOpponent] = useState("");
  const [gameDate, setGameDate] = useState("");
  const [location, setLocation] = useState("");
  const [innings, setInnings] = useState("6");
  const [inningsTouched, setInningsTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [gameType, setGameType] = useState<"none" | "league" | "tournament">("none");

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
          toast({ title: "Game added" });
          navigate(`/games/${game.id}`);
        },
        onError: () => toast({ title: "Failed to add game", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div className="flex items-center gap-3">
        <Link href="/games">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Schedule
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
              <div className="grid grid-cols-3 gap-2">
                {([
                  { v: "none" as const, label: "Unspecified", hint: "Use my fairness setting" },
                  { v: "league" as const, label: "League", hint: "Even out plate appearances" },
                  // Tournament option only shown when the team's
                  // tournament feature flag is on (Settings →
                  // Defaults → "We play tournaments").
                  ...(usesTournaments
                    ? [{ v: "tournament" as const, label: "Tournament", hint: "Most competitive" }]
                    : []),
                ]).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setGameType(opt.v)}
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
    </div>
  );
}
