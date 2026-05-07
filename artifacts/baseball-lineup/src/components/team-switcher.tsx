import { Check, ChevronDown, LogOut, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useTeamContext, useSwitchTeam } from "@/hooks/use-team-context";
import { useToast } from "@/hooks/use-toast";

/**
 * Small dropdown shown in the header when the user belongs to more than
 * one team. Clicking a row swaps the active team (server-side pointer)
 * and clears the React Query cache so all data refetches in the new
 * scope.
 *
 * Special case: a master admin who has switched INTO a foreign team
 * they don't otherwise belong to (admin "view as this team" flow) won't
 * have that team in `memberOf`, so the dropdown would normally hide
 * itself. In that case we render a clearly-labeled "Return to <my team>"
 * button instead, so the admin can always get back to their own team
 * with one click.
 */
export function TeamSwitcher({ className }: { className?: string }) {
  const { data: ctx, isLoading } = useTeamContext();
  const switchTeam = useSwitchTeam();
  const { toast } = useToast();

  if (isLoading || !ctx) return null;

  const handleSwitch = (ownerUserId: string) => {
    if (ownerUserId === ctx.activeOwnerUserId) return;
    switchTeam.mutate(ownerUserId, {
      onError: (err) => {
        toast({
          title: "Couldn't switch teams",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      },
    });
  };

  const viewingForeignAsAdmin =
    ctx.currentUser.isMasterAdmin &&
    ctx.activeOwnerUserId !== ctx.ownedTeam.ownerUserId &&
    !ctx.memberOf.some((t) => t.ownerUserId === ctx.activeOwnerUserId);

  // Admin-bypass case: show a one-click "return to my team" button.
  if (viewingForeignAsAdmin && ctx.memberOf.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleSwitch(ctx.ownedTeam.ownerUserId)}
        disabled={switchTeam.isPending}
        className={`gap-2 border-accent/40 bg-accent/15 text-primary-foreground hover:bg-accent/25 hover:text-primary-foreground ${className ?? ""}`}
        data-testid="button-return-to-own-team"
        title={`Return to ${ctx.ownedTeam.teamName}`}
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline max-w-[160px] truncate">
          {switchTeam.isPending
            ? "Returning…"
            : `Return to ${ctx.ownedTeam.teamName}`}
        </span>
        <span className="sm:hidden">Return</span>
      </Button>
    );
  }

  // Only show the dropdown when there's actually something to switch
  // between (own team + at least one joined team, OR the admin-foreign
  // case above which falls through to here when memberOf is non-empty).
  if (ctx.memberOf.length === 0) return null;

  // If the admin is viewing a foreign team that isn't in memberOf,
  // surface it at the top of the list with a synthetic label so the
  // dropdown isn't pointing at a "missing" entry.
  const foreignAdminTeam = viewingForeignAsAdmin
    ? {
        ownerUserId: ctx.activeOwnerUserId,
        teamName: "Viewing as admin",
        teamShortName: "",
      }
    : null;
  const allTeams = [
    ...(foreignAdminTeam ? [foreignAdminTeam] : []),
    ctx.ownedTeam,
    ...ctx.memberOf,
  ];
  const active = allTeams.find((t) => t.ownerUserId === ctx.activeOwnerUserId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`gap-2 border-white/20 bg-white/5 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground ${className ?? ""}`}
          disabled={switchTeam.isPending}
          data-testid="button-team-switcher"
        >
          <Users className="h-4 w-4" />
          <span className="hidden md:inline max-w-[140px] truncate">
            {active?.teamName ?? "Team"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Switch team</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allTeams.map((t) => {
          const isActive = t.ownerUserId === ctx.activeOwnerUserId;
          const isOwn = t.ownerUserId === ctx.ownedTeam.ownerUserId;
          const isForeignAdmin =
            foreignAdminTeam && t.ownerUserId === foreignAdminTeam.ownerUserId;
          return (
            <DropdownMenuItem
              key={t.ownerUserId}
              onSelect={() => handleSwitch(t.ownerUserId)}
              data-testid={`menu-item-team-${t.ownerUserId}`}
              className="flex items-start gap-2"
            >
              <div className="w-4 mt-0.5">
                {isActive && <Check className="h-4 w-4 text-primary" />}
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="truncate font-medium">{t.teamName}</span>
                <span className="text-xs text-muted-foreground">
                  {isForeignAdmin
                    ? "Viewing as admin"
                    : isOwn
                      ? "Your team"
                      : "Assistant coach"}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
