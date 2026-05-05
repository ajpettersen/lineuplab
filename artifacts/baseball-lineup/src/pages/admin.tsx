import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShieldCheck, ChevronRight, Users, AlertTriangle } from "lucide-react";
import { useAdminMe, useAdminTeams, useAdminUsers } from "@/hooks/use-admin";
import { formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function relativeOrNever(iso: string | null): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

/**
 * Master-admin landing page. Lists every team in the database and
 * (collapsed below) every distinct user that's ever joined a team.
 *
 * Access is purely server-enforced via `requireMasterAdmin` — the
 * endpoints 403 for non-admins regardless of how the URL is reached.
 * The early-return below is a UX courtesy so non-admins who somehow
 * land here see a clear "you don't have access" panel instead of a
 * loading spinner over an empty table.
 */
export default function Admin() {
  const meQuery = useAdminMe();
  const isAdmin = !!meQuery.data?.isMasterAdmin;
  const teamsQuery = useAdminTeams(isAdmin);
  const usersQuery = useAdminUsers(isAdmin);

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

  const teams = teamsQuery.data ?? [];
  const users = usersQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="eyebrow text-primary/70 flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5" />
          Master Admin
        </div>
        <h1 className="page-title text-foreground mt-1">All teams</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Every team in the database, with member + activity counts.
          Click a row to drill into a team and switch into it as the
          head coach.
        </p>
      </div>

      <Card data-testid="card-admin-teams">
        <CardHeader>
          <CardTitle>Teams ({teams.length})</CardTitle>
          <CardDescription>
            Sorted by most recently active.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {teamsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading teams…</div>
          ) : teams.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No teams in the database yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Head coach</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Players</TableHead>
                  <TableHead className="text-right">Games</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((t) => (
                  <TableRow
                    key={t.ownerUserId}
                    data-testid={`row-admin-team-${t.ownerUserId}`}
                  >
                    <TableCell>
                      <div className="font-medium">{t.teamName}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.teamShortName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {t.ownerName ?? t.ownerEmail ?? "—"}
                      </div>
                      {t.ownerName && t.ownerEmail && (
                        <div className="text-xs text-muted-foreground">
                          {t.ownerEmail}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.memberCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.playerCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.gameCount}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {relativeOrNever(t.lastActivityAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/admin/teams/${encodeURIComponent(t.ownerUserId)}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`button-view-admin-team-${t.ownerUserId}`}
                        >
                          View
                          <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-admin-users">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Users ({users.length})
          </CardTitle>
          <CardDescription>
            Every distinct Clerk user that has either created or joined
            a team. The "teams" column is the team name plus the user's
            permission tier on that team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading users…</div>
          ) : users.length === 0 ? (
            <div className="text-sm text-muted-foreground">No users.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Teams</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow
                    key={u.userId}
                    data-testid={`row-admin-user-${u.userId}`}
                  >
                    <TableCell>
                      <div className="text-sm font-medium">
                        {u.name ?? u.email ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {u.userId}
                      </div>
                      {u.email && u.name && (
                        <div className="text-xs text-muted-foreground">
                          {u.email}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <ul className="space-y-1 text-xs">
                        {u.teams.map((t) => (
                          <li
                            key={t.ownerUserId}
                            className="flex items-center gap-1"
                          >
                            <Link
                              href={`/admin/teams/${encodeURIComponent(t.ownerUserId)}`}
                              className="text-primary hover:underline"
                            >
                              {t.ownerUserId}
                            </Link>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground">
                              {t.isOwner ? "owner" : t.permission}
                            </span>
                            {t.role && (
                              <>
                                <span className="text-muted-foreground">·</span>
                                <span className="text-muted-foreground">
                                  {t.role}
                                </span>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
