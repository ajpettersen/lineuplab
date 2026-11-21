import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useRoute } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  getGetGameQueryKey,
  getListGamesQueryKey,
  useGetGame,
  useUpdateGame,
} from "@workspace/api-client-react";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  Edit,
  ListOrdered,
  Loader2,
  MapPin,
  Printer,
  Shuffle,
  Trophy,
  Tv,
  Users,
  Wand2,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditGameDialog } from "@/components/edit-game-dialog";
import { GameSheetPrint } from "@/components/basketball/game-sheet-print";
import { QueueList } from "@/components/basketball/queue-list";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permission";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { toastError } from "@/lib/toast-error";
import { withSync } from "@/lib/sync-envelope";
import { isVersionConflict } from "@/lib/conflict-registry";
import { effectiveStatus } from "@/lib/game-status";
import {
  buildRotation,
  stickySpots,
  formatClock,
  formatMinutes,
  MAX_SUB_SIZE,
  MIN_SUB_SIZE,
  groupedQueues,
  groupsFor,
  reorderGroup,
  reshuffleStartingOrder,
  roleIn,
  withLayoutRoles,
  type CourtSpot,
  type RotationRow,
} from "@/lib/basketball-rotation";
import {
  BASKETBALL_SETUP_KEY,
  fetchBasketballSetup,
  fetchGameLineup,
  gameLineupKey,
  gameRotationInput,
  rotationPlayers,
  saveGameLineup,
  type BasketballSetup,
  type GameLineup,
} from "@/lib/basketball-setup";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const SPOTS: { spot: CourtSpot; code: string }[] = [
  { spot: 1, code: "PG" },
  { spot: 2, code: "SG" },
  { spot: 3, code: "SF" },
  { spot: 4, code: "PF" },
  { spot: 5, code: "C" },
];

// One soft color per player, the same everywhere on the page (like the baseball grid).
const CHIP_COLORS = [
  "bg-rose-50 text-rose-800 border-rose-200",
  "bg-amber-50 text-amber-800 border-amber-200",
  "bg-lime-50 text-lime-800 border-lime-200",
  "bg-emerald-50 text-emerald-800 border-emerald-200",
  "bg-sky-50 text-sky-800 border-sky-200",
  "bg-indigo-50 text-indigo-800 border-indigo-200",
  "bg-violet-50 text-violet-800 border-violet-200",
  "bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200",
  "bg-teal-50 text-teal-800 border-teal-200",
  "bg-orange-50 text-orange-800 border-orange-200",
  "bg-cyan-50 text-cyan-800 border-cyan-200",
  "bg-pink-50 text-pink-800 border-pink-200",
];

function Chip({ name, color, muted }: { name: string; color: string; muted?: boolean }) {
  return (
    <span className={`inline-flex max-w-full items-center truncate rounded-full border px-2.5 py-1 text-xs font-semibold ${muted ? "border-border bg-muted/60 text-muted-foreground" : color}`}>
      {name}
    </span>
  );
}

interface GameStatsRow { playerId: number; name: string; number: number | null; started: boolean; seconds: number }

