import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShieldCheck,
  ChevronRight,
  Users,
  AlertTriangle,
  Sparkles,
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  MailQuestion,
  UserX,
} from "lucide-react";
import {
  useAdminMe,
  useAdminTeams,
  useAdminUsers,
  useAdminAiUsage,
  useAdminAiQuestions,
  useAdminOnboardingFunnel,
} from "@/hooks/use-admin";
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
 * Reusable click-to-sort table header. The `activeKey` + `dir`
 * pair drives the indicator icon: an up/down arrow when this column
 * is the current sort, or a faint two-headed arrow as an
 * affordance hint otherwise. `sortKey` is generic over whatever
 * union the parent uses so we can reuse this for other tables later.
 */
function SortableHead<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: "asc" | "desc";
  onClick: (key: K) => void;
  align?: "left" | "right";
}) {
  const isActive = sortKey === activeKey;
  const Icon = isActive ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        data-testid={`button-sort-${sortKey}`}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          align === "right" ? "ml-auto" : ""
        } ${isActive ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
        <Icon
          className={`h-3 w-3 ${isActive ? "opacity-100" : "opacity-40"}`}
        />
      </button>
    </TableHead>
  );
}

/**
 * Format a count of "active minutes" as a compact label. < 60 stays
 * as "Nm"; >= 60 collapses to "Xh Ym" (or just "Xh" when Y=0). Zero
 * renders as an em-dash so empty cells don't shout numbers.
 */
