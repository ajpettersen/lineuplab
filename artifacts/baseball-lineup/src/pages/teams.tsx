import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  Archive,
  ArchiveRestore,
  Check,
  MoreVertical,
  Plus,
  Shield,
  Star,
  Trash2,
  Users,
} from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useTeamContext,
  useSwitchTeam,
  useCreateTeam,
  useTeamRosterForClone,
  useSetDefaultTeam,
  useArchiveTeam,
  useUnarchiveTeam,
  useDeleteTeam,
  type TeamSummary,
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
  const setDefaultTeam = useSetDefaultTeam();
  const archiveTeam = useArchiveTeam();
  const unarchiveTeam = useUnarchiveTeam();
  const deleteTeam = useDeleteTeam();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const search = useSearch();

  // Team pending permanent deletion, awaiting typed confirmation. Null
  // when the dialog is closed.
  const [deleteTarget, setDeleteTarget] = useState<TeamSummary | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  // "" = start fresh with an empty roster. Any other value = ownerUserId
  // of a team the coach owns, whose settings + a chosen subset of
  // players get copied into the new team.
  const [cloneFromId, setCloneFromId] = useState<string>("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<number>>(new Set());
  const { data: cloneRoster = [], isLoading: cloneRosterLoading } =
    useTeamRosterForClone(cloneFromId || null);

  // Default every player to "included" each time a new source team's
  // roster loads, so the common case (keep almost everyone) needs zero
  // clicks — the coach just unchecks the couple of kids who aren't
  // playing this season.
  useEffect(() => {
    setSelectedPlayerIds(new Set(cloneRoster.map((p) => p.id)));
  }, [cloneRoster]);

  const resetCreateForm = () => {
    setTeamName("");
    setCloneFromId("");
    setSelectedPlayerIds(new Set());
  };

  const togglePlayer = (id: number) => {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      {
        teamName: name,
        ...(cloneFromId
          ? { cloneFromOwnerUserId: cloneFromId, playerIds: Array.from(selectedPlayerIds) }
          : {}),
      },
      {
        onSuccess: (result) => {
          setCreateOpen(false);
          resetCreateForm();
          const cloned = result.clonedPlayerCount ?? 0;
          toast({
            title: `${name} created`,
            description:
              cloned > 0
                ? `Copied ${cloned} player${cloned === 1 ? "" : "s"} and your team settings. You're now on your new team.`
                : "You're now on your new team.",
          });
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

  const handleSetDefault = (t: TeamSummary) => {
    setDefaultTeam.mutate(t.ownerUserId, {
      onSuccess: () => toast({ title: `${t.teamName} is now your default team` }),
      onError: (err) =>
        toast({
          title: "Couldn't set default",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    });
  };

  const handleArchive = (t: TeamSummary) => {
    archiveTeam.mutate(t.ownerUserId, {
      onSuccess: () => toast({ title: `${t.teamName} archived`, description: "Its data is untouched — unarchive it anytime." }),
      onError: (err) =>
        toast({
          title: "Couldn't archive team",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    });
  };

  const handleUnarchive = (t: TeamSummary) => {
    unarchiveTeam.mutate(t.ownerUserId, {
      onSuccess: () => toast({ title: `${t.teamName} restored to My Teams` }),
      onError: (err) =>
        toast({
          title: "Couldn't unarchive team",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    });
  };

  const handleDeleteConfirmed = () => {
    if (!deleteTarget) return;
    deleteTeam.mutate(deleteTarget.ownerUserId, {
      onSuccess: () => {
        toast({ title: `${deleteTarget.teamName} deleted permanently` });
        setDeleteTarget(null);
        setDeleteConfirmText("");
      },
      onError: (err) =>
        toast({
          title: "Couldn't delete team",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    });
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
          const isPersonal = t.ownerUserId === ctx.userId;
          const isDefault = t.ownerUserId === ctx.defaultOwnerUserId;
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
                  <div className="font-semibold truncate flex items-center gap-1.5">
                    {t.teamName}
                    {isDefault && (
                      <Star
                        className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
                        aria-label="Default team"
                      />
                    )}
                  </div>
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
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    {isActive && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-1"
                        data-testid={`badge-current-team-${t.ownerUserId}`}
                      >
                        <Check className="h-3 w-3" /> Current
                      </span>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Manage ${t.teamName}`}
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`button-team-menu-${t.ownerUserId}`}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        {!isDefault && (
                          <DropdownMenuItem onClick={() => handleSetDefault(t)}>
                            <Star className="h-4 w-4 mr-2" /> Set as default
                          </DropdownMenuItem>
                        )}
                        {isOwn && !isPersonal && (
                          <DropdownMenuItem onClick={() => handleArchive(t)}>
                            <Archive className="h-4 w-4 mr-2" /> Archive
                          </DropdownMenuItem>
                        )}
                        {isOwn && !isPersonal && !isActive && (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              setDeleteConfirmText("");
                              setDeleteTarget(t);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete permanently
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
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

      {ctx.archivedTeams.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Archived teams
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {ctx.archivedTeams.map((t) => (
              <Card key={t.ownerUserId} className="opacity-70" data-testid={`card-archived-team-${t.ownerUserId}`}>
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Archive className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{t.teamName}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Archived — data untouched</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => handleUnarchive(t)}
                    disabled={unarchiveTeam.isPending}
                  >
                    <ArchiveRestore className="h-3.5 w-3.5 mr-1" /> Unarchive
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetCreateForm();
        }}
      >
        <DialogContent className="sm:max-w-md max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create a new team</DialogTitle>
            <DialogDescription>
              Starts a new team with its own schedule and stats. Optionally
              copy your roster and settings from a team you already coach.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-team-name">Team name</Label>
              <Input
                id="new-team-name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Rockets 12U — Fall 2026"
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

            <div className="space-y-2">
              <Label htmlFor="clone-from-team">Clone roster &amp; settings from</Label>
              <Select
                value={cloneFromId || "none"}
                onValueChange={(v) => setCloneFromId(v === "none" ? "" : v)}
              >
                <SelectTrigger id="clone-from-team" data-testid="select-clone-from-team">
                  <SelectValue placeholder="Start with an empty roster" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Start with an empty roster</SelectItem>
                  {ownedTeams.map((t) => (
                    <SelectItem key={t.ownerUserId} value={t.ownerUserId}>
                      {t.teamName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {cloneFromId && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">
                    Players to bring over ({selectedPlayerIds.size} of {cloneRoster.length})
                  </Label>
                  {cloneRoster.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() =>
                        setSelectedPlayerIds(
                          selectedPlayerIds.size === cloneRoster.length
                            ? new Set()
                            : new Set(cloneRoster.map((p) => p.id)),
                        )
                      }
                    >
                      {selectedPlayerIds.size === cloneRoster.length ? "Deselect all" : "Select all"}
                    </button>
                  )}
                </div>
                {cloneRosterLoading ? (
                  <p className="text-sm text-muted-foreground italic py-2">Loading roster…</p>
                ) : cloneRoster.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-2">
                    That team has no active players to copy.
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                    {cloneRoster.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={selectedPlayerIds.has(p.id)}
                          onCheckedChange={() => togglePlayer(p.id)}
                        />
                        <span className="font-medium">{p.name}</span>
                        {p.number != null && (
                          <span className="text-xs text-muted-foreground">#{p.number}</span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Depth chart positions carry over for the players you keep.
                  Games, lineups, and stats stay with the original team.
                </p>
              </div>
            )}
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

      {/* Permanent-delete confirmation. No archive-instead offer here —
          that's a separate, already-visible menu item; this dialog is
          only reached once the coach has specifically chosen "Delete
          permanently". */}
      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirmText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">
              Delete {deleteTarget?.teamName}?
            </DialogTitle>
            <DialogDescription>
              This permanently erases the roster, schedule, lineups, and every
              stat for this team. There is no undo — if you might want this
              data back later, Archive it instead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="delete-confirm" className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              autoFocus
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              data-testid="input-delete-team-confirm"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteConfirmText("");
              }}
              disabled={deleteTeam.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== "DELETE" || deleteTeam.isPending}
              onClick={handleDeleteConfirmed}
              data-testid="button-confirm-delete-team"
            >
              {deleteTeam.isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
