import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";
import { useTeamSettings } from "@/hooks/use-team-settings";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type EditableGame = {
  id: number;
  opponent: string;
  gameDate: string;
  location: string | null;
  innings: number;
  status: string;
  gameType?: "league" | "tournament" | null;
  tournamentId?: number | null;
  bracketStage?: "pool" | "bracket" | null;
  notes: string | null;
};

export function EditGameDialog({
  game,
  onClose,
  onSaved,
}: {
  game: EditableGame;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { usesTournaments } = useTeamSettings();
  const [opponent, setOpponent] = useState(game.opponent);
  const [gameDate, setGameDate] = useState(() => {
    const d = new Date(game.gameDate);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [location, setLocation] = useState(game.location ?? "");
  const [innings, setInnings] = useState(String(game.innings));
  const [notes, setNotes] = useState(game.notes ?? "");
  const [status, setStatus] = useState(game.status);
  const [gameType, setGameType] = useState<"none" | "league" | "tournament">(
    game.gameType === "league" || game.gameType === "tournament" ? game.gameType : "none"
  );
  // Bracket stage selector — only relevant when the game is linked to a
  // tournament AND tagged as a tournament game. Drives which pair of
  // time-limit fields on the parent tournament applies to this game on
  // the Field Display.
  const [bracketStage, setBracketStage] = useState<"pool" | "bracket">(
    game.bracketStage === "bracket" ? "bracket" : "pool",
  );
  const [saving, setSaving] = useState(false);
  const showStagePicker =
    game.tournamentId != null && gameType === "tournament";

  const handleSave = async () => {
    if (!opponent.trim()) { toast({ title: "Opponent required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opponent: opponent.trim(),
          gameDate: new Date(gameDate).toISOString(),
          location: location.trim() || null,
          innings: parseInt(innings) || 6,
          notes: notes.trim() || null,
          status,
          gameType: gameType === "none" ? null : gameType,
          // Only persist a stage when the game is actually a tournament
          // game linked to a tournament — otherwise clear it so a coach
          // demoting "tournament" → "league" doesn't leave a stale stage.
          bracketStage: showStagePicker ? bracketStage : null,
        }),
      });
      if (!r.ok) throw new Error();
      toast({ title: "Game updated" });
      onSaved();
      onClose();
    } catch (err) {
      toastError(toast, "Failed to save", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Game</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Opponent</Label>
            <Input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="Team name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Date & Time</Label>
              <Input type="datetime-local" value={gameDate} onChange={(e) => setGameDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Innings</Label>
              <Input type="number" min="1" max="9" value={innings} onChange={(e) => setInnings(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Location</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Field or address" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Game Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: "none" as const, label: "Unspecified" },
                { v: "league" as const, label: "League" },
                ...(usesTournaments
                  ? [{ v: "tournament" as const, label: "Tournament" }]
                  : []),
              ]).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setGameType(opt.v)}
                  className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                    gameType === opt.v
                      ? "border-primary bg-primary/5 text-foreground font-medium"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {gameType === "league"
                ? "Lineup generator will rebalance plate appearances across the season."
                : gameType === "tournament"
                ? "Lineup generator will favor your strongest players and best bats first."
                : "Lineup generator will use your default fairness setting."}
            </p>
          </div>
          {showStagePicker && (
            <div className="flex flex-col gap-1.5" data-testid="bracket-stage-picker">
              <Label>Tournament stage</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: "pool" as const, label: "Pool Play" },
                  { v: "bracket" as const, label: "Bracket Play" },
                ]).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setBracketStage(opt.v)}
                    className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                      bracketStage === opt.v
                        ? "border-primary bg-primary/5 text-foreground font-medium"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                    data-testid={`button-bracket-stage-${opt.v}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Switches the time-limit rules shown in the Field Display
                (set up on the tournament page).
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
