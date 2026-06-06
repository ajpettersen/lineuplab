import { useDroppable } from "@dnd-kit/core";
import { PlayerTile } from "@/components/game-detail/player-tile";
import { type Entry } from "@/components/game-detail/types";

interface FieldCellProps {
  inning: number;
  position: string;
  entry: Entry | undefined;
  selectedEntryId: number | null;
  isHotInning: boolean;
  draggedEntryId: number | null;
  onTileClick: (entryId: number) => void;
  onEmptyClick: () => void;
}

/** A single non-bench position cell. Always droppable; renders a tile if filled. */
export function FieldCell({
  inning,
  position,
  entry,
  selectedEntryId,
  isHotInning,
  draggedEntryId,
  onTileClick,
  onEmptyClick,
}: FieldCellProps) {
  const dropId = `field-${inning}-${position}`;
  const dropData = entry
    ? { kind: "tile" as const, entryId: entry.id, inning, position }
    : { kind: "emptyField" as const, inning, position };
  const { isOver, setNodeRef } = useDroppable({ id: dropId, data: dropData });
  const isPrimary = !entry && (isHotInning || isOver);
  const overRing = isOver && isHotInning ? "ring-2 ring-primary ring-offset-1 bg-primary/5" : "";
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[2.25rem] flex items-center justify-center rounded transition-colors ${overRing}`}
    >
      {entry ? (
        <PlayerTile
          entry={entry}
          positionForColor={position}
          isSelected={entry.id === selectedEntryId}
          isHotInning={isHotInning}
          isBeingDragged={entry.id === draggedEntryId}
          onClick={onTileClick}
          testId={`cell-${inning}-${position}`}
        />
      ) : (
        // Empty slots are always clickable so the coach can tap "+" to pick a
        // player from the roster (no drag-and-drop needed). When the slot is
        // also part of the active inning / drag-over target we promote it
        // visually to make the drop zone obvious.
        <button
          type="button"
          onClick={onEmptyClick}
          className={
            isPrimary
              ? "inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap min-w-[3rem] border border-dashed border-primary/60 text-primary hover:bg-primary/10"
              : "inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap min-w-[2.25rem] border border-dashed border-muted-foreground/30 text-muted-foreground/60 hover:border-primary/50 hover:text-primary hover:bg-primary/5"
          }
          data-testid={`cell-${inning}-${position}-empty`}
          title="Drag a player here, or tap to pick one from the roster"
        >
          +
        </button>
      )}
    </div>
  );
}
