import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { SprayChart, useSprayChart } from "@/components/spray-chart";

export function SprayChartDialog({
  playerId,
  playerName,
  open,
  onOpenChange,
}: {
  playerId: number | null;
  playerName?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: events = [], isLoading, isError } = useSprayChart(playerId, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm w-[calc(100vw-1rem)]">
        <DialogHeader>
          <DialogTitle>{playerName ? `${playerName} — Spray Chart` : "Spray Chart"}</DialogTitle>
          <DialogDescription>
            Where this player's hits have landed, by batted-ball type and direction.
          </DialogDescription>
        </DialogHeader>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading spray chart…
          </div>
        )}
        {isError && (
          <p className="text-sm text-destructive py-4">Couldn't load this player's spray chart. Try again.</p>
        )}
        {!isLoading && !isError && <SprayChart events={events} />}
      </DialogContent>
    </Dialog>
  );
}
