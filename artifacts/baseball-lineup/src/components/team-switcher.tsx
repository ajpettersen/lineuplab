import { Check, ChevronDown, Users } from "lucide-react";
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
 */
export function TeamSwitcher({ className }: { className?: string }) {
  const { data: ctx, isLoading } = useTeamContext();
  const switchTeam = useSwitchTeam();
  const { toast } = useToast();

  // Only show when there's actually something to switch between.
  if (isLoading || !ctx || ctx.memberOf.length === 0) return null;

  const allTeams = [ctx.ownedTeam, ...ctx.memberOf];
  const active = allTeams.find((t) => t.ownerUserId === ctx.activeOwnerUserId);

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
                  {isOwn ? "Your team" : "Assistant coach"}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
