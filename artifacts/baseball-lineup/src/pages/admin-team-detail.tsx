import { useRoute, Link, useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ShieldCheck, AlertTriangle, LogIn } from "lucide-react";
import { useAdminMe, useAdminTeamDetail } from "@/hooks/use-admin";
import { useSwitchTeam } from "@/hooks/use-team-context";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Admin detail view for one team. Shows the full member list (with
 * profile + permission tier) and recent games. The "View as this
 * team" button uses the existing /team/active endpoint — master
 * admins now bypass the membership check, so this works even when
 * the admin isn't actually invited to the team.
 */
export default function AdminTeamDetail() {
  const [, params] = useRoute("/admin/teams/:ownerUserId");
  const ownerUserId = params?.ownerUserId ?? null;
  const meQuery = useAdminMe();
  const isAdmin = !!meQuery.data?.isMasterAdmin;
  const detailQuery = useAdminTeamDetail(ownerUserId, isAdmin);
  const switchTeam = useSwitchTeam();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  if (meQuery.isLoading) {
    return (
      <div className="text-sm text-muted-foreground">Checking access…</div>
    );
  }

  if (!isAdmin) {
    return (
      <Card data-testid="card-admin-denied">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Access denied
          </CardTitle>
          <CardDescription>
            This page is only available to master admins.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const team = detailQuery.data;
  const handleViewAs = (): void => {
    if (!ownerUserId) return;
    switchTeam.mutate(ownerUserId, {
      onSuccess: () => {
        toast({
          title: `Switched into ${team?.teamName ?? "team"}`,
          description: "You're now viewing the app as this team.",
        });
        setLocation("/");
      },
      onError: (err) =>
        toast({
          title: "Couldn't switch teams",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin">
            <Button variant="ghost" size="sm" className="-ml-2 mb-2" data-testid="button-back-admin">
              <ArrowLeft className="h-4 w-4 mr-1" />
              All teams
            </Button>
          </Link>
          <div className="eyebrow text-primary/70 flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5" />
            Master Admin · Team detail
          </div>
          <h1 className="page-title text-foreground mt-1">
            {detailQuery.isLoading ? "Loading…" : (team?.teamName ?? "Team")}
          </h1>
          {team && (
            <p className="text-muted-foreground mt-1 text-sm">
              {team.teamShortName} · Head coach{" "}
              {team.ownerName ?? team.ownerEmail ?? team.ownerUserId}
            </p>
          )}
        </div>
        <Button
          onClick={handleViewAs}
          disabled={switchTeam.isPending || !team}
          data-testid="button-view-as-team"
        >
          <LogIn className="h-4 w-4 mr-2" />
          {switchTeam.isPending ? "Switching…" : "View as this team"}
        </Button>
      </div>

      {detailQuery.isError && (
        <Card data-testid="card-admin-error">
          <CardHeader>
            <CardTitle className="text-destructive">
              Couldn't load team
            </CardTitle>
            <CardDescription>
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "Unknown error"}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {team && (
        <>
          <Card data-testid="card-admin-team-members">
            <CardHeader>
              <CardTitle>Coaches ({team.members.length})</CardTitle>
              <CardDescription>
                Everyone with a row on this team — head coach plus assistants.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {team.members.length === 0 ? (
                <div className="text-sm text-muted-foreground">No coaches.</div>
              ) : (
                <ul className="divide-y rounded-md border">
                  {team.members.map((m) => (
                    <li
                      key={m.memberUserId}
                      className="flex items-start gap-3 px-3 py-2"
                      data-testid={`row-admin-member-${m.memberUserId}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {m.displayName ?? m.memberName ?? m.memberEmail ?? "Coach"}
                          {m.isOwner && (
                            <span className="ml-2 text-xs text-amber-600 font-semibold uppercase tracking-wide">
                              Owner
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {m.role && <span>{m.role} · </span>}
                          {m.memberEmail ?? m.memberUserId}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono truncate">
                          {m.memberUserId}
                        </div>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-muted text-muted-foreground">
                        {m.permission}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-admin-team-games">
            <CardHeader>
              <CardTitle>Recent games ({team.recentGames.length})</CardTitle>
              <CardDescription>
                The 20 most recent games on this team.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {team.recentGames.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No games scheduled yet.
                </div>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {team.recentGames.map((g) => (
                    <li
                      key={g.id}
                      className="flex items-center justify-between px-3 py-2"
                      data-testid={`row-admin-game-${g.id}`}
                    >
                      <span className="font-medium">vs. {g.opponent}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(g.gameDate).toLocaleString()} · {g.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
