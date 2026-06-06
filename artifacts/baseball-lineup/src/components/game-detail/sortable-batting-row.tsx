import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

interface SortableBattingRowProps {
  row: { playerId: number; playerName: string; order: number | null; positions: string[] };
  slot: number;
  showStarterDivider: boolean;
  /**
   * When true, the team plays a continuous lineup (everyone bats). Players
   * who happen to bench every inning still get a numbered slot and aren't
   * tagged "bench only" — the divider above them is also suppressed. When
   * false (nine-man), unbatted players keep the muted slot + "bench only"
   * tag because they truly aren't in the order.
   */
  isContinuous: boolean;
  testId: string;
}

/**
 * One row in the drag-and-drop batting order list. Layout:
 *   [#slot]  Player name (positions chips)  …  [grip handle]
 *
 * The whole row is the drop target; only the grip handle is the drag
 * activator, so coaches can still tap/click anywhere on the row without
 * accidentally starting a drag.
 */
export function SortableBattingRow({ row, slot, showStarterDivider, isContinuous, testId }: SortableBattingRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.playerId,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  // In continuous mode every roster spot bats, so a missing batting order is
  // just an artifact of the player benching every inning — they still belong
  // in the order at their visual slot. In nine-man mode a missing order
  // genuinely means "not batting", so we keep the muted styling + tag.
  const benchOnly = !isContinuous && row.order == null;
  return (
    <>
      {showStarterDivider && (
        <li
          aria-hidden="true"
          className="my-2 flex items-center gap-3 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 select-none"
        >
          <span className="h-px flex-1 bg-border" />
          <span>Bench / Extras</span>
          <span className="h-px flex-1 bg-border" />
        </li>
      )}
      <li
        ref={setNodeRef}
        style={style}
        className={`group flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 hover:bg-muted/50 hover:border-border/60 transition-colors ${
          isDragging ? "bg-primary/5 border-primary/40 shadow-md opacity-90" : ""
        }`}
        data-testid={testId}
      >
        <span
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            benchOnly
              ? "bg-muted text-muted-foreground"
              : "bg-primary text-primary-foreground"
          }`}
        >
          {slot}
        </span>
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <span className="font-medium truncate">{row.playerName}</span>
          {row.positions.length > 0 && (
            <span className="hidden sm:inline-flex flex-wrap gap-1">
              {row.positions.map((pos) => (
                <span
                  key={pos}
                  className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-secondary text-secondary-foreground"
                >
                  {pos}
                </span>
              ))}
            </span>
          )}
          {benchOnly && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              bench only
            </span>
          )}
        </div>
        <button
          type="button"
          // Same focus-scroll guard as the defense PlayerTile chip:
          // suppress the browser's mousedown-focuses-the-button behavior
          // (which can scroll the handle into view at the top of the
          // viewport mid-drag, making the row look "pinned to the top").
          // The inline `touchAction: "none"` is a belt-and-suspenders next
          // to `touch-none` so the base CSS rule applying
          // `touch-action: manipulation` to every <button> can't win.
          style={{ touchAction: "none" }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted touch-none cursor-grab active:cursor-grabbing no-print"
          aria-label={`Drag ${row.playerName}`}
          title="Drag to reorder"
          data-testid={`drag-handle-${slot - 1}`}
          {...attributes}
          {...listeners}
          // NOTE: do NOT wrap `{...listeners}` with a custom onMouseDown
          // here. An earlier attempt added `onMouseDown={preventDefault}`
          // to suppress the browser's mousedown-focuses-the-button
          // behavior, but that overwrote @dnd-kit's MouseSensor activator
          // and silently killed drag-and-drop on desktop. A follow-up
          // tried to forward the event to the sensor before
          // preventDefault — but the sensor activator runs in a React
          // SyntheticEvent context where capture/dispatch ordering made
          // that brittle (still didn't activate reliably for users). The
          // grip is a tiny 8×8 button on the side of the row, so the
          // focus / scroll-into-view concern that motivated the wrapper
          // on the bigger field chips doesn't really apply here. Leave
          // listeners alone — this matches the field-display chip
          // pattern, which works.
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </li>
    </>
  );
}
