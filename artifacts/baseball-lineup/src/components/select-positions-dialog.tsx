import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTeamSettings,
  useUpdateTeamSettings,
  getGetTeamSettingsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Settings2 } from "lucide-react";

const STANDARD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
const TEN_PLAYER_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "RCF", "RF"] as const;

type Mode = "standard" | "ten";

function inferMode(positions: readonly string[] | undefined | null): Mode {
  if (!positions) return "standard";
  const set = new Set(positions);
  // 10-player layout = LCF + RCF present, CF absent.
  if (set.has("LCF") && set.has("RCF") && !set.has("CF")) return "ten";
  return "standard";
}

/**
 * Lets the head coach swap the standard 9-position field (single CF) for a
 * 10-player field with LCF + RCF. The choice is stored on
 * `team_settings.activeFieldPositions` and drives the lineup grid columns,
 * the auto-generator's slot count, and the field display layout.
 *
 * Designed to live next to the Field Display button on the Defensive Lineup
 * card. The trigger is a compact icon button so it doesn't crowd the card
 * header on smaller screens.
 */
export function SelectPositionsDialog() {
  const { data, isLoading } = useGetTeamSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateTeamSettings({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getGetTeamSettingsQueryKey() });
      },
    },
  });

  const currentMode = inferMode(data?.activeFieldPositions);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(currentMode);

  // Keep the local form in sync whenever the dialog opens (or the saved
  // value changes underneath us). Without this, the radio would stick on
  // whatever the user last picked even after a reload.
  useEffect(() => {
    if (open) setMode(currentMode);
  }, [open, currentMode]);

  const onSave = async () => {
    const positions =
      mode === "ten" ? [...TEN_PLAYER_POSITIONS] : [...STANDARD_POSITIONS];
    try {
      await update.mutateAsync({ data: { activeFieldPositions: positions } });
      toast({
        title: "Positions updated",
        description:
          mode === "ten"
            ? "Lineups now use a 10-player field (LCF + RCF)."
            : "Lineups now use the standard 9 positions (CF).",
      });
      setOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't save positions",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="no-print"
          data-testid="button-select-positions"
          disabled={isLoading}
          title="Choose how many defensive positions this team uses (9 with CF, or 10 with LCF + RCF)"
        >
          <Settings2 className="h-4 w-4 mr-1.5" />
          Select Positions
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Defensive positions</DialogTitle>
          <DialogDescription>
            Pick how your outfield is split. This applies to every game for
            this team — the lineup grid, the auto-generator, and the field
            display all follow this choice.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
          className="space-y-3 py-2"
        >
          <Label
            htmlFor="positions-standard"
            className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 has-[[data-state=checked]]:border-primary"
          >
            <RadioGroupItem
              value="standard"
              id="positions-standard"
              data-testid="radio-positions-standard"
              className="mt-0.5"
            />
            <div className="flex-1 space-y-0.5">
              <div className="font-medium">Standard 9 — single Center Fielder</div>
              <div className="text-xs text-muted-foreground">
                P, C, 1B, 2B, 3B, SS, LF, <span className="font-semibold">CF</span>, RF
              </div>
            </div>
          </Label>
          <Label
            htmlFor="positions-ten"
            className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 has-[[data-state=checked]]:border-primary"
          >
            <RadioGroupItem
              value="ten"
              id="positions-ten"
              data-testid="radio-positions-ten"
              className="mt-0.5"
            />
            <div className="flex-1 space-y-0.5">
              <div className="font-medium">10-player field — Left-Center + Right-Center</div>
              <div className="text-xs text-muted-foreground">
                P, C, 1B, 2B, 3B, SS, LF, <span className="font-semibold">LCF</span>,{" "}
                <span className="font-semibold">RCF</span>, RF
              </div>
            </div>
          </Label>
        </RadioGroup>
        <p className="text-xs text-muted-foreground">
          Existing lineups won&apos;t change automatically — generate or edit a
          lineup to use the new positions. LCF and RCF count as Outfield in
          per-player tallies.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" data-testid="button-positions-cancel">
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={onSave}
            disabled={update.isPending || mode === currentMode}
            data-testid="button-positions-save"
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
