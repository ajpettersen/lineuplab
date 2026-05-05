import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTeamContext, useUpdateCoachProfile } from "@/hooks/use-team-context";

/**
 * First-touch onboarding modal. Auto-opens once per session per team
 * when the calling user hasn't yet set a `displayName` for the active
 * team (`currentUser.profileComplete === false`). Designed to be
 * mounted ONCE inside the Layout shell — it self-suppresses on auth
 * pages because the Layout itself isn't rendered there.
 *
 * Why per-team (not per-user)? An assistant coach who joins three
 * teams might want different display names on each (e.g. "Coach Sam"
 * for one club, "Sam Q. (parent)" for another). The team-membership
 * row stores both, so a coach in a new team gets prompted again.
 *
 * The dialog has no Skip button — completing your profile is a
 * 5-second task and it makes the rest of the UX (mentions, audit
 * trails, member lists) actually useful. The user can still close it
 * via Esc or the backdrop, in which case it'll re-open on next page
 * load until they save.
 */
export function CoachProfilePrompt() {
  const { data: ctx } = useTeamContext();
  const update = useUpdateCoachProfile();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("");

  // Open once per (team, user) when profile is incomplete. Tracking
  // the active owner in the dependency list also re-opens the dialog
  // if the user switches into a different team where they haven't set
  // a name yet.
  useEffect(() => {
    if (!ctx) return;
    if (ctx.currentUser.profileComplete) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // Pre-fill if they had something before — supports the "edit your
    // profile" pattern even though there's no edit affordance yet.
    setDisplayName(ctx.currentUser.displayName ?? "");
    setRole(ctx.currentUser.role ?? "");
  }, [ctx?.activeOwnerUserId, ctx?.currentUser.profileComplete, ctx]);

  const trimmedName = displayName.trim();
  const canSave = trimmedName.length >= 2 && trimmedName.length <= 40;

  const handleSave = (): void => {
    if (!canSave) return;
    update.mutate(
      {
        displayName: trimmedName,
        role: role.trim() || null,
      },
      {
        onSuccess: () => {
          toast({ title: `Welcome aboard, ${trimmedName}` });
          setOpen(false);
        },
        onError: (err) => {
          toast({
            title: "Couldn't save your profile",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="sm:max-w-md"
        // Prevent the implicit close-on-backdrop-click reaction so the
        // dialog feels intentional. Esc still closes it (and the next
        // navigation re-opens it because the server says profileComplete=false).
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="dialog-coach-profile-prompt"
      >
        <DialogHeader>
          <DialogTitle>Tell us who you are</DialogTitle>
          <DialogDescription>
            Your name appears next to lineup notes, AI memory entries, and the
            Coaches list so other folks on your team know who did what.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="coach-display-name">
              Display name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="coach-display-name"
              autoFocus
              placeholder="e.g. Coach Sam"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
              data-testid="input-coach-display-name"
            />
            <p className="text-xs text-muted-foreground">
              Between 2 and 40 characters.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="coach-role">Role on this team</Label>
            <Input
              id="coach-role"
              placeholder="e.g. Head Coach, Pitching Coach, Parent Helper"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              maxLength={40}
              data-testid="input-coach-role"
            />
            <p className="text-xs text-muted-foreground">
              Optional. Free-form — no specific list to choose from.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSave}
            disabled={!canSave || update.isPending}
            data-testid="button-save-coach-profile"
          >
            {update.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save profile"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
