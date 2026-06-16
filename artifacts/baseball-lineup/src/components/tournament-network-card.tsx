import { useMemo } from "react";
import {
  useGetTournamentNetwork,
  useJoinTournamentNetwork,
  useLeaveTournamentNetwork,
  useUpdateTournamentNetworkMembership,
  useDismissTournamentNetworkSuggestions,
  getGetTournamentNetworkQueryKey,
  getGetTournamentQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Users, EyeOff, Eye, Share2, LogOut, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * "Tournament Network" card on the tournament-detail page. Three
 * states it renders:
 *
 *  1. Not in a network AND no suggestions → render NOTHING (we don't
 *     want a permanently empty card cluttering the page).
 *  2. Not in a network AND there are suggestions → "Join with N other
 *     coaches" CTA + Dismiss.
 *  3. In a network → member list (visible coaches by team name, hidden
 *     coaches shown anonymously so the count is honest) + privacy
 *     toggles + Leave.
 *
 * Network state lives at GET /tournaments/:id/network. We invalidate
 * BOTH that key and the tournament-detail key on every mutation because
 * the simulator output (pool play) depends on which coaches are sharing
 * scores into this tournament.
 */
export function TournamentNetworkCard({ tournamentId }: { tournamentId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useGetTournamentNetwork(tournamentId);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetTournamentNetworkQueryKey(tournamentId) }),
      qc.invalidateQueries({ queryKey: getGetTournamentQueryKey(tournamentId) }),
    ]);
  };

  const join = useJoinTournamentNetwork({
    mutation: {
      onSuccess: async () => {
        await invalidate();
        toast({ title: "Joined network", description: "You'll now see scores from other coaches in this tournament." });
      },
      onError: (e) => {
        toast({
          title: "Couldn't join",
          description: (e as Error)?.message ?? "Try again in a moment.",
          variant: "destructive",
        });
      },
    },
  });
  const leave = useLeaveTournamentNetwork({
    mutation: {
      onSuccess: async () => {
        await invalidate();
        toast({ title: "Left network" });
      },
    },
  });
  const updateMembership = useUpdateTournamentNetworkMembership({
    mutation: { onSuccess: invalidate },
  });
  const dismiss = useDismissTournamentNetworkSuggestions({
    mutation: { onSuccess: invalidate },
  });

  const suggestions = data?.suggestions ?? [];
  const members = data?.members ?? [];
  const membership = data?.membership ?? null;
  const network = data?.network ?? null;

  // Hidden members surface as anonymous tally so coaches can see the
  // network has more participants without leaking identity.
  const visibleMembers = useMemo(
    () => members.filter((m) => m.visible || m.isYou),
    [members],
  );
  const hiddenCount = members.length - visibleMembers.length;

  // State 1: nothing to show.
  if (!network && suggestions.length === 0) return null;

  // State 2: suggestion CTA.
  if (!network) {
    return (
      <Card data-testid="card-tournament-network">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-amber-600" />
              Other coaches added this tournament
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Share schedule, scores, and pool standings so everyone sees the same picture.
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => dismiss.mutate({ id: tournamentId })}
            disabled={dismiss.isPending}
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            We don't reveal other teams' names until both sides join and opt in to being visible.
          </p>
          <Button
            onClick={() => join.mutate({ id: tournamentId })}
            disabled={join.isPending}
          >
            <Share2 className="h-4 w-4 mr-1.5" />
            Join with {suggestions.length} other{" "}
            {suggestions.length === 1 ? "coach" : "coaches"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // State 3: in-network panel.
  return (
    <Card data-testid="card-tournament-network">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-600" />
            Tournament Network
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {members.length} coach{members.length === 1 ? "" : "es"} sharing this tournament.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => leave.mutate({ id: tournamentId })}
          disabled={leave.isPending}
        >
          <LogOut className="h-3.5 w-3.5 mr-1.5" />
          Leave
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          {visibleMembers.map((m) => (
            <div
              key={m.tournamentId}
              className="flex items-center justify-between text-sm rounded-md border bg-muted/20 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{m.teamName ?? "Unnamed team"}</span>
                {m.isYou && <Badge variant="secondary">You</Badge>}
                {!m.shareScores && (
                  <Badge variant="outline" className="text-xs">Not sharing scores</Badge>
                )}
              </div>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="text-xs text-muted-foreground italic px-1">
              + {hiddenCount} coach{hiddenCount === 1 ? "" : "es"} who haven't opted in to be visible
            </div>
          )}
        </div>

        {membership && (
          <div className="space-y-3 rounded-md border bg-muted/10 p-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Your privacy
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {membership.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  Show my team name to other coaches
                </div>
                <p className="text-xs text-muted-foreground">
                  Off by default. When on, others see your team's name in this card.
                </p>
              </div>
              <Switch
                checked={membership.visible}
                onCheckedChange={(checked) =>
                  updateMembership.mutate({
                    id: tournamentId,
                    data: { visible: checked },
                  })
                }
                disabled={updateMembership.isPending}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Share2 className="h-3.5 w-3.5" />
                  Share my scored games
                </div>
                <p className="text-xs text-muted-foreground">
                  On by default. Powers shared pool standings — turn off to keep your scores private.
                </p>
              </div>
              <Switch
                checked={membership.shareScores}
                onCheckedChange={(checked) =>
                  updateMembership.mutate({
                    id: tournamentId,
                    data: { shareScores: checked },
                  })
                }
                disabled={updateMembership.isPending}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
