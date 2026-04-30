import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetGame,
  useGetGameLineup,
  useGenerateLineup,
  useSaveLineup,
  useUpdateGame,
  useListPlayers,
  getGetGameQueryKey,
  getGetGameLineupQueryKey,
  getListGamesQueryKey,
  getGetSeasonStatsQueryKey,
  getGetPlayerStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Wand2, Save, Trophy, CalendarDays, MapPin, ClipboardCopy, X } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "Bench"];
const FIELD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

function positionColor(pos: string) {
  const colors: Record<string, string> = {
    P: "bg-red-100 text-red-800",
    C: "bg-orange-100 text-orange-800",
    "1B": "bg-yellow-100 text-yellow-800",
    "2B": "bg-lime-100 text-lime-800",
    "3B": "bg-emerald-100 text-emerald-800",
    SS: "bg-cyan-100 text-cyan-800",
    LF: "bg-blue-100 text-blue-800",
    CF: "bg-indigo-100 text-indigo-800",
    RF: "bg-purple-100 text-purple-800",
    Bench: "bg-gray-100 text-gray-600",
  };
  return colors[pos] ?? "bg-muted text-muted-foreground";
}

export default function GameDetail() {
  const [, params] = useRoute("/games/:id");
  const id = parseInt(params?.id ?? "0");
  const { data: game, isLoading: gameLoading } = useGetGame(id, {
    query: { enabled: !!id, queryKey: getGetGameQueryKey(id) },
  });
  const { data: lineup = [], isLoading: lineupLoading } = useGetGameLineup(id, {
    query: { enabled: !!id, queryKey: getGetGameLineupQueryKey(id) },
  });
  const { data: players = [] } = useListPlayers();
  const generateLineup = useGenerateLineup();
  const saveLineup = useSaveLineup();
  const updateGame = useUpdateGame();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<number[]>([]);
  const [previewLineup, setPreviewLineup] = useState<typeof lineup | null>(null);
  // Edits to a saved lineup (ad-hoc position swaps) live here until saved.
  const [editedLineup, setEditedLineup] = useState<typeof lineup | null>(null);
  // Click-to-swap selection: the entry id of the player picked first.
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [ourScore, setOurScore] = useState("");
  const [opponentScore, setOpponentScore] = useState("");

  const openGenerate = () => {
    setSelectedPlayerIds(players.filter((p) => p.active).map((p) => p.id));
    setPreviewLineup(null);
    setGenerateOpen(true);
  };

  const handleGenerate = () => {
    if (selectedPlayerIds.length === 0) {
      toast({ title: "Select at least one player", variant: "destructive" });
      return;
    }
    if (editedLineup) {
      const ok = window.confirm(
        "You have unsaved lineup edits. Generating a new lineup will discard them. Continue?",
      );
      if (!ok) return;
      setEditedLineup(null);
      setSelectedEntryId(null);
    }
    generateLineup.mutate(
      {
        id,
        data: {
          availablePlayerIds: selectedPlayerIds,
          innings: game?.innings ?? 6,
          constraints: {
            maxInningsPerPosition: 2,
            maxInningsBench: 2,
            ensureAllPositions: true,
            pitcherRotation: false,
          },
        },
      },
      {
        onSuccess: (result) => {
          setPreviewLineup(result);
          toast({ title: "Lineup generated — review and save" });
        },
        onError: () => toast({ title: "Failed to generate lineup", variant: "destructive" }),
      }
    );
  };

  const handleSaveLineup = (lineupToSave: typeof lineup) => {
    saveLineup.mutate(
      {
        id,
        data: {
          entries: lineupToSave.map((e) => ({
            playerId: e.playerId,
            inning: e.inning,
            position: e.position,
            battingOrder: e.battingOrder ?? null,
          })),
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGameLineupQueryKey(id) });
          qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() });
          toast({ title: "Lineup saved" });
          setGenerateOpen(false);
          setPreviewLineup(null);
          setEditedLineup(null);
          setSelectedEntryId(null);
        },
        onError: () => toast({ title: "Failed to save lineup", variant: "destructive" }),
      }
    );
  };

  // Tap a player → tap another cell in the same inning → swap their positions.
  // Tap an empty cell after selecting a player → move that player there.
  const handleCellClick = (target: { entryId?: number; inning: number; position: string }) => {
    const current = previewLineup ?? editedLineup ?? lineup;

    // Nothing selected yet: only player cells select; empty cells are no-ops.
    if (selectedEntryId == null) {
      if (target.entryId != null) setSelectedEntryId(target.entryId);
      return;
    }
    // Tapped the same cell twice — clear selection.
    if (target.entryId === selectedEntryId) {
      setSelectedEntryId(null);
      return;
    }
    const sourceEntry = current.find((e) => e.id === selectedEntryId);
    if (!sourceEntry) {
      setSelectedEntryId(null);
      return;
    }
    if (sourceEntry.inning !== target.inning) {
      toast({
        title: "Pick a cell in the same inning to swap",
        description: "Players can only swap within the same inning.",
        variant: "destructive",
      });
      // Re-anchor selection on the new player if they tapped one
      setSelectedEntryId(target.entryId ?? null);
      return;
    }

    let next: typeof current;
    if (target.entryId != null) {
      // Swap two players in the same inning
      const targetEntry = current.find((e) => e.id === target.entryId)!;
      next = current.map((e) => {
        if (e.id === sourceEntry.id) return { ...e, position: targetEntry.position };
        if (e.id === targetEntry.id) return { ...e, position: sourceEntry.position };
        return e;
      });
    } else {
      // Move source player into an empty position
      next = current.map((e) =>
        e.id === sourceEntry.id ? { ...e, position: target.position } : e
      );
    }

    if (previewLineup) setPreviewLineup(next);
    else setEditedLineup(next);
    setSelectedEntryId(null);
  };

  const handleCopyLineup = async () => {
    const data = previewLineup ?? editedLineup ?? lineup;
    if (data.length === 0) {
      toast({ title: "Nothing to copy yet", variant: "destructive" });
      return;
    }
    const inningCount = game?.innings ?? 6;
    const header = ["Inning", ...FIELD_POSITIONS, "Bench"].join("\t");
    const rows = Array.from({ length: inningCount }, (_, i) => i + 1).map((inning) => {
      const cells = FIELD_POSITIONS.map((pos) => {
        const e = data.find((x) => x.inning === inning && x.position === pos);
        return e ? e.playerName : "";
      });
      const bench = data
        .filter((x) => x.inning === inning && x.position === "Bench")
        .map((x) => x.playerName)
        .join(", ");
      return [String(inning), ...cells, bench].join("\t");
    });
    const tsv = [header, ...rows].join("\n");
    const showSuccess = () =>
      toast({ title: "Lineup copied", description: "Paste it into Google Sheets." });
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tsv);
        showSuccess();
        return;
      }
      throw new Error("Clipboard API unavailable");
    } catch {
      // Fallback: hidden textarea + execCommand (works in non-secure contexts / older browsers)
      try {
        const ta = document.createElement("textarea");
        ta.value = tsv;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.left = "-1000px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) {
          showSuccess();
          return;
        }
      } catch {
        // fall through to toast
      }
      toast({ title: "Copy failed — clipboard not available", variant: "destructive" });
    }
  };

  const discardEdits = () => {
    setEditedLineup(null);
    setSelectedEntryId(null);
  };

  const handleMarkComplete = () => {
    updateGame.mutate(
      {
        id,
        data: {
          status: "completed",
          ourScore: parseInt(ourScore) || 0,
          opponentScore: parseInt(opponentScore) || 0,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGameQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          toast({ title: "Game marked as completed" });
          setCompleteOpen(false);
        },
        onError: () => toast({ title: "Failed to update game", variant: "destructive" }),
      }
    );
  };

  // Organize lineup into inning -> position map
  const innings = game?.innings ?? 6;
  const lineupByInning: Record<number, Record<string, string>> = {};
  for (let i = 1; i <= innings; i++) {
    lineupByInning[i] = {};
  }
  const displayLineup = previewLineup ?? editedLineup ?? lineup;
  // Map (inning, position) -> entry, so cells know their entry id for swap.
  const cellByInningPos: Record<number, Record<string, typeof displayLineup[number]>> = {};
  for (const entry of displayLineup) {
    if (!lineupByInning[entry.inning]) lineupByInning[entry.inning] = {};
    lineupByInning[entry.inning][entry.position] = entry.playerName;
    if (!cellByInningPos[entry.inning]) cellByInningPos[entry.inning] = {};
    // For non-bench positions there's at most one entry; for bench we render
    // the multi-player path separately so this single-cell map is fine.
    if (entry.position !== "Bench") {
      cellByInningPos[entry.inning][entry.position] = entry;
    }
  }
  const selectedEntry = selectedEntryId != null
    ? displayLineup.find((e) => e.id === selectedEntryId)
    : undefined;

  if (gameLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-64 bg-muted rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Game not found.</p>
        <Link href="/games"><Button variant="link">Back to Schedule</Button></Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link href="/games">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Schedule
          </Button>
        </Link>
      </div>

      {/* Game Header */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold">vs. {game.opponent}</h1>
                {game.status === "completed" ? (
                  <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>
                ) : game.status === "cancelled" ? (
                  <Badge variant="outline">Cancelled</Badge>
                ) : (
                  <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Upcoming</Badge>
                )}
              </div>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {format(new Date(game.gameDate), "EEEE, MMMM d, yyyy · h:mm a")}
                </span>
                {game.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {game.location}
                  </span>
                )}
                <span>{game.innings} innings</span>
              </div>
              {game.status === "completed" && game.ourScore != null && (
                <div className="mt-2 flex items-center gap-3">
                  <span className={`text-xl font-bold px-3 py-1 rounded ${(game.ourScore > (game.opponentScore ?? 0)) ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                    {game.ourScore > (game.opponentScore ?? 0) ? "W" : "L"} {game.ourScore} - {game.opponentScore}
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {game.status === "upcoming" && (
                <>
                  <Button variant="outline" onClick={() => setCompleteOpen(true)}>
                    <Trophy className="h-4 w-4 mr-2" />
                    Mark Complete
                  </Button>
                  <Button onClick={openGenerate}>
                    <Wand2 className="h-4 w-4 mr-2" />
                    Generate Lineup
                  </Button>
                </>
              )}
              {game.status === "completed" && lineup.length === 0 && (
                <Button onClick={openGenerate}>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Generate Lineup
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lineup Grid */}
      {previewLineup && (
        <div className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg" data-testid="banner-preview">
          <span className="text-sm text-yellow-800 font-medium">Preview — lineup not saved yet</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setPreviewLineup(null); setSelectedEntryId(null); }}>Discard</Button>
            <Button size="sm" onClick={() => handleSaveLineup(previewLineup)} disabled={saveLineup.isPending} data-testid="button-save-preview">
              <Save className="h-4 w-4 mr-1" />
              {saveLineup.isPending ? "Saving..." : "Save Lineup"}
            </Button>
          </div>
        </div>
      )}
      {!previewLineup && editedLineup && (
        <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg" data-testid="banner-edited">
          <span className="text-sm text-amber-800 font-medium">Unsaved changes — you've moved players around</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={discardEdits} data-testid="button-discard-edits">Discard</Button>
            <Button size="sm" onClick={() => handleSaveLineup(editedLineup)} disabled={saveLineup.isPending} data-testid="button-save-edits">
              <Save className="h-4 w-4 mr-1" />
              {saveLineup.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 gap-3">
          <CardTitle className="text-base">
            {displayLineup.length > 0 ? "Defensive Lineup" : "No Lineup Yet"}
          </CardTitle>
          {displayLineup.length > 0 && (
            <div className="flex items-center gap-2">
              {selectedEntry && (
                <span className="text-xs text-muted-foreground hidden sm:inline" data-testid="text-swap-hint">
                  Swapping <span className="font-medium text-foreground">{selectedEntry.playerName.split(" ")[0]}</span> — tap another cell in inning {selectedEntry.inning}
                  <button
                    type="button"
                    className="ml-2 inline-flex items-center text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedEntryId(null)}
                    title="Cancel swap"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              <Button variant="outline" size="sm" onClick={handleCopyLineup} data-testid="button-copy-lineup">
                <ClipboardCopy className="h-4 w-4 mr-1.5" />
                Copy
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {lineupLoading ? (
            <div className="h-40 bg-muted animate-pulse rounded" />
          ) : displayLineup.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Wand2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>No lineup generated yet.</p>
              <Button className="mt-3" onClick={openGenerate}>
                <Wand2 className="h-4 w-4 mr-2" />
                Generate Lineup
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left py-2 pr-3 text-muted-foreground font-medium text-xs w-16">Inning</th>
                    {FIELD_POSITIONS.map((pos) => (
                      <th key={pos} className="text-center py-2 px-1 text-muted-foreground font-medium text-xs w-20">{pos}</th>
                    ))}
                    <th className="text-center py-2 px-1 text-muted-foreground font-medium text-xs w-20">Bench</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: innings }, (_, i) => i + 1).map((inning) => {
                    const isSwapInning = selectedEntry?.inning === inning;
                    return (
                      <tr key={inning} className="border-t border-border/50">
                        <td className="py-2 pr-3 font-semibold text-muted-foreground">{inning}</td>
                        {FIELD_POSITIONS.map((pos) => {
                          const entry = cellByInningPos[inning]?.[pos];
                          const isSelected = entry?.id === selectedEntryId;
                          // Empty cells become valid drop targets only while swapping in this inning
                          const isEmptyDropTarget = !entry && isSwapInning;
                          const baseClasses = "inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap min-w-[2.5rem] transition-all";
                          const ringClasses = isSelected
                            ? "ring-2 ring-primary ring-offset-1"
                            : isSwapInning && entry
                              ? "ring-1 ring-primary/40 hover:ring-primary"
                              : "";
                          return (
                            <td key={pos} className="py-1.5 px-1 text-center">
                              {entry ? (
                                <button
                                  type="button"
                                  onClick={() => handleCellClick({ entryId: entry.id, inning, position: pos })}
                                  className={`${baseClasses} ${positionColor(pos)} ${ringClasses} cursor-pointer hover:opacity-90`}
                                  data-testid={`cell-${inning}-${pos}`}
                                  data-entry-id={entry.id}
                                  data-selected={isSelected ? "true" : "false"}
                                  title={`${entry.playerName} — tap to swap`}
                                >
                                  {entry.playerName.split(" ")[0]}
                                </button>
                              ) : isEmptyDropTarget ? (
                                <button
                                  type="button"
                                  onClick={() => handleCellClick({ inning, position: pos })}
                                  className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap min-w-[2.5rem] border border-dashed border-primary/60 text-primary hover:bg-primary/10"
                                  data-testid={`cell-${inning}-${pos}-empty`}
                                  title={`Move here`}
                                >
                                  +
                                </button>
                              ) : (
                                <span className="text-muted-foreground/40 text-xs">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-1.5 px-1 text-center">
                          <div className="flex flex-wrap gap-1 justify-center">
                            {displayLineup
                              .filter((e) => e.inning === inning && e.position === "Bench")
                              .map((e) => {
                                const isSelected = e.id === selectedEntryId;
                                const ringClasses = isSelected
                                  ? "ring-2 ring-primary ring-offset-1"
                                  : isSwapInning
                                    ? "ring-1 ring-primary/40 hover:ring-primary"
                                    : "";
                                return (
                                  <button
                                    key={e.id}
                                    type="button"
                                    onClick={() => handleCellClick({ entryId: e.id, inning, position: "Bench" })}
                                    className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-gray-100 text-gray-600 ${ringClasses} cursor-pointer hover:opacity-90`}
                                    data-testid={`cell-${inning}-Bench-${e.id}`}
                                    data-entry-id={e.id}
                                    data-selected={isSelected ? "true" : "false"}
                                    title={`${e.playerName} — tap to swap`}
                                  >
                                    {e.playerName.split(" ")[0]}
                                  </button>
                                );
                              })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generate Dialog */}
      <Dialog open={generateOpen} onOpenChange={(o) => !o && setGenerateOpen(false)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Lineup</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Select players available for this game. The lineup will rotate positions fairly.
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <Label className="text-sm">Available Players</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-primary"
                    onClick={() => setSelectedPlayerIds(players.filter((p) => p.active).map((p) => p.id))}
                  >
                    Select all
                  </button>
                  <span className="text-xs text-muted-foreground">·</span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground"
                    onClick={() => setSelectedPlayerIds([])}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {players.filter((p) => p.active).map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                    selectedPlayerIds.includes(p.id)
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <Checkbox
                    checked={selectedPlayerIds.includes(p.id)}
                    onCheckedChange={(v) =>
                      setSelectedPlayerIds((prev) =>
                        v ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                      )
                    }
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{p.name}</span>
                    {p.number != null && <span className="text-xs text-muted-foreground ml-1.5">#{p.number}</span>}
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {p.eligiblePositions.slice(0, 3).map((pos) => (
                      <span key={pos} className="text-xs text-muted-foreground">{pos}</span>
                    ))}
                  </div>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>Cancel</Button>
            {previewLineup ? (
              <Button onClick={() => handleSaveLineup(previewLineup)} disabled={saveLineup.isPending}>
                <Save className="h-4 w-4 mr-1" />
                {saveLineup.isPending ? "Saving..." : "Save This Lineup"}
              </Button>
            ) : (
              <Button onClick={handleGenerate} disabled={generateLineup.isPending}>
                <Wand2 className="h-4 w-4 mr-1" />
                {generateLineup.isPending ? "Generating..." : "Generate"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Game Dialog */}
      <Dialog open={completeOpen} onOpenChange={(o) => !o && setCompleteOpen(false)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Mark Game Complete</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Our Score</Label>
                <Input
                  type="number"
                  min="0"
                  value={ourScore}
                  onChange={(e) => setOurScore(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Opponent Score</Label>
                <Input
                  type="number"
                  min="0"
                  value={opponentScore}
                  onChange={(e) => setOpponentScore(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteOpen(false)}>Cancel</Button>
            <Button onClick={handleMarkComplete} disabled={updateGame.isPending}>
              {updateGame.isPending ? "Saving..." : "Mark Complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
