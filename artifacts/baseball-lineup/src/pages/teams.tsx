import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Check, Plus, Shield, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useTeamContext,
  useSwitchTeam,
  useCreateTeam,
} from "@/hooks/use-team-context";
import { useToast } from "@/hooks/use-toast";

/**
 * "My Teams" picker page (GameChanger-style): every team the coach
 * owns or belongs to as a card. Tapping a card switches the active
 * team and lands on the dashboard. A "Create team" card spins up an
 * additional team (new season, new year, second squad…).
 *
 * The create dialog can be deep-linked with `/teams?create=1` (used by
 * the header team switcher's "Create a new team" item).
 */
export default function Teams() {
  const { data: ctx, isLoading } = useTeamContext();
  const switchTeam = useSwitchTeam();
  const createTeam = useCreateTeam();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const search = useSearch();

  const [createOpen, setCreateOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);

  // Deep link: /teams?create=1 opens the dialog immediately.
  useEffect(() => {
    if (new URLSearchParams(search).get("create")) {
      setCreateOpen(true);
      // Clean the param so closing the dialog doesn't reopen it on nav.
      setLocation("/teams", { replace: true });
    }
  }, [search, setLocation]);

  if (isLoading || !ctx) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const ownedTeams = ctx.ownedTeams ?? [ctx.ownedTeam];
  const ownedIds = new Set(ownedTeams.map((t) => t.ownerUserId));
  const allTeams = [...ownedTeams, ...ctx.memberOf];

  const handleSelect = (ownerUserId: string) => {
    if (switchTeam.isPending) return;
    if (ownerUserId === ctx.activeOwnerUserId) {
      setLocation("/");
      return;
    }
    setPendingSwitchId(ownerUserId);
    switchTeam.mutate(ownerUserId, {
      onSuccess: () => setLocation("/"),
      onError: (err) => {
        setPendingSwitchId(null);
        toast({
          title: "Couldn't switch teams",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      },
    });
  };

  const handleCreate = () => {
    const name = teamName.trim();
    if (name.length < 2) {
      toast({
        title: "Team name is too short",
        description: "Give your team a name of at least 2 characters.",
        variant: "destructive",
      });
      return;
    }
    createTeam.mutate(
      { teamName: name },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setTeamName("");
          toast({ title: `${name} created`, description: "You're now on your new team." });
          setLocation("/");
        },
        onError: (err) => {
          toast({
            title: "Couldn't create team",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2
          className="text-2xl font-bold font-broadcast uppercase tracking-wide"
          data-testid="text-teams-title"
        >
          My Teams
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Pick a team to work with, or create a new one for a new season or
          squad.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {allTeams.map((t) => {
          const isActive = t.ownerUserId === ctx.activeOwnerUserId;
          const isOwn = ownedIds.has(t.ownerUserId);
          const isSwitchingThis =
            switchTeam.isPending && pendingSwitchId === t.ownerUserId;
          return (
            <Card
              key={t.ownerUserId}
              role="button"
              tabIndex={0}
              onClick={() => handleSelect(t.ownerUserId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelect(t.ownerUserId);
                }
              }}
              className={`cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring outline-none ${
                isActive ? "border-primary ring-1 ring-primary/40" : ""
              } ${switchTeam.isPending && !isSwitchingThis ? "opacity-60 pointer-events-none" : ""}`}
              data-testid={`card-team-${t.ownerUserId}`}
            >
              <CardContent className="p-5 flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary">
                  <Shield className="h-6 w-6 text-primary-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{t.teamName}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1 mt-0.5">
                    {isOwn ? (
                      "Head coach"
                    ) : (
                      <>
                        <Users className="h-3 w-3" /> Assistant coach
                      </>
                    )}
                  </div>
                </div>
                {isSwitchingThis ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                ) : isActive ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-1"
                    data-testid={`badge-current-team-${t.ownerUserId}`}
                  >
                    <Check className="h-3 w-3" /> Current
                  </span>
                ) : null}
              </CardContent>
            </Card>
          );
        })}

        {/* Create-team card */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setCreateOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setCreateOpen(true);
            }
          }}
          className="cursor-pointer border-dashed hover:shadow-md transition-shadow focus-visible:ring-2 focus-visible:ring-ring outline-none"
          data-testid="card-create-team"
        >
          <CardContent className="p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40">
              <Plus className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold">Create a new team</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                New season, new year, or a second squad
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create a new team</DialogTitle>
            <DialogDescription>
              Starts a fresh team with its own roster, schedule, and stats.
              You can switch between your teams anytime.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="new-team-name">Team name</Label>
            <Input
              id="new-team-name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Rockets 12U — 2027"
              maxLength={60}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
              data-testid="input-new-team-name"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createTeam.isPending}
              data-testid="button-cancel-create-team"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createTeam.isPending || teamName.trim().length < 2}
              data-testid="button-confirm-create-team"
            >
              {createTeam.isPending ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
