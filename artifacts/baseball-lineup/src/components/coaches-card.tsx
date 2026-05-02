import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  useTeamContext,
  useTeamInvites,
  useTeamMembers,
  useCreateInvite,
  useRevokeInvite,
  useRemoveMember,
  type TeamInvite,
} from "@/hooks/use-team-context";
import {
  Copy,
  Loader2,
  UserPlus,
  Users,
  X,
  Mail,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function inviteUrl(token: string): string {
  return `${window.location.origin}${BASE}/join/${encodeURIComponent(token)}`;
}

function inviteStatus(invite: TeamInvite): {
  label: string;
  tone: "pending" | "accepted" | "revoked" | "expired";
} {
  if (invite.acceptedAt) return { label: "Accepted", tone: "accepted" };
  if (invite.revokedAt) return { label: "Revoked", tone: "revoked" };
  if (new Date(invite.expiresAt).getTime() < Date.now())
    return { label: "Expired", tone: "expired" };
  return { label: "Pending", tone: "pending" };
}

function StatusBadge({ tone, label }: { tone: string; label: string }) {
  const Icon =
    tone === "accepted"
      ? CheckCircle2
      : tone === "revoked" || tone === "expired"
        ? XCircle
        : Clock;
  const cls =
    tone === "accepted"
      ? "text-green-700 bg-green-50 border-green-200"
      : tone === "revoked"
        ? "text-muted-foreground bg-muted border-border"
        : tone === "expired"
          ? "text-amber-700 bg-amber-50 border-amber-200"
          : "text-blue-700 bg-blue-50 border-blue-200";
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function CoachesCard() {
  const { toast } = useToast();
  const { data: ctx } = useTeamContext();
  const isOwnTeam = !!ctx?.isOwner;

  const invitesQuery = useTeamInvites();
  const membersQuery = useTeamMembers();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const removeMember = useRemoveMember();

  const [newLabel, setNewLabel] = useState("");
  const [justCreated, setJustCreated] = useState<TeamInvite | null>(null);

  const onCreate = () => {
    createInvite.mutate(newLabel.trim() || undefined, {
      onSuccess: (invite) => {
        setNewLabel("");
        setJustCreated(invite);
        // Auto-copy to clipboard for convenience.
        const url = inviteUrl(invite.token);
        navigator.clipboard?.writeText(url).then(
          () => toast({ title: "Invite link created and copied" }),
          () => toast({ title: "Invite link created" }),
        );
      },
      onError: (err) => {
        toast({
          title: "Couldn't create invite",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      },
    });
  };

  const onCopy = (token: string) => {
    const url = inviteUrl(token);
    navigator.clipboard?.writeText(url).then(
      () => toast({ title: "Copied invite link" }),
      () => toast({ title: "Copy failed", variant: "destructive" }),
    );
  };

  const onRevoke = (id: number) => {
    revokeInvite.mutate(id, {
      onSuccess: () => toast({ title: "Invite revoked" }),
      onError: (err) =>
        toast({
          title: "Couldn't revoke invite",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    });
  };

  const onRemoveMember = (memberUserId: string) => {
    removeMember.mutate(memberUserId, {
      onSuccess: () => toast({ title: "Coach removed" }),
      onError: (err) =>
        toast({
          title: "Couldn't remove coach",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    });
  };

  // Active (pending) invites first, then history (accepted/revoked/expired).
  const invites = invitesQuery.data ?? [];
  const pending = invites.filter(
    (i) =>
      !i.acceptedAt &&
      !i.revokedAt &&
      new Date(i.expiresAt).getTime() >= Date.now(),
  );
  const past = invites.filter((i) => !pending.includes(i));
  const members = membersQuery.data ?? [];

  return (
    <Card data-testid="card-coaches">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          Coaches
        </CardTitle>
        <CardDescription>
          {isOwnTeam
            ? "Invite an assistant coach to share full access to this team's roster, schedule, lineups, and AI memory."
            : "You're an assistant coach on this team. You can invite other coaches and remove yourself, but only the head coach can be removed by themselves."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Invite form */}
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Optional label (e.g. 'Coach Sam')"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              maxLength={60}
              disabled={createInvite.isPending}
              data-testid="input-invite-label"
            />
            <Button
              onClick={onCreate}
              disabled={createInvite.isPending}
              className="gap-2 sm:w-auto"
              data-testid="button-create-invite"
            >
              {createInvite.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Create invite link
            </Button>
          </div>
          {justCreated && (
            <div
              className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm"
              data-testid="banner-just-created"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-blue-900 mb-1">
                  Share this link with your assistant coach
                </div>
                <code className="block truncate text-xs text-blue-800">
                  {inviteUrl(justCreated.token)}
                </code>
                <div className="text-xs text-blue-700 mt-1">
                  Single-use • expires{" "}
                  {new Date(justCreated.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onCopy(justCreated.token)}
                data-testid="button-copy-just-created"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Current coaches */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Active coaches</h3>
          {membersQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : members.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Just you (head coach) for now.
            </div>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="list-coaches">
              {members.map((m) => {
                const isSelf = m.memberUserId === ctx?.userId;
                return (
                  <li
                    key={m.id}
                    className="flex items-center gap-3 px-3 py-2"
                    data-testid={`row-coach-${m.memberUserId}`}
                  >
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {m.memberName ?? m.memberEmail ?? "Coach"}
                        {isSelf && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </div>
                      {m.memberName && m.memberEmail && (
                        <div className="text-xs text-muted-foreground truncate">
                          {m.memberEmail}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        Joined {new Date(m.joinedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          data-testid={`button-remove-coach-${m.memberUserId}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {isSelf ? "Leave this team?" : "Remove this coach?"}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {isSelf
                              ? "You'll lose access to this team's roster, games, and lineups. You'll be returned to your own team. The head coach can re-invite you any time."
                              : "They'll immediately lose access to this team's data. They keep their own team. You can re-invite them later if you change your mind."}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => onRemoveMember(m.memberUserId)}
                            className="bg-destructive hover:bg-destructive/90"
                          >
                            {isSelf ? "Leave team" : "Remove coach"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Pending invites */}
        {pending.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Pending invites</h3>
            <ul className="divide-y rounded-md border" data-testid="list-pending-invites">
              {pending.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center gap-3 px-3 py-2"
                  data-testid={`row-invite-${inv.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {inv.label ?? "Untitled invite"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCopy(inv.token)}
                    className="gap-1"
                    data-testid={`button-copy-invite-${inv.id}`}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onRevoke(inv.id)}
                    data-testid={`button-revoke-invite-${inv.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Invite history */}
        {past.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Invite history ({past.length})
            </summary>
            <ul className="divide-y rounded-md border mt-2" data-testid="list-past-invites">
              {past.map((inv) => {
                const status = inviteStatus(inv);
                return (
                  <li
                    key={inv.id}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {inv.label ?? "Untitled invite"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Created {new Date(inv.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <StatusBadge tone={status.tone} label={status.label} />
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
