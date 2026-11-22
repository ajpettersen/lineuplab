import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trophy } from "lucide-react";
import {
  getGetGameQueryKey,
  getListDashboardTasksQueryKey,
  getListGamesQueryKey,
  useUpdateGame,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { isVersionConflict } from "@/lib/conflict-registry";
import { withSync } from "@/lib/sync-envelope";
import { toastError } from "@/lib/toast-error";

export interface ScoreGame {
  id: number;
  opponent: string;
  rowVersion?: number;
  ourScore?: number | null;
  opponentScore?: number | null;
}

/**
 * A small pop-up for the final score: two numbers and Save. Saving marks the
 * game completed (which also locks its basketball playing time).
 */
export function QuickScoreDialog({ game, onClose }: { game: ScoreGame | null; onClose: () => void }) {
  return (
    <Dialog open={game !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        {game && <ScoreForm key={game.id} game={game} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ScoreForm({ game, onClose }: { game: ScoreGame; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { teamName } = useTeamSettings();
  const updateGame = useUpdateGame();
  const [ours, setOurs] = useState(game.ourScore != null ? String(game.ourScore) : "");
  const [theirs, setTheirs] = useState(game.opponentScore != null ? String(game.opponentScore) : "");
  const valid = ours !== "" && theirs !== "" && Number(ours) >= 0 && Number(theirs) >= 0;

  const save = () => {
    if (!valid) return;
    updateGame.mutate(
      withSync(
        { id: game.id, data: { status: "completed", ourScore: Math.floor(Number(ours)), opponentScore: Math.floor(Number(theirs)) } },
        game.rowVersion,
      ),
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getGetGameQueryKey(game.id) });
          void qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          void qc.invalidateQueries({ queryKey: getListDashboardTasksQueryKey() });
          toast({ title: `Final saved: ${ours}–${theirs}` });
          onClose();
        },
        onError: (err) => {
          if (isVersionConflict(err)) return;
          toastError(toast, "Couldn't save the score", err);
        },
      },
    );
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-primary" /> Final score</DialogTitle>
        <DialogDescription>vs. {game.opponent}</DialogDescription>
      </DialogHeader>
      <div className="my-5 grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quick-ours" className="truncate">{teamName || "Us"}</Label>
          <Input id="quick-ours" autoFocus type="number" min="0" inputMode="numeric" className="h-14 text-center text-2xl font-bold" value={ours} onChange={(e) => setOurs(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quick-theirs" className="truncate">{game.opponent}</Label>
          <Input id="quick-theirs" type="number" min="0" inputMode="numeric" className="h-14 text-center text-2xl font-bold" value={theirs} onChange={(e) => setTheirs(e.target.value)} />
        </div>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!valid || updateGame.isPending} className="gap-2">
          {updateGame.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save final score
        </Button>
      </DialogFooter>
    </form>
  );
}
