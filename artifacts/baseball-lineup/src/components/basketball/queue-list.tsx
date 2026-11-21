import { useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BasketballPlayer } from "@/lib/basketball-rotation";

/** One starting-order queue: drag to reorder, or use the arrows (touch screens). */
export function QueueList({ title, players, onReorder }: { title: string; players: BasketballPlayer[]; onReorder: (ids: number[]) => void }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= players.length) return;
    const ids = players.map((p) => Number(p.id));
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    onReorder(ids);
  };
  const onDrop = (event: DragEvent, to: number) => {
    event.preventDefault();
    const from = players.findIndex((p) => p.id === dragging);
    if (from >= 0) move(from, to);
    setDragging(null);
  };

  return (
    <div>
      <div className="eyebrow mb-2 text-muted-foreground">{title}</div>
      {players.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Nobody here.</p>
      ) : (
        <ol className="space-y-1.5">
          {players.map((p, i) => (
            <li
              key={p.id}
              draggable
              onDragStart={() => setDragging(p.id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, i)}
              className={`flex items-center gap-2 rounded-md border bg-background px-2 py-1 ${dragging === p.id ? "opacity-40" : ""}`}
            >
              <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
              <span className="w-5 text-right text-xs font-bold tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="flex-1 truncate font-medium">{p.name}</span>
              {p.big && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">Big</span>}
              {p.position && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{p.position}</span>}
              <Button type="button" variant="ghost" size="icon" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${p.name} up`}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => move(i, i + 1)} disabled={i === players.length - 1} aria-label={`Move ${p.name} down`}>
                <ArrowDown className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

