import { useDroppable } from "@dnd-kit/core";
import { PlayerTile } from "@/components/game-detail/player-tile";
import { type Entry } from "@/components/game-detail/types";

interface BenchAreaProps {
  inning: number;
  entries: Entry[];
  selectedEntryId: number | null;
  isHotInning: boolean;
  draggedEntryId: number | null;
  onTileClick: (entryId: number) => void;
  /**
   * Tap on the empty bench area (no chip, no chip selected) → open the
   * roster picker so the coach can add a player who STARTS on the bench
   * without first having to put them on the field and drag them off.
   * Mirrors `FieldCell`'s empty-cell tap behavior — coaches who can't
   * make drag-and-drop work on mobile Safari now have a tap-to-add path
   * for the bench too.
   */
  onEmptyClick: () => void;
}

/**
 * Bench column for an inning. The whole area is one big drop zone, and
 * tapping the empty area (or the "+" affordance) opens the same roster
 * picker the field cells use.
 */
export function BenchArea({
  inning,
  entries,
  selectedEntryId,
  isHotInning,
  draggedEntryId,
  onTileClick,
  onEmptyClick,
}: BenchAreaProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `bench-${inning}`,
    data: { kind: "benchArea" as const, inning },
  });
  const overRing = isOver && isHotInning ? "ring-2 ring-primary bg-primary/5" : "";
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[2.25rem] rounded transition-colors px-1 py-1 ${overRing} ${isHotInning && entries.length === 0 ? "border border-dashed border-primary/40" : ""}`}
      data-testid={`bench-${inning}`}
    >
      <div className="flex flex-wrap gap-1 justify-center items-center">
        {entries.map((e) => (
          <PlayerTile
            key={e.id}
            entry={e}
            positionForColor="Bench"
            isSelected={e.id === selectedEntryId}
            isHotInning={isHotInning}
            isBeingDragged={e.id === draggedEntryId}
            onClick={onTileClick}
            testId={`cell-${inning}-Bench-${e.id}`}
          />
        ))}
        {/* Always-visible "+" so coaches can add bench-starters without
            needing drag-and-drop. Hidden while a chip is selected (in
            click-to-swap mode the whole area is the drop target) and
            hidden during a drag-over so it doesn't fight the ring. */}
        {selectedEntryId == null && !isOver && (
          <button
            type="button"
            onClick={onEmptyClick}
            className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap min-w-[1.75rem] border border-dashed border-muted-foreground/30 text-muted-foreground/60 hover:border-primary/50 hover:text-primary hover:bg-primary/5"
            data-testid={`cell-${inning}-Bench-empty`}
            title="Add a bench player from the roster"
            aria-label={`Add a player to the bench for inning ${inning}`}
          >
            +
          </button>
        )}
        {isHotInning && entries.length === 0 && (
          <span className="text-xs text-primary/70">drop on bench</span>
        )}
      </div>
    </div>
  );
}