function formatMinutes(n: number): string {
  if (!n || n <= 0) return "—";
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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
  const aiUsageQuery = useAdminAiUsage(isAdmin);
  const aiQuestionsQuery = useAdminAiQuestions(isAdmin);
  const funnelQuery = useAdminOnboardingFunnel(isAdmin);
  const [showEmpty, setShowEmpty] = useState(false);

  // Users-table sort + filter. Default sort = lastSeen desc (matches
  // the server's default order so first paint is consistent before
  // the user touches a header).
  type UserSortKey = "name" | "lastSeen" | "min24h" | "min7d" | "min30d";
  const [userSortKey, setUserSortKey] = useState<UserSortKey>("lastSeen");
  const [userSortDir, setUserSortDir] = useState<"asc" | "desc">("desc");
  // Users-table activity filter. Tri-state so the two stat cards
  // ("Active now" → 5 min, "Active this week" → 7 d) can each act as
  // a click-to-filter shortcut, and the user can clear back to "all".
  type UserActivityFilter = "all" | "5m" | "7d";
  const [userActivityFilter, setUserActivityFilter] =
    useState<UserActivityFilter>("all");
  // Ref + scroll helper for the click-to-jump behavior on the stat
  // cards. `scrollIntoView` with `block: "start"` lands the table
  // header just below the sticky top bar.
  const usersCardRef = useRef<HTMLDivElement | null>(null);
  const jumpToUsers = (filter: UserActivityFilter) => {
    setUserActivityFilter(filter);
    // Defer one frame so the filter applies (and the table re-renders
    // to its new height) before we scroll.
    requestAnimationFrame(() => {
      usersCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };
  const toggleUserSort = (key: UserSortKey) => {
    if (key === userSortKey) {
      setUserSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setUserSortKey(key);
      // Numeric / time columns default to "biggest first" since
      // that's almost always what an admin wants to see.
      setUserSortDir(key === "name" ? "asc" : "desc");
    }
  };

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

  const allTeams = teamsQuery.data ?? [];
  const users = usersQuery.data ?? [];

  // "Empty" = orphaned (no coaches/members on the team). A team with
  // 0 members can't be administered by anyone, so we hide it from the
  // default view regardless of leftover players/games. Toggle "Show
  // empty teams" to surface them for cleanup.
  const isEmptyTeam = (t: { memberCount: number }) => t.memberCount === 0;
  const teams = showEmpty ? allTeams : allTeams.filter((t) => !isEmptyTeam(t));
  const hiddenCount = allTeams.length - teams.length;

  // "Active right now" = users with a heartbeat in the last 5 minutes.
  // Matches the heartbeat interval (60s) with a couple of skipped
  // pings of slack so a user who briefly tabbed away still counts.
  const nowMs = Date.now();
  const FIVE_MIN = 5 * 60 * 1000;
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const activeNowCount = users.filter(
    (u) => u.lastSeenAt && nowMs - new Date(u.lastSeenAt).getTime() <= FIVE_MIN,
  ).length;
  const active7dCount = users.filter(
    (u) =>
      u.lastSeenAt && nowMs - new Date(u.lastSeenAt).getTime() <= SEVEN_DAYS,
  ).length;

  // Filter + sort the user list. Filtering first means the column
  // sort indicators reflect what's actually rendered.
  const visibleUsers = users
    .filter((u) => {
      if (userActivityFilter === "all") return true;
      if (!u.lastSeenAt) return false;
      const age = nowMs - new Date(u.lastSeenAt).getTime();
      return userActivityFilter === "5m" ? age <= FIVE_MIN : age <= SEVEN_DAYS;
    })
    .slice()
    .sort((a, b) => {
      const dir = userSortDir === "asc" ? 1 : -1;
      switch (userSortKey) {
        case "name": {
          const aKey = (a.name ?? a.email ?? a.userId).toLowerCase();
          const bKey = (b.name ?? b.email ?? b.userId).toLowerCase();
          return aKey.localeCompare(bKey) * dir;
        }
        case "lastSeen": {
          const aT = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
          const bT = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
          return (aT - bT) * dir;
        }
        case "min24h":
          return (a.minutesActive24h - b.minutesActive24h) * dir;
        case "min7d":
          return (a.minutesActive7d - b.minutesActive7d) * dir;
        case "min30d":
          return (a.minutesActive30d - b.minutesActive30d) * dir;
      }
    });

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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="row-admin-activity-stats">
        {/* Click jumps to the Users table below and filters it to
            users with a heartbeat in the last 5 min. */}
        <button
          type="button"
          onClick={() => jumpToUsers("5m")}
          aria-label={`Show ${activeNowCount} users active in the last 5 minutes`}
          className="text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-shadow"
          data-testid="button-jump-active-now"
        >
          <Card
            data-testid="card-active-now"
            className="hover:border-primary/40 hover:shadow-sm transition cursor-pointer h-full"
          >
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <span className="relative inline-flex">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {activeNowCount > 0 && (
                    <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
                  )}
                </span>
                Active now
              </div>
              <div className="text-2xl font-mono tabular-nums mt-1">
                {activeNowCount}
              </div>
              <div className="text-[11px] text-muted-foreground">last 5 min · click to view</div>
            </CardContent>
          </Card>
        </button>
        {/* Click jumps to the Users table below and filters to last 7 d. */}
        <button
          type="button"
          onClick={() => jumpToUsers("7d")}
          aria-label={`Show ${active7dCount} users active in the last 7 days`}
          className="text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-shadow"
          data-testid="button-jump-active-7d"
        >
          <Card
            data-testid="card-active-7d"
            className="hover:border-primary/40 hover:shadow-sm transition cursor-pointer h-full"
          >
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Activity className="h-3 w-3" />
                Active this week
              </div>
              <div className="text-2xl font-mono tabular-nums mt-1">
                {active7dCount}
              </div>
              <div className="text-[11px] text-muted-foreground">
                of {users.length} {users.length === 1 ? "user" : "users"} · click to view
              </div>
            </CardContent>
          </Card>
        </button>
        <Card data-testid="card-team-count">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Users className="h-3 w-3" />
              Teams
            </div>
            <div className="text-2xl font-mono tabular-nums mt-1">
              {teams.length}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {hiddenCount > 0
                ? `${hiddenCount} orphaned hidden`
                : `${allTeams.length} total`}
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-user-count">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3" />
              Total users
            </div>
            <div className="text-2xl font-mono tabular-nums mt-1">
              {users.length}
            </div>
            <div className="text-[11px] text-muted-foreground">
              all coaches
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-admin-onboarding-funnel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailQuestion className="h-4 w-4" />
            Onboarding funnel
          </CardTitle>
          <CardDescription>
            People who haven&apos;t made it into a team row yet — pending
            invites and accounts that finished Clerk sign-up but never
            opened the app deeply enough to seed a membership.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {funnelQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : !funnelQuery.data ? (
            <div className="text-sm text-muted-foreground">
              {funnelQuery.error?.message ?? "Failed to load funnel."}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="rounded-md border p-3" data-testid="stat-pending-invites">
                  <div className="text-[11px] uppercase text-muted-foreground tracking-wide">
                    Pending invites
                  </div>
                  <div className="text-2xl font-mono tabular-nums mt-1">
                    {funnelQuery.data.pendingInvites.length}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    not accepted, not expired
                  </div>
                </div>
                <div className="rounded-md border p-3" data-testid="stat-expired-invites">
                  <div className="text-[11px] uppercase text-muted-foreground tracking-wide">
                    Expired invites
                  </div>
                  <div className="text-2xl font-mono tabular-nums mt-1">
                    {funnelQuery.data.expiredInvites.length}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    link rotted before accept
                  </div>
                </div>
                <div className="rounded-md border p-3" data-testid="stat-clerk-only">
                  <div className="text-[11px] uppercase text-muted-foreground tracking-wide">
                    In Clerk, not in DB
                  </div>
                  <div className="text-2xl font-mono tabular-nums mt-1">
                    {funnelQuery.data.clerkOnly.rows.length}
                    {funnelQuery.data.clerkOnly.truncated ? "+" : ""}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    of {funnelQuery.data.clerkOnly.totalKnown} total Clerk
                    users
                  </div>
                </div>
              </div>

              {funnelQuery.data.pendingInvites.length > 0 && (
                <div data-testid="section-pending-invites">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Pending invites
                  </div>
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invited</TableHead>
                          <TableHead>Team</TableHead>
                          <TableHead>From</TableHead>
                          <TableHead className="text-right">Sent</TableHead>
                          <TableHead className="text-right">Expires</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {funnelQuery.data.pendingInvites.map((inv) => (
                          <TableRow
                            key={inv.id}
                            data-testid={`row-pending-invite-${inv.id}`}
                          >
                            <TableCell className="font-medium">
                              {inv.invitedEmail ?? (
                                <span className="text-muted-foreground italic">
                                  link only ({inv.label ?? "no label"})
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/admin/teams/${encodeURIComponent(inv.ownerUserId)}`}
                                className="text-primary hover:underline"
                              >
                                {inv.teamName}
                              </Link>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {inv.ownerName ?? inv.ownerEmail ?? inv.ownerUserId}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground text-sm">
                              {relativeOrNever(inv.createdAt)}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground text-sm">
                              {relativeOrNever(inv.expiresAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {funnelQuery.data.clerkOnly.rows.length > 0 && (
                <div data-testid="section-clerk-only">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <UserX className="h-3 w-3" />
                    Signed up but never opened the app
                  </div>
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead className="text-right">Joined Clerk</TableHead>
                          <TableHead className="text-right">Last sign-in</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {funnelQuery.data.clerkOnly.rows.map((u) => (
                          <TableRow
                            key={u.userId}
                            data-testid={`row-clerk-only-${u.userId}`}
                          >
                            <TableCell className="font-medium">
                              {u.name ?? (
                                <span className="text-muted-foreground italic">
                                  no name
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {u.email ?? "—"}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground text-sm">
                              {relativeOrNever(u.createdAt)}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground text-sm">
                              {relativeOrNever(u.lastSignInAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {funnelQuery.data.clerkOnly.truncated && (
                    <div className="text-[11px] text-muted-foreground mt-2">
                      Showing the most-recently-created 500 — older
                      stragglers are clipped.
                    </div>
                  )}
                </div>
              )}

              {funnelQuery.data.expiredInvites.length > 0 && (
                <details data-testid="section-expired-invites">
                  <summary className="text-xs uppercase tracking-wide text-muted-foreground cursor-pointer">
                    Expired invites ({funnelQuery.data.expiredInvites.length})
                  </summary>
                  <div className="rounded-md border overflow-hidden mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invited</TableHead>
                          <TableHead>Team</TableHead>
                          <TableHead className="text-right">Expired</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {funnelQuery.data.expiredInvites.map((inv) => (
                          <TableRow
                            key={inv.id}
                            data-testid={`row-expired-invite-${inv.id}`}
                          >
                            <TableCell>
                              {inv.invitedEmail ?? (
                                <span className="text-muted-foreground italic">
                                  link only
                                </span>
                              )}
                            </TableCell>
                            <TableCell>{inv.teamName}</TableCell>
                            <TableCell className="text-right text-muted-foreground text-sm">
                              {relativeOrNever(inv.expiresAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </details>
              )}

              {funnelQuery.data.pendingInvites.length === 0 &&
                funnelQuery.data.clerkOnly.rows.length === 0 &&
                funnelQuery.data.expiredInvites.length === 0 && (
                  <div className="text-sm text-muted-foreground italic">
                    No one stuck right now. Everyone who&apos;s signed up has
                    a team row.
                  </div>
                )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-admin-ai-usage">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI usage
          </CardTitle>
          <CardDescription>
            Per-team OpenAI request counts. Each team is capped at{" "}
            <span className="font-mono">
              {aiUsageQuery.data?.budgetPerDay ?? "…"}
            </span>{" "}
            requests per rolling 24 h (override with the{" "}
            <span className="font-mono">AI_DAILY_TEAM_BUDGET</span> env var).
            Master-admin calls are exempt and not counted here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {aiUsageQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading usage…</div>
          ) : !aiUsageQuery.data ? (
            <div className="text-sm text-muted-foreground">
              {aiUsageQuery.error?.message ?? "Failed to load usage."}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3">
                  <div className="text-xs uppercase text-muted-foreground tracking-wide">
                    Last 24 h
                  </div>
                  <div className="text-2xl font-mono">
                    {aiUsageQuery.data.totals.last24h.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs uppercase text-muted-foreground tracking-wide">
                    Last 7 d
                  </div>
                  <div className="text-2xl font-mono">
                    {aiUsageQuery.data.totals.last7d.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs uppercase text-muted-foreground tracking-wide">
                    Last 30 d
                  </div>
                  <div className="text-2xl font-mono">
                    {aiUsageQuery.data.totals.last30d.toLocaleString()}
                  </div>
                </div>
              </div>

              {aiUsageQuery.data.perTeam.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No AI activity in the last 30 days.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-right">24 h</TableHead>
                      <TableHead className="text-right">7 d</TableHead>
                      <TableHead className="text-right">30 d</TableHead>
                      <TableHead>Top features (7 d)</TableHead>
                      <TableHead>Last call</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aiUsageQuery.data.perTeam.map((t) => {
                      const budget = aiUsageQuery.data!.budgetPerDay;
                      const overBudget = t.last24h >= budget;
                      const features = Object.entries(t.featureCounts)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 4);
                      return (
                        <TableRow
                          key={t.ownerUserId}
                          data-testid={`row-admin-ai-usage-${t.ownerUserId}`}
                        >
                          <TableCell>
                            <Link
                              href={`/admin/teams/${encodeURIComponent(t.ownerUserId)}`}
                              className="font-medium hover:underline"
                            >
                              {t.teamName}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {t.ownerName ?? t.ownerEmail ?? t.ownerUserId}
                            </div>
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums font-mono ${
                              overBudget ? "text-destructive font-semibold" : ""
                            }`}
                          >
                            {t.last24h}
                            <span className="text-muted-foreground text-xs">
                              {" "}/{budget}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-mono">
                            {t.last7d}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-mono">
                            {t.last30d}
                          </TableCell>
                          <TableCell>
                            {features.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {features.map(([feat, n]) => (
                                  <span
                                    key={feat}
                                    className="text-xs rounded bg-muted px-1.5 py-0.5"
                                  >
                                    {feat}{" "}
                                    <span className="text-muted-foreground">
                                      {n}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {relativeOrNever(t.lastCallAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-admin-teams">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>
              Teams ({teams.length}
              {hiddenCount > 0 && !showEmpty && (
                <span className="text-muted-foreground font-normal text-sm">
                  {" "}of {allTeams.length}
                </span>
              )}
              )
            </CardTitle>
            <CardDescription>
              Sorted by most recently active.
              {hiddenCount > 0 && !showEmpty && (
                <> Hiding {hiddenCount} orphaned team{hiddenCount === 1 ? "" : "s"} (no coaches).</>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-1">
            <Checkbox
              id="admin-show-empty"
              checked={showEmpty}
              onCheckedChange={(v) => setShowEmpty(v === true)}
              data-testid="checkbox-admin-show-empty"
            />
            <Label
              htmlFor="admin-show-empty"
              className="text-sm font-normal cursor-pointer"
            >
              Show empty teams
            </Label>
          </div>
        </CardHeader>
        <CardContent>
          {teamsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading teams…</div>
          ) : teams.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {allTeams.length === 0
                ? "No teams in the database yet."
                : "All teams are empty — check \"Show empty teams\" to see them."}
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

      <Card data-testid="card-admin-users" ref={usersCardRef}>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Users ({visibleUsers.length}
              {userActivityFilter !== "all" &&
                visibleUsers.length !== users.length && (
                  <span className="text-muted-foreground font-normal text-sm">
                    {" "}of {users.length}
                  </span>
                )}
              )
              {userActivityFilter !== "all" && (
                <span
                  className="ml-1 inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                  data-testid="badge-active-filter"
                >
                  {userActivityFilter === "5m" ? "Active now" : "Active this week"}
                </span>
              )}
            </CardTitle>
            <CardDescription>
              Every distinct Clerk user that has either created or joined
              a team. The "teams" column is the team name plus the user's
              permission tier on that team. "Last seen" + active-minute
              rollups come from a 60-second client heartbeat — only fires
              while a tab is open and the user is signed in, so closed
              tabs and offline coaches don't accumulate time. Click any
              column header to sort.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-1">
            {userActivityFilter !== "all" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setUserActivityFilter("all")}
                data-testid="button-clear-active-filter"
              >
                Clear filter
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="admin-active-only-7d"
                  checked={false}
                  onCheckedChange={(v) =>
                    setUserActivityFilter(v === true ? "7d" : "all")
                  }
                  data-testid="checkbox-admin-active-only-7d"
                />
                <Label
                  htmlFor="admin-active-only-7d"
                  className="text-sm font-normal cursor-pointer"
                >
                  Active in last 7 days
                </Label>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading users…</div>
          ) : visibleUsers.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {users.length === 0
                ? "No users."
                : "No users match the current filter."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead
                    label="User"
                    sortKey="name"
                    activeKey={userSortKey}
                    dir={userSortDir}
                    onClick={toggleUserSort}
                  />
                  <TableHead>Teams</TableHead>
                  <SortableHead
                    label="Last seen"
                    sortKey="lastSeen"
                    activeKey={userSortKey}
                    dir={userSortDir}
                    onClick={toggleUserSort}
                  />
                  <SortableHead
                    label="24 h"
                    sortKey="min24h"
                    activeKey={userSortKey}
                    dir={userSortDir}
                    onClick={toggleUserSort}
                    align="right"
                  />
                  <SortableHead
                    label="7 d"
                    sortKey="min7d"
                    activeKey={userSortKey}
                    dir={userSortDir}
                    onClick={toggleUserSort}
                    align="right"
                  />
                  <SortableHead
                    label="30 d"
                    sortKey="min30d"
                    activeKey={userSortKey}
                    dir={userSortDir}
                    onClick={toggleUserSort}
                    align="right"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleUsers.map((u) => {
                  // Per-row "active right now" dot — same 5-minute
                  // window as the summary card so a glance at the table
                  // tells you who's currently in the app, not just who
                  // logged in this week. Pulses (animate-ping) so it
                  // reads as live and not a static badge. The whole
                  // pip is wrapped in a fixed-width slot so rows don't
                  // shift when someone goes online/offline mid-render.
                  const lastSeenMs = u.lastSeenAt
                    ? new Date(u.lastSeenAt).getTime()
                    : 0;
                  const isActiveNow =
                    lastSeenMs > 0 && nowMs - lastSeenMs <= FIVE_MIN;
                  return (
                  <TableRow
                    key={u.userId}
                    data-testid={`row-admin-user-${u.userId}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="relative inline-flex w-2 h-2 shrink-0"
                          aria-label={isActiveNow ? "Active now" : "Not active"}
                          title={
                            isActiveNow ? "Active in the last 5 min" : undefined
                          }
                          data-testid={`dot-active-${u.userId}`}
                        >
                          {isActiveNow ? (
                            <>
                              <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
                              <span className="relative h-2 w-2 rounded-full bg-emerald-500" />
                            </>
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-muted-foreground/20" />
                          )}
                        </span>
                        <div className="text-sm font-medium">
                          {u.name ?? u.email ?? "—"}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {u.userId}
                      </div>
                      {u.email && u.name && (
                        <div className="text-xs text-muted-foreground">
                          {u.email}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.teams.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
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
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {relativeOrNever(u.lastSeenAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-mono text-xs">
                      {formatMinutes(u.minutesActive24h)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-mono text-xs">
                      {formatMinutes(u.minutesActive7d)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-mono text-xs">
                      {formatMinutes(u.minutesActive30d)}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* AI Assistant questions live at the very bottom: it's a long,
          newest-100 activity log that's useful for spot-checking what
          coaches ask, but it shouldn't push the Teams + Users tables
          (the "who is actually using the app" view) below the fold. */}
      <Card data-testid="card-admin-ai-questions">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Assistant questions
          </CardTitle>
          <CardDescription>
            What coaches are typing into the in-game AI Assistant. Newest 100
            shown. Master-admin's own calls are included.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {aiQuestionsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading questions…</div>
          ) : !aiQuestionsQuery.data ? (
            <div className="text-sm text-muted-foreground">
              {aiQuestionsQuery.error?.message ?? "Failed to load questions."}
            </div>
          ) : aiQuestionsQuery.data.questions.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No AI Assistant questions logged yet.
            </div>
          ) : (
            <div className="space-y-3">
              {aiQuestionsQuery.data.questions.map((q) => {
                const intentClass =
                  q.intent === "answer"
                    ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                    : q.intent === "regenerate"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                      : q.intent === "remove"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                        : q.intent === "error"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted text-muted-foreground";
                return (
                  <div
                    key={q.id}
                    className="rounded-md border p-3 space-y-1.5"
                    data-testid={`row-admin-ai-question-${q.id}`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <Link
                          href={`/admin/teams/${encodeURIComponent(q.ownerUserId)}`}
                          className="font-medium hover:underline"
                        >
                          {q.teamName}
                        </Link>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">
                          {q.askerName ?? q.askerEmail ?? q.askedByUserId}
                        </span>
                        {q.gameId !== null && (
                          <>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground font-mono">
                              game #{q.gameId}
                            </span>
                          </>
                        )}
                        <span
                          className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${intentClass}`}
                        >
                          {q.intent}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {relativeOrNever(q.createdAt)}
                      </div>
                    </div>
                    <div className="text-sm whitespace-pre-wrap break-words">
                      {q.question}
                    </div>
                    {q.responsePreview && (
                      <div className="text-xs text-muted-foreground italic whitespace-pre-wrap break-words border-l-2 pl-2">
                        {q.responsePreview}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
