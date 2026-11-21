import { useEffect, useMemo, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowDown, ArrowUp, ClipboardList, GripVertical, Loader2, Printer, Shuffle, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";
import { usePermission } from "@/hooks/use-permission";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { BenchSheetTable } from "@/components/basketball/bench-sheet-table";
import {
  BASKETBALL_SETUP_KEY,
  fetchBasketballSetup,
  type BasketballSetup,
  type SetupGameDay,
  type SetupTags,
} from "@/lib/basketball-setup";
import {
  buildRotation,
  reshuffleStartingOrder,
  startingOrder,
  type BasketballPlayer,
  type BasketballRole,
  type BasketballSettings,
} from "@/lib/basketball-rotation";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const QUERY_KEY = BASKETBALL_SETUP_KEY;

type Tags = SetupTags;
type GameDay = SetupGameDay;
type RotationSetup = BasketballSetup;
interface Draft { settings: BasketballSettings; tags: Record<number, Tags>; gameDay: GameDay }
const fetchSetup = fetchBasketballSetup;

function toDraft(setup: RotationSetup): Draft {
  return {
    settings: { ...setup.settings },
    tags: Object.fromEntries(setup.players.map((p) => [p.id, { role: p.role, big: p.big, position: p.position }])),
    gameDay: { ...setup.gameDay },
  };
}

const inputClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

function NumberField({ label, value, step, min, onChange, disabled, hint }: {
  label: string; value: number; step: number; min: number; onChange: (n: number) => void; disabled: boolean; hint?: string;
}) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <input
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={min}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
        className={inputClass}
      />
      {hint && <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** One starting-order queue: drag to reorder, or use the arrows (touch screens). */
function QueueList({ title, players, onReorder }: { title: string; players: BasketballPlayer[]; onReorder: (ids: number[]) => void }) {
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

export default function BenchSheetPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermission();
  const canEdit = can("partial");
  const { teamName, sportProfile } = useTeamSettings();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchSetup });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);

  // Take the server copy whenever there are no local edits to protect.
  useEffect(() => {
    if (data && !dirty) setDraft(toDraft(data));
  }, [data, dirty]);

  const update = (change: (d: Draft) => Draft) => {
    setDraft((d) => (d ? change(d) : d));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const r = await fetch(`${BASE}/api/basketball-rotation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...d.settings, playerTags: d.tags, gameDay: d.gameDay }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Save failed (${r.status})`);
      }
    },
    onSuccess: async () => {
      setDirty(false);
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Bench sheet saved" });
    },
    onError: (err) => toastError(toast, "Couldn't save the bench sheet", err),
  });

  useEffect(() => {
    if (!dirty || !canEdit) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, canEdit]);

  // Roster players merged with the (possibly edited) tags, as the rotation sees them.
  const players: BasketballPlayer[] = useMemo(
    () =>
      data && draft
        ? data.players.map((p) => {
            const t = draft.tags[p.id] ?? p;
            return { id: String(p.id), name: p.name, role: t.role, big: t.big, position: t.position };
          })
        : [],
    [data, draft],
  );
  const absentIds = useMemo(() => (draft?.gameDay.absentIds ?? []).map(String), [draft]);
  const queues = useMemo(() => {
    if (!draft) return { guards: [], front: [] };
    const absent = new Set(absentIds);
    const byId = new Map(players.map((p) => [p.id, p]));
    const queue = (role: BasketballRole, order: number[]) =>
      startingOrder(players.filter((p) => p.role === role && !absent.has(p.id)), order.map(String)).map((id) => byId.get(id)!);
    return { guards: queue("guard", draft.gameDay.guardOrder), front: queue("front", draft.gameDay.frontOrder) };
  }, [draft, players, absentIds]);
  const rotation = useMemo(
    () =>
      draft &&
      buildRotation({
        players,
        settings: draft.settings,
        guardOrder: queues.guards.map((p) => p.id),
        frontOrder: queues.front.map((p) => p.id),
        absentIds,
      }),
    [draft, players, queues, absentIds],
  );

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="eyebrow text-primary/70">Game day</div>
        <h1 className="page-title mt-1 flex items-center gap-3 text-foreground">
          <ClipboardList className="h-7 w-7 text-primary" />
          Bench Sheet
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Fair basketball rotations in shifts: one guard and one front-court player sub each time. Print it as one page for the bench.
        </p>
      </div>
      {canEdit && draft && (
        <div className="flex items-center gap-2">
          {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
          <Button onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </div>
  );

  if (sportProfile.id !== "basketball") {
    return (
      <div className="space-y-6">
        {header}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            The bench sheet is for basketball teams. Switch this team's sport in <Link href="/settings" className="font-semibold underline">Settings</Link>.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (isLoading || (data && !draft)) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !data || !draft || !rotation) {
    return (
      <div className="space-y-6">
        {header}
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-3">
            Couldn't load the bench sheet.
            <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (data.players.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No players yet. <Link href="/players" className="font-semibold text-primary underline">Add your roster</Link> first.
          </CardContent>
        </Card>
      </div>
    );
  }

  const readOnly = !canEdit;
  const setTags = (id: number, change: Partial<Tags>) =>
    update((d) => ({ ...d, tags: { ...d.tags, [id]: { ...d.tags[id], ...change } } }));
  const setSetting = (key: keyof BasketballSettings, value: number) =>
    update((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
  const setGameDay = (change: Partial<GameDay>) => update((d) => ({ ...d, gameDay: { ...d.gameDay, ...change } }));
  const absent = new Set(draft.gameDay.absentIds);
  const shiftsPerHalf = draft.settings.shiftMinutes > 0 ? Math.ceil(draft.settings.halfMinutes / draft.settings.shiftMinutes - 1e-9) : 0;
  const hasFlex = draft.settings.flexShifts > 0;

  return (
    <div className="space-y-6">
      {header}

      {!data.saved && canEdit && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Roles below are a first guess from each player's roster positions (only PG/SG → Guard; C → Big). Check them, then Save.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Roles</CardTitle>
            <Link href="/players" className="text-sm font-semibold text-primary hover:underline">Edit roster</Link>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.players.map((p) => {
                const t = draft.tags[p.id] ?? p;
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 basis-32 truncate font-medium">
                      {p.number != null && <span className="mr-1.5 text-muted-foreground">#{p.number}</span>}
                      {p.name}
                    </span>
                    <select
                      value={t.role}
                      onChange={(e) => setTags(p.id, e.target.value === "guard" ? { role: "guard", big: false } : { role: "front", position: null })}
                      disabled={readOnly}
                      aria-label={`${p.name} role`}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="guard">Guard (1/2)</option>
                      <option value="front">Front (3/4/5)</option>
                    </select>
                    {t.role === "guard" ? (
                      <select
                        value={t.position ?? ""}
                        onChange={(e) => setTags(p.id, { position: e.target.value === "1" || e.target.value === "2" ? e.target.value : null })}
                        disabled={readOnly}
                        aria-label={`${p.name} guard spot`}
                        className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">Either</option>
                        <option value="1">Plays the 1</option>
                        <option value="2">Plays the 2</option>
                      </select>
                    ) : (
                      <label className="flex h-9 w-28 items-center gap-2 rounded-md border border-input px-2 text-sm">
                        <input type="checkbox" checked={t.big} onChange={(e) => setTags(p.id, { big: e.target.checked })} disabled={readOnly} className="h-4 w-4" />
                        Big
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Guards only ever play the 1 or 2. Front players flex across the 3, 4 and 5; tag your 4s and 5s as Big.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Game settings</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Half length (min)" value={draft.settings.halfMinutes} step={1} min={1} onChange={(n) => setSetting("halfMinutes", n)} disabled={readOnly} hint="Running clock" />
              <NumberField label="Shift length (min)" value={draft.settings.shiftMinutes} step={0.5} min={0.5} onChange={(n) => setSetting("shiftMinutes", n)} disabled={readOnly} hint={shiftsPerHalf ? `${shiftsPerHalf} shifts a half` : undefined} />
              <NumberField label="Guard spots" value={draft.settings.guardSpots} step={1} min={0} onChange={(n) => setSetting("guardSpots", n)} disabled={readOnly} />
              <NumberField label="Front spots" value={draft.settings.frontSpots} step={1} min={0} onChange={(n) => setSetting("frontSpots", n)} disabled={readOnly} hint={`${(draft.settings.guardSpots || 0) + (draft.settings.frontSpots || 0)} on court`} />
              <NumberField label="Flex shifts" value={draft.settings.flexShifts} step={1} min={0} onChange={(n) => setSetting("flexShifts", n)} disabled={readOnly} hint="Coach's pick at the end of the game" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>Who's here?</CardTitle>
          <Button
            variant="outline"
            onClick={() => {
              const order = reshuffleStartingOrder(players, draft.settings, absentIds);
              setGameDay({ guardOrder: order.guardOrder.map(Number), frontOrder: order.frontOrder.map(Number) });
            }}
          >
            <Shuffle className="mr-2 h-4 w-4" /> Reshuffle starting order
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-5 flex flex-wrap gap-2">
            {data.players.map((p) => {
              const here = !absent.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  role="switch"
                  aria-checked={here}
                  onClick={() => setGameDay({ absentIds: here ? [...draft.gameDay.absentIds, p.id] : draft.gameDay.absentIds.filter((id) => id !== p.id) })}
                  className={`min-h-10 rounded-full border-2 px-4 text-sm font-semibold transition-colors ${here ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground line-through"}`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <QueueList title="Guards — starting order" players={queues.guards} onReorder={(ids) => setGameDay({ guardOrder: ids })} />
            <QueueList title="Front — starting order" players={queues.front} onReorder={(ids) => setGameDay({ frontOrder: ids })} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            The first {draft.settings.guardSpots} guards and first {draft.settings.frontSpots} front players start. Each shift, whoever has been on longest comes out and whoever has sat longest goes in, straight through halftime.
          </p>
        </CardContent>
      </Card>

      {rotation.halves.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>Bench sheet</CardTitle>
            <Button onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> Print
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <BenchSheetTable teamName={teamName} result={rotation} hasFlex={hasFlex} />
              </div>
            </div>
            {createPortal(
              <div id="bench-sheet-print">
                <BenchSheetTable teamName={teamName} result={rotation} hasFlex={hasFlex} />
              </div>,
              document.body,
            )}
          </CardContent>
        </Card>
      ) : (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <ul>{rotation.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
