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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  useTeamContext,
  useTeamInvites,
  useTeamMembers,
  useCreateInvite,
  useRevokeInvite,
  useRemoveMember,
  useUpdateMember,
  type TeamInvite,
  type PermissionTier,
} from "@/hooks/use-team-context";
import { usePermission } from "@/hooks/use-permission";
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
  Crown,
  Eye,
  Pencil,
  Upload,
} from "lucide-react";

// Display label + suggested role title for each permission tier. The
// suggested role is just a default that we drop into the role field on
// the coach-profile prompt; it's free-form and the coach can edit it.
const PERMISSION_LABEL: Record<PermissionTier, string> = {
  full: "Head Coach (full access)",
  partial: "Assistant Coach (edit lineups & games)",
  upload: "GameChanger (box-score upload only)",
  view: "Read-only",
};

function PermissionBadge({ tier }: { tier: PermissionTier }) {
  const cls =
    tier === "full"
      ? "text-blue-700 bg-blue-50 border-blue-200"
      : tier === "partial"
        ? "text-emerald-700 bg-emerald-50 border-emerald-200"
        : tier === "upload"
          ? "text-violet-700 bg-violet-50 border-violet-200"
          : "text-muted-foreground bg-muted border-border";
  const Icon =
    tier === "full"
      ? Crown
      : tier === "partial"
        ? Pencil
        : tier === "upload"
          ? Upload
          : Eye;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}
      data-testid={`badge-permission-${tier}`}
    >
      <Icon className="h-3 w-3" />
      {PERMISSION_LABEL[tier]}
    </span>
  );
}

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
  const { can, tier } = usePermission();
  const isOwnTeam = !!ctx?.isOwner;
  // The server only lets the actual team owner (or a master admin)
  // change permission tiers and manage invites — a non-owner coach
  // who was promoted to 'full' can read/write team data but cannot
  // re-grant permissions. Mirror that here so we don't render a
  // permission Select that 403s on submit.
  const isMasterAdmin = !!ctx?.currentUser.isMasterAdmin;
  const canManageCoaches = (isOwnTeam || isMasterAdmin) && can("full");

  const invitesQuery = useTeamInvites();
  const membersQuery = useTeamMembers();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const removeMember = useRemoveMember();
  const updateMember = useUpdateMember();

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

  const onChangePermission = (
    memberUserId: string,
    permission: PermissionTier,
  ): void => {
    updateMember.mutate(
      { memberUserId, permission },
      {
        onSuccess: () =>
          toast({
            title: `Updated to ${PERMISSION_LABEL[permission].toLowerCase()}`,
          }),
        onError: (err) =>
          toast({
            title: "Couldn't change access",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          }),
      },
    );
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
        {/* Invite form — only the head coach (full tier) can mint
            invites. Hidden entirely for assistants so the UI doesn't
            tease an action that 403s on click. */}
        {canManageCoaches && (
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
        )}

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
                // Best display name: per-team displayName (their choice
                // for this team) → Clerk full name → email → generic.
                const primaryLabel =
                  m.displayName ?? m.memberName ?? m.memberEmail ?? "Coach";
                // The owner row's permission is locked to 'full' on the
                // server side; show "Head Coach" in the role slot if
                // they didn't pick their own role label.
                const roleLabel =
                  m.role ?? (m.isOwner ? "Head Coach" : null);
                return (
                  <li
                    key={m.id}
                    className="flex items-center gap-3 px-3 py-2"
                    data-testid={`row-coach-${m.memberUserId}`}
                  >
                    {m.isOwner ? (
                      <Crown className="h-4 w-4 text-amber-500 shrink-0" />
                    ) : (
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {primaryLabel}
                        {isSelf && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {roleLabel && <span>{roleLabel}</span>}
                        {roleLabel && m.memberEmail && (
                          <span className="mx-1">·</span>
                        )}
                        {m.memberEmail && <span>{m.memberEmail}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Joined {new Date(m.joinedAt).toLocaleDateString()}
                      </div>
                      {/* Show Clerk user ID for the signed-in coach so
                          they can paste it into MASTER_ADMIN_USER_IDS
                          without digging through the Clerk dashboard. */}
                      {isSelf && (
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(m.memberUserId);
                            toast({
                              title: "Copied",
                              description: "Your Clerk user ID is on the clipboard.",
                            });
                          }}
                          className="mt-1 inline-flex items-center gap-1 rounded border border-dashed border-muted-foreground/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          data-testid="button-copy-self-user-id"
                          title="Click to copy. Paste into the MASTER_ADMIN_USER_IDS secret to grant master-admin access."
                        >
                          <Copy className="h-2.5 w-2.5" />
                          {m.memberUserId}
                        </button>
                      )}
                    </div>
                    {/* Owner row: locked badge. Non-owner row + caller
                        is owner: editable Select. Otherwise: badge only. */}
                    {m.isOwner ? (
                      <PermissionBadge tier="full" />
                    ) : canManageCoaches && !isSelf ? (
                      <Select
                        value={m.permission}
                        onValueChange={(v) =>
                          onChangePermission(
                            m.memberUserId,
                            v as PermissionTier,
                          )
                        }
                        disabled={updateMember.isPending}
                      >
                        <SelectTrigger
                          className="h-8 w-[180px] text-xs"
                          data-testid={`select-permission-${m.memberUserId}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full">
                            {PERMISSION_LABEL.full}
                          </SelectItem>
                          <SelectItem value="partial">
                            {PERMISSION_LABEL.partial}
                          </SelectItem>
                          <SelectItem value="upload">
                            {PERMISSION_LABEL.upload}
                          </SelectItem>
                          <SelectItem value="view">
                            {PERMISSION_LABEL.view}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <PermissionBadge tier={m.permission} />
                    )}
                    {/* Remove button: visible for self (leave team) OR
                        for the head coach removing an assistant. The
                        head coach's own row has neither (you can't kick
                        yourself off your own team). */}
                    {!m.isOwner && (canManageCoaches || isSelf) && (
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
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {/* Permission tier explainer — only useful when there's
              more than one coach + caller can actually edit tiers. */}
          {canManageCoaches && members.length > 1 && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="text-permission-help"
            >
              <Crown className="inline h-3 w-3 mr-1" />
              Head Coach = everything ·
              <Pencil className="inline h-3 w-3 mx-1" />
              Assistant = lineups / games / practices ·
              <Upload className="inline h-3 w-3 mx-1" />
              GameChanger = box-score upload only ·
              <Eye className="inline h-3 w-3 mx-1" />
              Read-only = no edits
            </p>
          )}
          {!canManageCoaches && tier !== "full" && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="text-permission-locked"
            >
              Only the head coach can change access levels or invite new
              coaches. Ask them if you need a different tier.
            </p>
          )}
        </div>

        {/* Pending invites — only meaningful for the head coach who
            can actually mint and revoke them. */}
        {canManageCoaches && pending.length > 0 && (
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

        {/* Invite history — same gating as the rest of the invite UI. */}
        {canManageCoaches && past.length > 0 && (
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
