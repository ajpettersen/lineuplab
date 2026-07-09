import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  useListGames,
  useDeleteGame,
  useListPlayers,
  getListGamesQueryKey,
} from "@workspace/api-client-react";
import { BoxScoreImportDialog } from "@/components/box-score-import-dialog";
import { EditGameDialog } from "@/components/edit-game-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarDays,
  ChevronRight,
  MapPin,
  Trash2,
  Pencil,
  Link2,
  Check,
  AlertCircle,
  Tv,
  FileText,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { showUndoToast, restoreEntity } from "@/lib/undo-toast";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";
import { withSync } from "@/lib/sync-envelope";
import { isVersionConflict } from "@/lib/conflict-registry";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { effectiveStatus, type EffectiveStatus } from "@/lib/game-status";
import { shortenTeamName, formatOpponentForMatchup } from "@/lib/team-name";
import { NextGameHero, pickHeroGame } from "@/components/next-game-hero";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function StatusBadge({ status }: { status: EffectiveStatus }) {
  if (status === "completed") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>;
  if (status === "cancelled") return <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>;
  if (status === "past") return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Past</Badge>;
  return <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Upcoming</Badge>;
}

type Game = {
  id: number;
  opponent: string;
  gameDate: string;
  location: string | null;
  innings: number;
  status: string;
  type?: string;
  gameType?: "league" | "tournament" | null;
  ourScore: number | null;
  opponentScore: number | null;
  notes: string | null;
  boxScoreImportedAt?: string | null;
};

function GameTypeBadge({ gameType }: { gameType?: "league" | "tournament" | null }) {
  if (gameType === "league") return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">League</Badge>;
  if (gameType === "tournament") return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Tournament</Badge>;
  return null;
}

// ── iCal import dialog ──────────────────────────────────────────
type EventKind = "game" | "practice" | "other";
type ICalEvent = {
  uid: string;
  summary: string;
  opponent: string;
  gameDate: string;
  location: string | null;
  type: EventKind;
};

function TypeBadge({ type }: { type: EventKind | string }) {
  if (type === "practice") {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">Practice</Badge>;
  }
  if (type === "other") {
    return <Badge variant="outline" className="text-muted-foreground">Event</Badge>;
  }
  return null;
}

const KIND_LABEL: Record<EventKind, string> = {
  game: "Games",
  practice: "Practices",
  other: "Team Events",
};

function ICalImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [innings, setInnings] = useState("6");
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<ICalEvent[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state whenever the dialog closes so a re-open starts fresh.
  useEffect(() => {
    if (!open) {
      setUrl("");
      setEvents([]);
      setSkippedCount(0);
      setSelected(new Set());
      setError(null);
      setLoading(false);
      setSaving(false);
    }
  }, [open]);

  const handlePreview = async () => {
    setError(null);
    setEvents([]);
    setSkippedCount(0);
    setSelected(new Set());
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/games/import-ical/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icalUrl: url.trim() }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "Failed to load calendar"); return; }
      // Server now returns { games, skipped }. Stay backward-compatible with the
      // older shape (a bare array) just in case an old client/server combo is hit.
      const games: ICalEvent[] = Array.isArray(data) ? data : Array.isArray(data?.games) ? data.games : [];
      const skipped: number = Array.isArray(data) ? 0 : typeof data?.skipped === "number" ? data.skipped : 0;
      if (games.length === 0) {
        setError(
          skipped > 0
            ? `No games found — ${skipped} non-game event${skipped === 1 ? "" : "s"} (practices, meetings, etc.) were skipped.`
            : "No events found in this calendar.",
        );
        return;
      }
      setEvents(games);
      setSkippedCount(skipped);
      // All returned events are games — pre-select them all.
      setSelected(new Set(games.map((e) => e.uid)));
    } catch {
      setError("Could not reach the calendar URL. Make sure it is publicly accessible.");
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(events.map((e) => e.uid)) : new Set());
  };

  const handleImport = async () => {
    const toImport = events.filter((e) => selected.has(e.uid));
    if (toImport.length === 0) return;
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/games/import-ical/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ games: toImport, innings: parseInt(innings) }),
      });
      if (!r.ok) throw new Error();
      toast({ title: `${toImport.length} game${toImport.length !== 1 ? "s" : ""} imported` });
      onImported();
      onClose();
      setUrl("");
      setEvents([]);
      setSelected(new Set());
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Import from Calendar Link
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 flex-1 overflow-hidden">
          <p className="text-sm text-muted-foreground">
            Paste a public iCal (.ics) URL from your league scheduling system, Google Calendar, or any calendar app. Only games will be imported — practices, meetings, and other team events are skipped.
          </p>

          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… .ics  or  webcal://…"
              className="flex-1"
              onKeyDown={(e) => e.key === "Enter" && handlePreview()}
            />
            <Button onClick={handlePreview} disabled={loading || !url.trim()}>
              {loading ? "Loading..." : "Load"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Tip: the URL must be the calendar's <span className="font-mono">.ics</span> export link (or a <span className="font-mono">webcal://</span> link), not the calendar's web page.
          </p>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm border border-destructive/20">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {events.length > 0 && (
            <div className="flex flex-col gap-3 flex-1 overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selected.size === events.length}
                    onCheckedChange={(v) => toggleAll(!!v)}
                  />
                  <span className="text-sm font-medium">
                    {events.length} game{events.length === 1 ? "" : "s"} found — {selected.size} selected
                    {skippedCount > 0 && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ({skippedCount} non-game event{skippedCount === 1 ? "" : "s"} skipped)
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Default innings:</Label>
                  <Select value={innings} onValueChange={setInnings}>
                    <SelectTrigger className="w-16 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[4, 5, 6, 7].map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-3 overflow-y-auto pr-1">
                {(["game", "practice", "other"] as EventKind[]).map((kind) => {
                  const inGroup = events.filter((e) => e.type === kind);
                  if (inGroup.length === 0) return null;
                  const selectedInGroup = inGroup.filter((e) => selected.has(e.uid)).length;
                  const allInGroupSelected = selectedInGroup === inGroup.length;
                  return (
                    <div key={kind} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between sticky top-0 bg-background py-1 z-10">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={allInGroupSelected}
                            onCheckedChange={(v) => {
                              const next = new Set(selected);
                              if (v) inGroup.forEach((e) => next.add(e.uid));
                              else inGroup.forEach((e) => next.delete(e.uid));
                              setSelected(next);
                            }}
                          />
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {KIND_LABEL[kind]} ({inGroup.length})
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">{selectedInGroup} selected</span>
                      </div>
                      {inGroup.map((ev) => {
                        const titleText =
                          ev.type === "game"
                            ? `vs. ${ev.opponent}`
                            : ev.summary;
                        return (
                          <label
                            key={ev.uid}
                            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                              selected.has(ev.uid) ? "border-primary/40 bg-primary/5" : "border-border bg-background opacity-60"
                            }`}
                          >
                            <Checkbox
                              checked={selected.has(ev.uid)}
                              onCheckedChange={(v) => {
                                const next = new Set(selected);
                                v ? next.add(ev.uid) : next.delete(ev.uid);
                                setSelected(next);
                              }}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium truncate">{titleText}</p>
                                <TypeBadge type={ev.type} />
                              </div>
                              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                                <span className="flex items-center gap-1">
                                  <CalendarDays className="h-3 w-3" />
                                  {format(new Date(ev.gameDate), "EEE, MMM d, yyyy · h:mm a")}
                                </span>
                                {ev.location && (
                                  <span className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />
                                    {ev.location}
                                  </span>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {events.length > 0 && (
          <DialogFooter className="pt-2 border-t">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleImport} disabled={saving || selected.size === 0}>
              <Check className="h-4 w-4 mr-1" />
              {saving ? "Importing..." : `Import ${selected.size} Item${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Edit game dialog: see EditGameDialog imported from @/components/edit-game-dialog ─

// ── Main page ───────────────────────────────────────────────────
export default function Games() {
  const { data: games = [], isLoading } = useListGames();
  const { data: players = [] } = useListPlayers();
  const { teamName } = useTeamSettings();
  const deleteGame = useDeleteGame();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [boxScoreGameId, setBoxScoreGameId] = useState<number | null>(null);
  const [showIcal, setShowIcal] = useState(false);
  const [filter, setFilter] = useState<"all" | "game" | "practice" | "other">("all");

  const counts = games.reduce(
    (acc, g) => {
      const k = (g.type ?? "game") as "game" | "practice" | "other";
      acc[k] += 1;
      acc.all += 1;
      return acc;
    },
    { all: 0, game: 0, practice: 0, other: 0 },
  );

  const filtered = filter === "all" ? games : games.filter((g) => (g.type ?? "game") === filter);
  // Bucket by effective status: a stored "upcoming" game whose date has already
  // passed is shown under "Past" so it doesn't pretend to still be on the schedule.
  const upcoming = filtered.filter((g) => effectiveStatus(g) === "upcoming");
  const past = filtered.filter((g) => effectiveStatus(g) !== "upcoming").reverse();
  // Hero card mirrors the dashboard's "Up Next" treatment so the
  // soonest game gets the same broadcast graphic on the schedule
  // too. We pick from the WHOLE games list (not the filtered list)
  // so flipping to Practices / Events doesn't blow the hero away —
  // it stays anchored to the next actual game. We then drop that
  // game from the regular `upcoming` list so it doesn't render
  // twice when the All filter is active.
  const heroGame = pickHeroGame(games);
  const upcomingForList = heroGame
    ? upcoming.filter((g) => g.id !== heroGame.id)
    : upcoming;
  // Hero can fall back to a past-uncompleted game when nothing is
  // upcoming, so also strip it from the past list to avoid double
  // rendering.
  const pastForList = heroGame
    ? past.filter((g) => g.id !== heroGame.id)
    : past;

  const handleDelete = () => {
    if (!deleteId) return;
    const idToDelete = deleteId;
    // Pin the delete to the schedule row's current version — if another
    // coach edited this game since our list loaded, the server 409s and
    // the conflict tray lets us decide instead of silently deleting.
    const rowVersion = games.find((g) => g.id === idToDelete)?.rowVersion;
    deleteGame.mutate(
      withSync({ id: idToDelete }, rowVersion),
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          showUndoToast(toast, {
            title: "Game removed",
            onUndo: async () => {
              try {
                await restoreEntity("games", idToDelete);
                qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
                toast({ title: "Game restored" });
              } catch {
                toast({ title: "Couldn't undo", variant: "destructive" });
              }
            },
          });
        },
        onError: (err) => {
          // 409 conflicts are handled by the global ConflictListener
          // (toast + tray); a second "failed" toast here would read as
          // a bug rather than a resolvable conflict.
          if (isVersionConflict(err)) return;
          toastError(toast, "Failed to delete game", err);
        },
      }
    );
    setDeleteId(null);
  };

  const refresh = () => qc.invalidateQueries({ queryKey: getListGamesQueryKey() });

  // teamName is passed in explicitly (not closed over) because Vite's
  // react-refresh transform hoists inline arrow components to module
  // scope, breaking closure references.
  const GameCard = ({
    g,
    teamName,
    onViewBoxScore,
  }: {
    g: typeof games[0];
    teamName: string;
    onViewBoxScore: (id: number) => void;
  }) => (
    <Card className="border-border hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <Link href={`/games/${g.id}`}>
            <div className="flex-1 cursor-pointer group">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="font-semibold group-hover:text-primary transition-colors"
                  title={g.opponent ?? undefined}
                >
                  {g.type && g.type !== "game"
                    ? (formatOpponentForMatchup(g.opponent, teamName) || g.opponent)
                    : `${shortenTeamName(teamName) || teamName || "Team"} vs. ${formatOpponentForMatchup(g.opponent, teamName) || g.opponent}`}
                </span>
                <TypeBadge type={(g.type ?? "game") as EventKind} />
                <GameTypeBadge gameType={g.gameType as ("league" | "tournament" | null | undefined)} />
                <StatusBadge status={effectiveStatus(g)} />
                {g.status === "completed" && g.ourScore != null && g.opponentScore != null && (() => {
                  // Same-score completed games are ties (T), not losses.
                  // Tournaments routinely end in ties, and miscoding them as
                  // losses inflates the loss column on the dashboard record.
                  const tied = g.ourScore === g.opponentScore;
                  const won = g.ourScore > g.opponentScore;
                  const cls = tied
                    ? "bg-amber-100 text-amber-800"
                    : won
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800";
                  const letter = tied ? "T" : won ? "W" : "L";
                  return (
                    <span className={`text-sm font-bold px-2 py-0.5 rounded ${cls}`}>
                      {letter} {g.ourScore}-{g.opponentScore}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {format(new Date(g.gameDate), "EEE, MMM d, yyyy · h:mm a")}
                </span>
                {g.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {g.location}
                  </span>
                )}
                <span className="text-xs">{g.innings} innings</span>
              </div>
            </div>
          </Link>
          {/*
           * Action cluster. On phones the five-button row was a tap-target
           * mess (32 px buttons packed next to a wrapping title made it
           * easy to mis-tap delete). We now keep the most common actions
           * — Field Display + Open — visible at all sizes and collapse
           * Edit / View box score / Delete into a "…" overflow menu on
           * mobile. From `sm:` up the original five-button row is
           * restored so desktop habits are unchanged.
           */}
          <div className="flex items-center gap-1 ml-2">
            {g.type !== "practice" && g.type !== "other" && g.status !== "cancelled" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-primary"
                onClick={(e) => {
                  e.preventDefault();
                  window.open(`${BASE}/games/${g.id}/display`, "_blank", "noopener");
                }}
                title="Open the dugout / fence-iPad display in a new tab"
                data-testid={`button-game-display-${g.id}`}
              >
                <Tv className="h-4 w-4" />
              </Button>
            )}
            {/* Desktop-only: keep the original "view box score" + "edit"
                + "delete" icon row. On mobile these live in the overflow
                menu below. */}
            <div className="hidden sm:flex items-center gap-1">
              {g.boxScoreImportedAt && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-green-700 hover:text-green-800"
                  onClick={(e) => {
                    e.preventDefault();
                    onViewBoxScore(g.id);
                  }}
                  title="Box score submitted — click to view or edit"
                  data-testid={`button-view-box-score-${g.id}`}
                >
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-primary"
                onClick={(e) => { e.preventDefault(); setEditGame(g as Game); }}
                title="Edit game"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Link href={`/games/${g.id}`}>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => setDeleteId(g.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {/* Mobile-only: Open chevron stays visible, secondary actions
                collapse into an overflow menu so destructive Delete is
                one extra tap away from a thumb-sized target. */}
            <Link href={`/games/${g.id}`} className="sm:hidden">
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <ChevronRight className="h-5 w-5" />
              </Button>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild className="sm:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground"
                  onClick={(e) => e.preventDefault()}
                  aria-label="More actions"
                  data-testid={`button-game-menu-${g.id}`}
                >
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                {g.boxScoreImportedAt && (
                  <DropdownMenuItem
                    onSelect={() => onViewBoxScore(g.id)}
                    data-testid={`menu-view-box-score-${g.id}`}
                  >
                    <FileText className="mr-2 h-4 w-4 text-green-700" />
                    View box score
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => setEditGame(g as Game)}
                  data-testid={`menu-edit-game-${g.id}`}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setDeleteId(g.id)}
                  className="text-destructive focus:text-destructive"
                  data-testid={`menu-delete-game-${g.id}`}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="eyebrow text-primary/70">Game Day</div>
          <h1 className="page-title text-foreground mt-1">Schedule</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {counts.all === 0
              ? "Nothing scheduled yet"
              : `${counts.all} item${counts.all !== 1 ? "s" : ""} this season`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowIcal(true)}>
            <Link2 className="h-4 w-4 mr-2" />
            Import Calendar
          </Button>
          <Link href="/games/new">
            <Button>
              <CalendarDays className="h-4 w-4 mr-2" />
              Add Game
            </Button>
          </Link>
        </div>
      </div>

      {games.length > 0 && !isLoading && (
        <div className="flex flex-wrap gap-1.5 p-1 rounded-lg bg-muted w-fit">
          {([
            { key: "all" as const, label: "All", count: counts.all },
            { key: "game" as const, label: "Games", count: counts.game },
            { key: "practice" as const, label: "Practices", count: counts.practice },
            { key: "other" as const, label: "Events", count: counts.other },
          ]).map((opt) => {
            const active = filter === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFilter(opt.key)}
                disabled={opt.count === 0 && opt.key !== "all"}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                }`}
              >
                {opt.label}
                <span className={`text-xs tabular-nums ${active ? "text-muted-foreground" : ""}`}>
                  ({opt.count})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : games.length === 0 ? (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-3 text-center">
            <CalendarDays className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">No games scheduled yet.</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowIcal(true)}>
                <Link2 className="h-4 w-4 mr-2" /> Import Calendar
              </Button>
              <Link href="/games/new">
                <Button><CalendarDays className="h-4 w-4 mr-2" /> Add First Game</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-10">
          <CardContent className="flex flex-col items-center gap-2 text-center">
            <CalendarDays className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No {filter === "game" ? "games" : filter === "practice" ? "practices" : "events"} on the schedule.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setFilter("all")}>Show all items</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {heroGame && filter !== "practice" && filter !== "other" && (
            <NextGameHero game={heroGame} teamName={teamName ?? ""} />
          )}
          {upcomingForList.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</h2>
              {upcomingForList.map((g) => <GameCard key={g.id} g={g} teamName={teamName} onViewBoxScore={setBoxScoreGameId} />)}
            </div>
          )}
          {pastForList.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {filter === "game" ? "Past Games" : "Past"}
              </h2>
              {pastForList.map((g) => <GameCard key={g.id} g={g} teamName={teamName} onViewBoxScore={setBoxScoreGameId} />)}
            </div>
          )}
        </>
      )}

      {/* iCal import dialog */}
      <ICalImportDialog
        open={showIcal}
        onClose={() => setShowIcal(false)}
        onImported={refresh}
      />

      {/* Edit dialog */}
      {editGame && (
        <EditGameDialog
          game={editGame}
          onClose={() => setEditGame(null)}
          onSaved={refresh}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete game?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the game and its lineup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {boxScoreGameId != null && (() => {
        // Pull the game's current scheduled length from the cached
        // games list so the dialog's "Last inning played" picker can
        // bound itself correctly. Falls back to 6 (the app default)
        // for the rare race where the game has been removed from the
        // list but the dialog id is still set.
        const innings =
          games.find((g) => g.id === boxScoreGameId)?.innings ?? 6;
        return (
          <BoxScoreImportDialog
            gameId={boxScoreGameId}
            gameInnings={innings}
            players={players}
            open={boxScoreGameId != null}
            onOpenChange={(o) => !o && setBoxScoreGameId(null)}
          />
        );
      })()}
    </div>
  );
}
