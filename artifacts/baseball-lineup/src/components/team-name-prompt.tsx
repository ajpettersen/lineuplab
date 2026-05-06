import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTeamSettings,
  useUpdateTeamSettings,
  getGetTeamSettingsQueryKey,
} from "@workspace/api-client-react";
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
import { usePermission } from "@/hooks/use-permission";

const DEFAULT_TEAM_NAME = "My Team";
const DEFAULT_TEAM_SHORT = "Team";

/**
 * Auto-opens once the user is signed in if their team still has the
 * placeholder name ("My Team" / "Team") that gets seeded on first
 * touch. Forces them to pick a real team name + short name before
 * they get a working app shell. Mirrors the CoachProfilePrompt
 * pattern (Esc-closeable but reopens until saved). Only the head
 * coach (full permission) can rename the team, so for everyone else
 * the dialog is suppressed — they wait for the head coach to fix it.
 */
export function TeamNamePrompt() {
  const { data, isLoading } = useGetTeamSettings();
  const update = useUpdateTeamSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermission();
  const canEdit = can("full");

  const [open, setOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [shortName, setShortName] = useState("");

  // Once the head coach finishes the /welcome onboarding wizard
  // (which already collects team name + short name), this prompt
  // should never re-fire — even if they later edit the name back
  // to "My Team" in Settings, that's their choice. Suppressing on
  // `onboardingCompletedAt` keeps the prompt to its original
  // "first signup" purpose; ongoing edits live in Settings.
  const onboardingDone = !!data?.onboardingCompletedAt;

  const needsName =
    !!data &&
    !onboardingDone &&
    (data.teamName === DEFAULT_TEAM_NAME ||
      data.teamShortName === DEFAULT_TEAM_SHORT ||
      !data.teamName.trim() ||
      !data.teamShortName.trim());

  useEffect(() => {
    if (isLoading || !data) return;
    if (!canEdit) {
      setOpen(false);
      return;
    }
    if (needsName) {
      setOpen(true);
      setTeamName(
        data.teamName && data.teamName !== DEFAULT_TEAM_NAME ? data.teamName : "",
      );
      setShortName(
        data.teamShortName && data.teamShortName !== DEFAULT_TEAM_SHORT
          ? data.teamShortName
          : "",
      );
    } else {
      setOpen(false);
    }
  }, [isLoading, data, needsName, canEdit]);

  const trimmedName = teamName.trim();
  const trimmedShort = shortName.trim();
  const canSave =
    trimmedName.length >= 2 &&
    trimmedName.length <= 80 &&
    trimmedShort.length >= 1 &&
    trimmedShort.length <= 20 &&
    trimmedName !== DEFAULT_TEAM_NAME &&
    trimmedShort !== DEFAULT_TEAM_SHORT;

  const handleSave = (): void => {
    if (!canSave) return;
    update.mutate(
      { data: { teamName: trimmedName, teamShortName: trimmedShort } },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getGetTeamSettingsQueryKey() });
          toast({ title: `Welcome, ${trimmedName}` });
          setOpen(false);
        },
        onError: (err) => {
          toast({
            title: "Couldn't save your team name",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block any close attempt while the team still needs a real
        // name — `Save` is the only way out.
        if (!next && needsName && canEdit) return;
        setOpen(next);
      }}
    >
      <DialogContent
        className="sm:max-w-md [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        data-testid="dialog-team-name-prompt"
      >
        <DialogHeader>
          <DialogTitle>Name your team</DialogTitle>
          <DialogDescription>
            Pick a team name so it can show up on your dashboard, lineup
            cards, and shared exports. You can change this anytime in
            Settings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="team-name-prompt-name">
              Team name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="team-name-prompt-name"
              autoFocus
              placeholder="e.g. Eastside Eagles"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              maxLength={80}
              data-testid="input-team-name-prompt"
            />
            <p className="text-xs text-muted-foreground">
              Between 2 and 80 characters.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="team-name-prompt-short">
              Short name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="team-name-prompt-short"
              placeholder="e.g. Eagles"
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              maxLength={20}
              data-testid="input-team-short-prompt"
            />
            <p className="text-xs text-muted-foreground">
              Used in tight spots like mobile chips and exports.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSave}
            disabled={!canSave || update.isPending}
            data-testid="button-save-team-name-prompt"
          >
            {update.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save team name"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