/** Set Lineup / Edit Available: who's here, starting order, subs at a time. */
function SetLineupDialog({
  open,
  onClose,
  setup,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  setup: BasketballSetup;
  initial: GameLineup | null;
  onSave: (lineup: GameLineup) => void;
  saving: boolean;
}) {
  const players = useMemo(() => rotationPlayers(setup), [setup]);
  const start: GameLineup = initial ?? { ...setup.gameDay, subSize: setup.defaultSubSize ?? 0 };
  const [absent, setAbsent] = useState<Set<string>>(() => new Set(start.absentIds.map(String)));
  const [order, setOrder] = useState<string[]>(() => start.order.map(String));
  // 0 = not chosen yet (the team asks each game).
  const [subSize, setSubSize] = useState<number>(start.subSize);
  const asks = setup.defaultSubSize === null;
  // This game's shift length and whether the last shift is the coach's pick.
  const [shiftMinutes, setShiftMinutes] = useState<number>(start.shiftMinutes ?? setup.settings.shiftMinutes);
  const [flexLast, setFlexLast] = useState<boolean>((start.flexShifts ?? setup.settings.flexShifts) > 0);
  const validShift = Number.isFinite(shiftMinutes) && shiftMinutes >= 0.5 && shiftMinutes <= setup.settings.halfMinutes;
  const shiftsPerHalf = validShift ? Math.ceil(setup.settings.halfMinutes / shiftMinutes - 1e-9) : 0;

  const present = players.filter((p) => !absent.has(p.id));
  const queues = groupedQueues(players, setup.settings, order, [...absent]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit lineup" : "Set lineup"}</DialogTitle>
          <DialogDescription>
            Pick who's here, the shift length, how many sub at a time, and the starting order. Roles and half length come from the Bench Sheet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Shift length (min)
              <Input
                type="number"
                inputMode="decimal"
                step={0.5}
                min={0.5}
                max={setup.settings.halfMinutes}
                value={Number.isFinite(shiftMinutes) ? shiftMinutes : ""}
                onChange={(e) => setShiftMinutes(e.target.value === "" ? Number.NaN : Number(e.target.value))}
                className="mt-1"
              />
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {validShift ? `${shiftsPerHalf} shifts a ${formatMinutes(setup.settings.halfMinutes)}-min half` : `0.5 to ${formatMinutes(setup.settings.halfMinutes)} minutes`}
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
              <Checkbox checked={flexLast} onCheckedChange={(v) => setFlexLast(!!v)} className="mt-0.5" />
              <span>
                <span className="block text-sm font-semibold">Flex the last shift</span>
                <span className="block text-xs text-muted-foreground">The final shift of the game is your pick; the sheet suggests who.</span>
              </span>
            </label>
          </div>

          <div>
            <Label className="mb-2 block">Subs at a time{asks && <span className="ml-1 text-destructive">*</span>}</Label>
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Subs at a time">
              {Array.from({ length: MAX_SUB_SIZE - MIN_SUB_SIZE + 1 }, (_, i) => i + MIN_SUB_SIZE).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={subSize === n}
                  onClick={() => setSubSize(n)}
                  className={`min-h-11 rounded-md border-2 text-lg font-bold transition-colors ${subSize === n ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {subSize === 5
                ? "A full line change when the bench is deep enough."
                : subSize > 0
                  ? `Split evenly across ${groupsFor(setup.settings).map((g) => g.label.toLowerCase()).join(" / ")}; any extra rotates between groups. Players only swap within their group.`
                  : "Choose how many players change each sub."}
              {setup.defaultSubSize !== null ? ` Your default is ${setup.defaultSubSize} (Settings → Rotation).` : ""}
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Available players ({present.length} of {players.length})</Label>
              <div className="flex gap-2 text-xs">
                <button type="button" className="text-primary hover:underline" onClick={() => setAbsent(new Set())}>Select all</button>
                <span className="text-muted-foreground">·</span>
                <button type="button" className="text-primary hover:underline" onClick={() => setAbsent(new Set(players.map((p) => p.id)))}>Clear</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {players.map((p) => (
                <label key={p.id} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-sm">
                  <Checkbox
                    checked={!absent.has(p.id)}
                    onCheckedChange={(v) =>
                      setAbsent((prev) => {
                        const next = new Set(prev);
                        if (v) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      })
                    }
                  />
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {groupsFor(setup.settings).find((g) => g.key === roleIn(setup.settings.groupLayout, p))?.short ?? ""}
                    {p.big ? "·Big" : ""}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Starting order</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setOrder(reshuffleStartingOrder(players, setup.settings, [...absent]))}
              >
                <Shuffle className="h-4 w-4" /> Reshuffle
              </Button>
            </div>
            <div className={`grid gap-4 ${queues.length >= 3 ? "md:grid-cols-3" : queues.length === 2 ? "sm:grid-cols-2" : ""}`}>
              {queues.map((q, i) => (
                <QueueList key={q.group.key} title={q.group.label} players={q.players} onReorder={(ids) => setOrder(reorderGroup(queues, i, ids.map(String), order))} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              The players at the top of each group start.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || subSize < MIN_SUB_SIZE || present.length === 0 || !validShift}
            onClick={() =>
              onSave({
                absentIds: [...absent].map(Number),
                order: [...queues.flatMap((q) => q.players.map((p) => p.id)), ...order].filter((id, i, all) => all.indexOf(id) === i).map(Number),
                subSize,
                shiftMinutes: shiftMinutes === setup.settings.shiftMinutes ? null : shiftMinutes,
                flexShifts: flexLast ? Math.max(1, setup.settings.flexShifts) : 0,
              })
            }
            className="gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {initial ? "Save lineup" : "Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A basketball team's game page, laid out like the baseball one: a header
 * card with Set Lineup, then the game's rotation as a grid (one row per
 * shift, the 1–5 spots across, then the bench and the sub), a minutes
 * tab, and what was recorded on the court display.
 */
export default function BasketballGame() {
  const [, params] = useRoute("/games/:id");
  const id = parseInt(params?.id ?? "0");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermission();
  const canEdit = can("partial");
  const { teamName } = useTeamSettings();
  const { data: game, isLoading } = useGetGame(id, { query: { enabled: !!id, queryKey: getGetGameQueryKey(id) } });
  const { data: setup } = useQuery({ queryKey: BASKETBALL_SETUP_KEY, queryFn: fetchBasketballSetup });
  const { data: lineup, isLoading: lineupLoading } = useQuery({
    queryKey: gameLineupKey(id),
    enabled: !!id,
    queryFn: () => fetchGameLineup(id),
  });
  const { data: stats } = useQuery({
    queryKey: ["basketball-game-stats", id],
    enabled: !!id,
    queryFn: async (): Promise<{ tracked: boolean; players: GameStatsRow[] }> => {
      const r = await fetch(`${BASE}/api/basketball-games/${id}/stats`);
      if (!r.ok) throw new Error(`GET /api/basketball-games/${id}/stats failed (${r.status})`);
      return r.json();
    },
  });
  const { data: season } = useQuery({
    queryKey: ["basketball-season"],
    queryFn: async (): Promise<{ gamesTracked: number; players: { playerId: number; seconds: number }[] }> => {
      const r = await fetch(`${BASE}/api/basketball-season`);
      if (!r.ok) throw new Error(`GET /api/basketball-season failed (${r.status})`);
      return r.json();
    },
  });
  // Season minutes before this game (the printout shows them next to today's plan).
  const seasonBefore = useMemo(() => {
    if (!season || season.gamesTracked === 0) return null;
    const thisGame = new Map((stats?.players ?? []).map((p) => [p.playerId, p.seconds]));
    const map = new Map(season.players.map((p) => [String(p.playerId), Math.max(0, p.seconds - (thisGame.get(p.playerId) ?? 0))]));
    return [...map.values()].some((v) => v > 0) ? map : null;
  }, [season, stats]);
  const updateGame = useUpdateGame();
  const saveLineup = useMutation({
    mutationFn: (l: GameLineup) => saveGameLineup(id, l),
    onSuccess: async () => {
      setLineupOpen(false);
      await qc.invalidateQueries({ queryKey: gameLineupKey(id) });
      toast({ title: "Lineup saved" });
    },
    onError: (err) => toastError(toast, "Couldn't save the lineup", err),
  });
  const [editOpen, setEditOpen] = useState(false);
  const [lineupOpen, setLineupOpen] = useState(false);
  const [ourScore, setOurScore] = useState("");
  const [opponentScore, setOpponentScore] = useState("");

  const rotation = useMemo(
    () => (setup && lineup ? buildRotation(gameRotationInput(setup, lineup)) : null),
    [setup, lineup],
  );
  // Each shift's 1–5, carried forward so players who stay on keep their spot.
  const spotsByShift = useMemo(() => {
    const map = new Map<number, Map<CourtSpot, string>>();
    if (!rotation || !setup) return map;
    const players = rotationPlayers(setup);
    let previous: Map<string, CourtSpot> | null = null;
    for (const row of rotation.halves.flatMap((h) => h.rows)) {
      if (row.flex) continue;
      const spots = stickySpots(rotation.groups.map((g, i) => ({ ids: row.groups[i]?.ids ?? [], spots: g.spots })), players, previous);
      previous = new Map(spots.filter((x) => x.spot !== null).map((x) => [x.id, x.spot as CourtSpot]));
      map.set(row.shift, new Map(spots.filter((x) => x.spot !== null).map((x) => [x.spot as CourtSpot, x.id])));
    }
    return map;
  }, [rotation, setup]);
  const color = useMemo(() => {
    const ids = setup ? setup.players.map((p) => String(p.id)) : [];
    return (pid: string) => CHIP_COLORS[Math.max(0, ids.indexOf(pid)) % CHIP_COLORS.length];
  }, [setup]);
  const nameOf = (pid: string) => setup?.players.find((p) => String(p.id) === pid)?.name ?? pid;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!game) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Game not found.</p>
        <Link href="/games"><Button variant="link">Back to Schedule</Button></Link>
      </div>
    );
  }

  const status = effectiveStatus(game);
  const date = new Date(game.gameDate);
  const final = game.status === "completed" && game.ourScore != null && game.opponentScore != null;
  // This game's lineup can change the shift length and turn the final flex shift on or off.
  const shiftMinutes = lineup?.shiftMinutes ?? setup?.settings.shiftMinutes ?? 0;
  const hasFlex = (lineup?.flexShifts ?? setup?.settings.flexShifts ?? 0) > 0;

  const saveScore = () => {
    updateGame.mutate(
      withSync(
        { id, data: { status: "completed", ourScore: parseInt(ourScore) || 0, opponentScore: parseInt(opponentScore) || 0 } },
        game.rowVersion,
      ),
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGameQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          toast({ title: "Final score saved" });
        },
        onError: (err) => {
          if (isVersionConflict(err)) return;
          toastError(toast, "Couldn't save the score", err);
        },
      },
    );
  };

  const recorded = [...(stats?.players ?? [])].sort(
    (a, b) => Number(b.started) - Number(a.started) || b.seconds - a.seconds || a.name.localeCompare(b.name),
  );
  const presentCount = setup && lineup ? setup.players.length - lineup.absentIds.length : 0;

  const GridRow = ({ row, first }: { row: RotationRow; first: boolean }) => {
    const spots = spotsByShift.get(row.shift) ?? new Map<CourtSpot, string>();
    return (
      <tr className={`border-t ${first ? "" : ""}`}>
        <td className="py-2 pr-2 align-middle">
          <span className="inline-flex min-w-[3.25rem] justify-center rounded-full bg-broadcast-navy px-2 py-1 font-numeric text-xs font-bold text-white tabular-nums">
            {row.clock}
          </span>
        </td>
        {row.flex ? (
          <td colSpan={7} className="px-1 py-2 text-sm font-semibold text-muted-foreground">
            <span className="rounded-md bg-amber-100 px-2 py-1 text-amber-900">FLEX</span> Coach's pick
          </td>
        ) : (
          <>
            {SPOTS.map(({ spot }) => {
              const pid = spots.get(spot);
              return (
                <td key={spot} className="px-1 py-2 text-center align-middle">
                  {pid ? <Chip name={nameOf(pid)} color={color(pid)} /> : <span className="text-muted-foreground">—</span>}
                </td>
              );
            })}
            <td className="border-l px-2 py-2 align-middle">
              <div className="flex flex-wrap gap-1">
                {row.bench.map((n) => (
                  <Chip key={n} name={n} color="" muted />
                ))}
              </div>
            </td>
            <td className="px-2 py-2 align-middle text-xs leading-snug">
              {row.in.length > 0 ? (
                <>
                  <div><span className="font-bold text-green-700">In</span> {row.in.join(", ")}</div>
                  <div><span className="font-bold text-red-700">Out</span> {row.out.join(", ")}</div>
                </>
              ) : (
                <span className="text-muted-foreground">Starters</span>
              )}
            </td>
          </>
        )}
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <Link href="/games">
        <Button variant="ghost" size="sm" className="gap-1"><ArrowLeft className="h-4 w-4" /> Schedule</Button>
      </Link>

      {/* Header card, like the baseball game page */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="eyebrow text-primary/70">Game</div>
              <h1 className="page-title mt-1 flex flex-wrap items-center gap-x-3 text-2xl text-foreground sm:text-3xl">
                <span>{teamName || "Us"}</span>
                <span className="text-muted-foreground/70">vs.</span>
                <span>{game.opponent}</span>
                {status === "cancelled" ? (
                  <Badge variant="outline">Cancelled</Badge>
                ) : final ? (
                  <Badge className={game.ourScore! > game.opponentScore! ? "bg-green-600" : game.ourScore === game.opponentScore ? "" : "bg-red-600"}>
                    {game.ourScore! > game.opponentScore! ? "W" : game.ourScore === game.opponentScore ? "T" : "L"} {game.ourScore}–{game.opponentScore}
                  </Badge>
                ) : (
                  <Badge className="bg-primary/10 text-primary hover:bg-primary/10">{status === "upcoming" ? "Upcoming" : "Needs score"}</Badge>
                )}
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/depth-chart">
                <Button variant="outline" size="sm" className="gap-1"><ListOrdered className="h-4 w-4" /> Depth chart</Button>
              </Link>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1"><Edit className="h-4 w-4" /> Edit</Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{format(date, "EEEE, MMMM d, yyyy · h:mm a")}</span>
            {game.location && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{game.location}</span>}
            {setup && (
              <span>
                {formatMinutes(setup.settings.halfMinutes)}-min halves · {formatMinutes(shiftMinutes)}-min shifts
                {lineup ? ` · ${lineup.subSize} at a time` : ""}
              </span>
            )}
          </div>
          {game.notes && <p className="whitespace-pre-wrap text-sm">{game.notes}</p>}
          {canEdit && setup && (
            <div className="flex flex-wrap gap-2">
              {lineup && (
                <Button variant="outline" onClick={() => setLineupOpen(true)} className="gap-2">
                  <Users className="h-4 w-4" /> Edit Available
                </Button>
              )}
              <Button onClick={() => setLineupOpen(true)} className="gap-2">
                <Wand2 className="h-4 w-4" /> {lineup ? "Replace Lineup" : "Set Lineup"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {setup && setup.players.length === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Add players on the <Link href="/players" className="font-semibold underline">Roster</Link> and set their roles on the{" "}
            <Link href="/bench-sheet" className="font-semibold underline">Bench Sheet</Link> first.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="rotation">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="rotation">Rotation</TabsTrigger>
          <TabsTrigger value="minutes">Minutes</TabsTrigger>
          <TabsTrigger value="played">Game stats</TabsTrigger>
        </TabsList>

        <TabsContent value="rotation" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle>Rotation</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Link href={`/games/${id}/display`}>
                  <Button variant="outline" size="sm" className="gap-1"><Tv className="h-4 w-4" /> Court Display</Button>
                </Link>
                {rotation && rotation.halves.length > 0 && (
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => window.print()}>
                    <Printer className="h-4 w-4" /> Print
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {lineupLoading || !setup ? (
                <Skeleton className="h-40 w-full" />
              ) : !lineup || !rotation ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <ClipboardList className="h-10 w-10 text-muted-foreground/40" />
                  <div>
                    <p className="font-semibold">No Lineup Yet</p>
                    <p className="text-sm text-muted-foreground">Set who's here, how many sub at a time, and the starting order.</p>
                  </div>
                  {canEdit && (
                    <Button onClick={() => setLineupOpen(true)} className="gap-2"><Wand2 className="h-4 w-4" /> Set Lineup</Button>
                  )}
                </div>
              ) : (
                <>
                  {rotation.warnings.length > 0 && (
                    <Alert className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        <ul className="list-disc pl-4">{rotation.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="py-2 pr-2 text-left font-semibold">Clock</th>
                          {SPOTS.map(({ spot, code }) => (
                            <th key={spot} className="px-1 py-2 text-center font-semibold">
                              <span className="rounded bg-muted px-1.5 py-0.5">{spot} {code}</span>
                            </th>
                          ))}
                          <th className="border-l px-2 py-2 text-left font-semibold">Bench</th>
                          <th className="px-2 py-2 text-left font-semibold">Sub</th>
                        </tr>
                      </thead>
                      {rotation.halves.map((h) => (
                        <tbody key={h.half}>
                          <tr>
                            <td colSpan={8} className="pt-4 pb-1 text-xs font-bold uppercase tracking-wider text-primary">
                              {h.half === 1 ? "1st half" : "2nd half"}
                            </td>
                          </tr>
                          {h.rows.map((row, i) => <GridRow key={row.shift} row={row} first={i === 0} />)}
                        </tbody>
                      ))}
                    </table>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {presentCount} players here · {lineup.subSize} sub at a time. Run it live on the Court Display: it alerts you at each sub and you can change things on the fly.
                  </p>
                  {createPortal(
                    <div id="game-sheet-print">
                      <GameSheetPrint
                        title={`${teamName || "Our team"} Bench Sheet — vs. ${game.opponent} · ${format(date, "MMM d")}`}
                        result={rotation}
                        players={withLayoutRoles(rotationPlayers(setup), setup.settings)}
                        spotsByShift={spotsByShift}
                        halfMinutes={setup.settings.halfMinutes}
                        shiftMinutes={shiftMinutes}
                        subSize={lineup.subSize}
                        absentNames={setup.players.filter((p) => lineup.absentIds.includes(p.id)).map((p) => p.name)}
                        seasonSeconds={seasonBefore}
                        notes={game.notes}
                      />
                    </div>,
                    document.body,
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="minutes" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Planned minutes</CardTitle></CardHeader>
            <CardContent>
              {!rotation ? (
                <p className="text-sm text-muted-foreground">Set the lineup to see each player's planned minutes.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-2">Player</th>
                      <th className="px-2 py-2">Role</th>
                      <th className="px-2 py-2 text-right">Minutes{hasFlex ? " before flex" : ""}</th>
                      <th className="py-2 pl-2 text-right">Longest sit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rotation.minutes.map((m) => (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="py-2 pr-2"><Chip name={m.name} color={color(m.id)} /></td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {m.role === "guard" ? "Guard" : m.big ? "Front · Big" : "Front"}
                          {m.playingAs && <em> → {m.playingAs} today</em>}
                        </td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatMinutes(m.minutes)}</td>
                        <td className="py-2 pl-2 text-right tabular-nums">{m.longestSit ? formatClock(m.longestSit) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {rotation && hasFlex && rotation.flexSuggestion.length > 0 && (
                <p className="mt-3 text-sm"><span className="font-semibold">Flex suggestion:</span> {rotation.flexSuggestion.join(", ")}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="played" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle>Starters &amp; minutes played</CardTitle></CardHeader>
            <CardContent>
              {!stats?.tracked ? (
                <p className="text-sm text-muted-foreground">Nothing recorded yet. Open the Court Display and tap Start game; the starting five and everyone's minutes are saved as you go.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-2">Player</th>
                      <th className="px-2 py-2">Started</th>
                      <th className="py-2 pl-2 text-right">Minutes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recorded.map((p) => (
                      <tr key={p.playerId} className="border-b last:border-0">
                        <td className="py-2 pr-2 font-medium">
                          {p.number != null && <span className="mr-1.5 text-muted-foreground">#{p.number}</span>}
                          {p.name}
                        </td>
                        <td className="px-2 py-2">{p.started ? "Yes" : ""}</td>
                        <td className="py-2 pl-2 text-right tabular-nums">{formatClock(p.seconds / 60)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {canEdit && status !== "cancelled" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4" /> {final ? "Final score" : "Record the final score"}</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); saveScore(); }}>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ourScore">{teamName || "Us"}</Label>
                    <Input id="ourScore" type="number" min="0" inputMode="numeric" className="w-24" value={ourScore} placeholder={game.ourScore != null ? String(game.ourScore) : "0"} onChange={(e) => setOurScore(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="opponentScore">{game.opponent}</Label>
                    <Input id="opponentScore" type="number" min="0" inputMode="numeric" className="w-24" value={opponentScore} placeholder={game.opponentScore != null ? String(game.opponentScore) : "0"} onChange={(e) => setOpponentScore(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={updateGame.isPending || (ourScore === "" && opponentScore === "")}>
                    {final ? "Update score" : "Save final score"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {lineupOpen && setup && (
        <SetLineupDialog
          open={lineupOpen}
          onClose={() => setLineupOpen(false)}
          setup={setup}
          initial={lineup ?? null}
          onSave={(l) => saveLineup.mutate(l)}
          saving={saveLineup.isPending}
        />
      )}

      {editOpen && (
        <EditGameDialog
          game={{
            id: game.id,
            opponent: game.opponent,
            gameDate: game.gameDate,
            location: game.location ?? null,
            innings: game.innings,
            status: game.status,
            gameType: game.gameType ?? null,
            competitiveness: game.competitiveness ?? null,
            tournamentId: game.tournamentId ?? null,
            bracketStage: null,
            isChampionship: null,
            notes: game.notes ?? null,
          }}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            qc.invalidateQueries({ queryKey: getGetGameQueryKey(id) });
            qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          }}
        />
      )}
    </div>
  );
}
