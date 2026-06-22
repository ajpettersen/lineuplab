import { useMemo } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGames,
  useUpdateGame,
  getGetTournamentQueryKey,
  getListTournamentsQueryKey,
  getListGamesQueryKey,
  getGetGameQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { safeFormatDate } from "@/lib/tournament-date";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * The single, shared "add a game to this tournament" experience. Used by BOTH
 * the tournaments listing cards and the tournament detail page so there is ONE
 * consistent flow: create a brand-new game (pre-linked to this tournament) or
 * link a game that's already on the schedule. Keeping this in one component
 * avoids the previous split where the listing card jumped straight to the
 * new-game form while the detail page offered create-or-link.
 */
export function AddGameToTournamentDialog({
  tournamentId,
  open,
  onOpenChange,
}: {
  tournamentId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: allGames = [] } = useListGames();

  const updateGame = useUpdateGame({
    mutation: {
      onSuccess: (_d, vars) => {
        void qc.invalidateQueries({
          queryKey: getGetTournamentQueryKey(tournamentId),
        });
        // Refresh the tournaments listing too — its cards show per-tournament
        // aggregates (gameCount / pitchers / total pitches) that go stale after
        // a link, since this dialog is also opened from the listing page.
        void qc.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        void qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
        if (vars.id) {
          void qc.invalidateQueries({ queryKey: getGetGameQueryKey(vars.id) });
        }
        onOpenChange(false);
      },
    },
  });

  // Games not already in THIS tournament are eligible to link.
  const availableGames = useMemo(
    () => allGames.filter((g) => g.tournamentId !== tournamentId),
    [allGames, tournamentId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a game</DialogTitle>
          <DialogDescription>
            Create a new game for this tournament, or link one that's already on
            your schedule.
          </DialogDescription>
        </DialogHeader>
        {/* Always-available "create new" CTA so a coach can build a
            tournament's schedule from scratch without bouncing through
            the main Schedule page first. The new-game form reads the
            ?tournamentId query param, pre-selects gameType=tournament,
            and links the game back to this tournament on save. */}
        <Link href={`/games/new?tournamentId=${tournamentId}`}>
          <Button
            className="w-full justify-center"
            data-testid="button-create-game-for-tournament"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Create new game
          </Button>
        </Link>
        {availableGames.length > 0 && (
          <>
            <div className="text-xs text-muted-foreground text-center">
              or link an existing game
            </div>
            <ul className="divide-y border rounded-md max-h-[40dvh] overflow-y-auto">
              {availableGames.map((g) => (
                <li
                  key={g.id}
                  className="p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">vs {g.opponent}</div>
                    <div className="text-xs text-muted-foreground">
                      {safeFormatDate(
                        g.gameDate,
                        "EEE, MMM d · h:mm a",
                        "Date TBD",
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      updateGame.mutate({ id: g.id, data: { tournamentId } });
                    }}
                    disabled={updateGame.isPending}
                    data-testid={`button-link-game-${g.id}`}
                  >
                    Link
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
