import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPlayers,
  useGetTeamSettings,
  useUpdateTeamSettings,
  getGetTeamSettingsQueryKey,
} from "@workspace/api-client-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GripVertical, Star, X, Plus, ListOrdered, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { usePermission } from "@/hooks/use-permission";

const POSITION_LABELS: Record<string, string> = {
  P: "Pitcher",
  C: "Catcher",
  "1B": "First Base",
  "2B": "Second Base",
  "3B": "Third Base",
  SS: "Shortstop",
  LF: "Left Field",
  LCF: "Left-Center Field",
  CF: "Center Field",
  RCF: "Right-Center Field",
  RF: "Right Field",
};

type PlayerRow = {
  id: number;
  name: string;
  number?: number | null;
  preferredPositions: string[];
};

/**
 * Depth chart editor. Coach drags players into a ranked order per
 * defensive position. Initial seeding for any unconfigured position
 * pulls every player whose preferredPositions contains that position
 * (alpha order). Saved as `team_settings.depthChart` — a
 * Record<position, playerId[]>.
 */
export default function DepthChart() {
  const { activeFieldPositions } = useTeamSettings();
  const { can } = usePermission();
  const canEdit = can("full");
  const { data: players = [], isLoading: playersLoading } = useListPlayers();
  const settingsQuery = useGetTeamSettings();
  const qc = useQueryClient();
  const { toast } = useToast();

  const update = useUpdateTeamSettings({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetTeamSettingsQueryKey() });
      },
      onError: (err) => {
        toast({
          title: "Could not save depth chart",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      },
    },
  });

  // Local working copy so drags feel instant; only PATCH on drop /
  // explicit add/remove. Keys are position codes; values are ordered
  // playerIds.
  const [chart, setChart] = useState<Record<string, number[]>>({});
  const [activePos, setActivePos] = useState<string>(
    activeFieldPositions[0] ?? "P",
  );

  // Hydrate from server. We seed any UN-configured position from the
  // roster's preferredPositions (alpha) so the coach has a starting
  // list to reorder rather than an empty column. Configured positions
  // are kept as-is and stale playerIds are filtered out.
  // Stable hash so an identity-only refetch from React Query doesn't
  // clobber the coach's in-progress drag. We only re-run hydration
  // when the set of player IDs or preferred-position assignments
  // actually CHANGES on the server.
  const playersFingerprint = useMemo(
    () =>
      (players as PlayerRow[])
        .map((p) => `${p.id}:${p.preferredPositions.join(",")}`)
        .sort()
        .join("|"),
    [players],
  );

  useEffect(() => {
    if (!settingsQuery.data || playersLoading) return;
    const saved = (settingsQuery.data.depthChart ?? {}) as Record<string, number[]>;
    const validIds = new Set(players.map((p) => p.id));
    const next: Record<string, number[]> = {};
    for (const pos of activeFieldPositions) {
      // Start from saved order (filtered to live players). Then APPEND
      // any preferred-position player not yet on the list. This is the
      // "update a player's preferred position → they show up in the
      // depth chart" behavior the coach expects. Newcomers land at the
      // bottom; the coach can drag them up. We do NOT auto-persist
      // (would fight the coach when they remove someone on purpose).
      const savedRow = (saved[pos] ?? []).filter((id) => validIds.has(id));
      const inRow = new Set(savedRow);
      const preferredExtras = (players as PlayerRow[])
        .filter((p) => p.preferredPositions.includes(pos) && !inRow.has(p.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => p.id);
      next[pos] = [...savedRow, ...preferredExtras];
    }
    setChart(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data, playersFingerprint, activeFieldPositions.join(",")]);

  const playerById = useMemo(() => {
    const m = new Map<number, PlayerRow>();
    for (const p of players as PlayerRow[]) m.set(p.id, p);
    return m;
  }, [players]);

  const persist = (nextChart: Record<string, number[]>) => {
    update.mutate({ data: { depthChart: nextChart } });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    if (!canEdit) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const list = chart[activePos] ?? [];
    const oldIdx = list.indexOf(Number(active.id));
    const newIdx = list.indexOf(Number(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(list, oldIdx, newIdx);
    const next = { ...chart, [activePos]: reordered };
    setChart(next);
    persist(next);
  };

  const removePlayer = (playerId: number) => {
    if (!canEdit) return;
    const list = chart[activePos] ?? [];
    const next = { ...chart, [activePos]: list.filter((id) => id !== playerId) };
    setChart(next);
    persist(next);
  };

  const addPlayer = (playerId: number) => {
    if (!canEdit) return;
    const list = chart[activePos] ?? [];
    if (list.includes(playerId)) return;
    const next = { ...chart, [activePos]: [...list, playerId] };
    setChart(next);
    persist(next);
  };

  const currentList = chart[activePos] ?? [];
  const eligibleToAdd = (players as PlayerRow[])
    .filter((p) => !currentList.includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (playersLoading || settingsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <div className="eyebrow text-primary/70">Game Day</div>
          <h1 className="page-title text-foreground mt-1">Depth Chart</h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Add players to your roster first, then come back to rank them by position.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="eyebrow text-primary/70">Game Day</div>
        <h1 className="page-title text-foreground mt-1">Depth Chart</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Rank your best players at each position. Drag to reorder — the
          player at the top is your starter, second is the backup, and so
          on. New positions are pre-seeded from each player's preferred
          positions; you can add anyone else to fill out the list.
        </p>
      </div>

      {/* Position picker — chip row on sm+, native select on xs to
          keep the page usable on a one-handed phone. */}
      <div className="flex flex-col gap-2">
        <div className="hidden sm:flex flex-wrap gap-2">
          {activeFieldPositions.map((pos) => {
            const count = (chart[pos] ?? []).length;
            const selected = pos === activePos;
            return (
              <button
                key={pos}
                type="button"
                onClick={() => setActivePos(pos)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:border-primary/50"
                }`}
                data-testid={`tab-position-${pos}`}
              >
                <span className="font-broadcast tracking-wide">{pos}</span>
                <span className={`text-xs ${selected ? "opacity-90" : "text-muted-foreground"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="sm:hidden">
          <Select value={activePos} onValueChange={setActivePos}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {activeFieldPositions.map((pos) => (
                <SelectItem key={pos} value={pos}>
                  {pos} — {POSITION_LABELS[pos] ?? pos} ({(chart[pos] ?? []).length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card data-testid={`card-depth-${activePos}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center rounded-md bg-primary/10 text-primary px-2.5 py-1 text-sm font-broadcast tracking-wider">
              {activePos}
            </span>
            <span>{POSITION_LABELS[activePos] ?? activePos}</span>
          </CardTitle>
          <CardDescription>
            {currentList.length === 0
              ? "No one ranked yet — add players below."
              : `${currentList.length} player${currentList.length === 1 ? "" : "s"} ranked.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentList.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={currentList}
                strategy={verticalListSortingStrategy}
              >
                <ol className="space-y-2">
                  {currentList.map((id, idx) => {
                    const p = playerById.get(id);
                    if (!p) return null;
                    return (
                      <DepthRow
                        key={id}
                        id={id}
                        rank={idx + 1}
                        player={p}
                        position={activePos}
                        canEdit={canEdit}
                        onRemove={() => removePlayer(id)}
                      />
                    );
                  })}
                </ol>
              </SortableContext>
            </DndContext>
          )}

          {canEdit && eligibleToAdd.length > 0 && (
            <div className="rounded-lg border border-dashed p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Plus className="h-4 w-4" />
                Add a player
              </div>
              <Select onValueChange={(v) => addPlayer(Number(v))}>
                <SelectTrigger data-testid="select-add-player">
                  <SelectValue placeholder="Pick a player to add to this position…" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleToAdd.map((p) => {
                    const isPreferred = p.preferredPositions.includes(activePos);
                    return (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                        {p.number != null ? ` (#${p.number})` : ""}
                        {isPreferred ? " ★" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                ★ = this position is in the player's preferred list.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DepthRow({
  id,
  rank,
  player,
  position,
  canEdit,
  onRemove,
}: {
  id: number;
  rank: number;
  player: PlayerRow;
  position: string;
  canEdit: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !canEdit });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const isPreferred = player.preferredPositions.includes(position);
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-md border bg-card p-3 ${
        isDragging ? "opacity-60 shadow-lg" : ""
      }`}
      data-testid={`row-depth-${position}-${id}`}
    >
      {canEdit && (
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <span
        className={`inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md px-1.5 text-sm font-broadcast tracking-wide ${
          rank === 1
            ? "bg-amber-100 text-amber-900"
            : rank === 2
              ? "bg-slate-100 text-slate-700"
              : rank === 3
                ? "bg-orange-100 text-orange-800"
                : "bg-muted text-muted-foreground"
        }`}
        title={rank === 1 ? "Starter" : `#${rank}`}
      >
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{player.name}</span>
          {player.number != null && (
            <span className="text-xs text-muted-foreground">#{player.number}</span>
          )}
          {isPreferred && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 text-[10px] gap-1 border-amber-300 text-amber-800 bg-amber-50"
              title="This position is in the player's preferred list"
            >
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
              Preferred
            </Badge>
          )}
        </div>
      </div>
      {canEdit && (
        <button
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive p-1 rounded"
          aria-label="Remove from position"
          data-testid={`button-remove-depth-${position}-${id}`}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

/**
 * Read-only depth chart panel for the in-game quick reference. Shows
 * top N (default 3) at every active position so the coach can glance
 * at it on the bench without leaving the game page. Pulls live data
 * from team settings + roster so any edits made on the Depth Chart
 * page are reflected immediately.
 */
export function DepthChartReference({ topN = 3 }: { topN?: number }) {
  const { activeFieldPositions } = useTeamSettings();
  const { data: players = [] } = useListPlayers();
  const settingsQuery = useGetTeamSettings();

  const playerById = useMemo(() => {
    const m = new Map<number, PlayerRow>();
    for (const p of players as PlayerRow[]) m.set(p.id, p);
    return m;
  }, [players]);

  if (settingsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const saved = (settingsQuery.data?.depthChart ?? {}) as Record<string, number[]>;
  const validIds = new Set(players.map((p) => p.id));

  const rows = activeFieldPositions.map((pos) => {
    const filtered = (saved[pos] ?? []).filter((id) => validIds.has(id));
    const inRow = new Set(filtered);
    // Append any preferred-position player that hasn't been ranked
    // yet — keeps this reference panel in sync with players the coach
    // just marked as preferring this slot, without requiring a trip to
    // the Depth Chart editor first.
    const preferredExtras = (players as PlayerRow[])
      .filter((p) => p.preferredPositions.includes(pos) && !inRow.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => p.id);
    const merged = [...filtered, ...preferredExtras];
    return { pos, ids: merged.slice(0, topN), seeded: filtered.length === 0 };
  });

  const anyConfigured = rows.some((r) => !r.seeded);

  return (
    <div className="space-y-3" data-testid="depth-chart-reference">
      {!anyConfigured && (
        <p className="text-xs text-muted-foreground italic">
          Showing preferred-position players (no depth chart curated yet).
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {rows.map(({ pos, ids }) => (
          <div
            key={pos}
            className="rounded-md border bg-card p-2.5"
            data-testid={`depth-row-${pos}`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center justify-center rounded bg-primary/10 text-primary px-2 py-0.5 text-xs font-broadcast tracking-wider">
                {pos}
              </span>
              <span className="text-xs text-muted-foreground">
                {POSITION_LABELS[pos] ?? pos}
              </span>
            </div>
            {ids.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">No one ranked.</div>
            ) : (
              <ol className="space-y-0.5">
                {ids.map((id, idx) => {
                  const p = playerById.get(id);
                  if (!p) return null;
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span
                        className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-broadcast ${
                          idx === 0
                            ? "bg-amber-100 text-amber-900"
                            : idx === 1
                              ? "bg-slate-100 text-slate-700"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="truncate">{p.name}</span>
                      {p.number != null && (
                        <span className="text-[11px] text-muted-foreground ml-auto">
                          #{p.number}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Re-export icon so the game-detail page can render the same quick-
// reference button without importing lucide directly here.
export { ListOrdered as DepthChartIcon };
