import { useDraggable } from "@dnd-kit/core";
import { formatPlayerNameShort } from "@/lib/player-name";
import { positionColor } from "@/components/game-detail/utils";
import { type Entry } from "@/components/game-detail/types";

interface PlayerTileProps {
  entry: Entry;
  positionForColor: string;
  isSelected: boolean;
  isHotInning: boolean;
  isBeingDragged: boolean;
  onClick: (entryId: number) => void;
  testId: string;
}

/** Draggable colored chip representing a single player in a lineup cell. */
export function PlayerTile({
  entry,
  positionForColor,
  isSelected,
  isHotInning,
  isBeingDragged,
  onClick,
  testId,
}: PlayerTileProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `player-${entry.id}`,
  });
  // MouseSensor's listener is `onMouseDown`, which would normally be
  // overwritten if we spread `{...listeners}` and THEN added our own
  // `onMouseDown={preventDefault}` to suppress the browser's
  // mousedown-focuses-the-button + scroll-into-view behavior. Capture the
  // sensor's listener before the spread so we can call it from inside our
  // wrapper, getting BOTH the preventDefault (no page jump) AND the drag
  // activation. Without this, drags would never start on desktop.
  const sensorMouseDown = (
    listeners as { onMouseDown?: (e: React.MouseEvent) => void } | undefined
  )?.onMouseDown;
  const ringClasses = isSelected
    ? "ring-2 ring-primary ring-offset-1"
    : isHotInning
      ? "ring-1 ring-primary/40"
      : "";
  // Hide the original tile while it's flying around in the DragOverlay so we
  // don't see two copies of the same chip.
  const hideOriginal = isDragging || isBeingDragged;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onClick(entry.id)}
      // Suppress the browser's default mousedown behavior (which focuses
      // the button and may scroll it into view at the top of the
      // viewport). Without this, grabbing a chip that's even slightly
      // below center on a desktop screen would yank the page upward and
      // make the floating drag chip appear "pinned to the top of the
      // page". Pointer events still fire (dnd-kit listens to
      // pointerdown, which runs before mousedown) and the click event
      // still arrives on mouseup, so tap-to-select keeps working.
      // `touch-none` is required for @dnd-kit's TouchSensor to fully
      // capture the gesture instead of letting the browser steal it for
      // pan-scroll. Re-added after the iOS-polish CSS started applying
      // `touch-action: manipulation` to every [role=button] (which the
      // chip inherits from useDraggable's attributes). Without this the
      // overlay rect went haywire and the floating chip jumped to the
      // top of the page mid-swap. The inline `touchAction: "none"` on
      // `style` below is a belt-and-suspenders against any @layer
      // ordering surprise that could let the base `button { touch-action:
      // manipulation }` rule beat the utility class.
      style={{ touchAction: "none" }}
      className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap min-w-[3rem] shadow-sm transition-shadow touch-none ${positionColor(positionForColor)} ${ringClasses} ${hideOriginal ? "opacity-30" : ""} cursor-grab active:cursor-grabbing hover:shadow-md`}
      data-testid={testId}
      data-entry-id={entry.id}
      data-selected={isSelected ? "true" : "false"}
      title={`${entry.playerName} — drag onto another player to swap, or onto an empty slot to move them there`}
      {...attributes}
      {...listeners}
      // MUST come AFTER `{...listeners}` so this wrapper wins over
      // MouseSensor's own onMouseDown — and we manually forward to the
      // sensor inside so drag activation still happens.
      //
      // ORDER MATTERS: forward to the sensor FIRST, then preventDefault.
      // @dnd-kit's `bindActivatorToSensorInstantiator` bails if
      // `nativeEvent.defaultPrevented` is true (see
      // @dnd-kit/core/dist/core.esm.js — checks `dndKit ||
      // defaultPrevented`). If we preventDefault before forwarding, the
      // sensor refuses to activate and drags never start. Calling
      // preventDefault AFTER the sensor still suppresses the browser's
      // mousedown-focuses-the-button + scroll-into-view behavior, so
      // both goals are achieved.
      onMouseDown={(e) => {
        sensorMouseDown?.(e);
        e.preventDefault();
      }}
    >
      {formatPlayerNameShort(entry.playerName)}
    </button>
  );
}
