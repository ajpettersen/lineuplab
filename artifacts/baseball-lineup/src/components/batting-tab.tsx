import { useState } from "react";
import { battingStatsQuery } from "@/lib/extra-queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Plus, Wand2, Trash2, ArrowUp, ArrowDown, ArrowUpDown, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollX } from "@/components/ui/scroll-x";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";
import { showUndoToast, postJson } from "@/lib/undo-toast";
import { PlayerGameLogDialog } from "@/components/player-game-log-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BattingRow {
  id: number;
  playerId: number;
  playerName: string;
  playerNumber: number | null;
  seasonLabel: string;
  ab: number; hits: number; doubles: number; triples: number; hr: number;
  rbi: number; bb: number; k: number; hbp: number; sac: number; sf: number; sb: number;
  runs?: number;
  avg: number | null; obp: number | null; slg: number | null; ops: number | null;
  // Distinct games this player has a per-game batting line for
  // (i.e. games with a saved box score). Manual-only rows return 0
  // here even though the player may have played in many games —
  // hence the "—" rendering when `hasPerGameLines` is false. See
  // `getBattingTotals()` in api-server/src/lib/batting-totals.ts.
  gamesRecorded?: number;
  hasPerGameLines?: boolean;
  sourceNote: string | null;
  updatedAt: string;
}

type ExtractedRow = { playerId: number; playerName: string; ab: number; hits: number; doubles: number; triples: number; hr: number; rbi: number; bb: number; k: number; hbp: number; sac: number; sf: number; sb: number };

function useBattingStats() {
  return useQuery(battingStatsQuery<BattingRow[]>());
}

export function BattingTab({ players }: { players: { id: number; name: string; number: number | null }[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: battingStats = [] } = useBattingStats();

  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<ExtractedRow>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  // Bulk-nuke flow: gates the destructive POST behind a typed
  // confirmation so a misclick can't wipe a season's worth of
  // hand-entered stats. The undo toast carries the snapshot for ~10s.
  const [nukeOpen, setNukeOpen] = useState(false);
  const [nukeConfirm, setNukeConfirm] = useState("");
  const [nuking, setNuking] = useState(false);
  // Column sort. `null` key = default name order. Clicking a column
  // cycles desc → asc → off so the coach can quickly find leaders or
  // trailers in any stat. Players with no value sort to the bottom
  // regardless of direction so they don't crowd out real data.
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Click-through: opens the per-player game-log dialog. Reused across
  // every stat-table click site.
  const [logPlayerId, setLogPlayerId] = useState<number | null>(null);

  const statsMap = Object.fromEntries(battingStats.map((b) => [b.playerId, b]));

  const startEdit = (playerId: number) => {
    const existing = statsMap[playerId];
    setEditId(playerId);
    setEditData(existing ? { ...existing } : { playerId, ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, k: 0, hbp: 0, sac: 0, sf: 0, sb: 0 });
  };

  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      const resp = await fetch(`${BASE}/api/batting/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData),
      });
      // Surface server-side rejections (e.g. a total typed below the
      // recorded box-score sum returns 400) instead of falsely toasting
      // success — otherwise a failed write looks saved and the table
      // silently diverges from what the coach sees.
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${resp.status})`);
      }
      qc.invalidateQueries({ queryKey: ["batting-stats"] });
      toast({ title: "Stats saved" });
      setEditId(null);
    } catch (err) {
      toastError(toast, "Failed to save", err);
    } finally {
      setSaving(false);
    }
  };

  const clearAllManualStats = async () => {
    setNuking(true);
    try {
      const resp = (await postJson("/api/batting/clear-all", {
        confirm: "DELETE",
      })) as { deletedCount: number; snapshot: unknown[] };
      qc.invalidateQueries({ queryKey: ["batting-stats"] });
      setNukeOpen(false);
      setNukeConfirm("");
      if (resp.deletedCount === 0) {
        toast({ title: "No manual stats to delete" });
        return;
      }
      showUndoToast(toast, {
        title: `Cleared ${resp.deletedCount} manual stat row${resp.deletedCount === 1 ? "" : "s"}`,
        description: "Box-score-derived stats are untouched.",
        onUndo: async () => {
          try {
            await postJson("/api/batting/restore", { rows: resp.snapshot });
            qc.invalidateQueries({ queryKey: ["batting-stats"] });
            toast({ title: "Manual stats restored" });
          } catch {
            toast({ title: "Couldn't undo", variant: "destructive" });
          }
        },
      });
    } catch (err) {
      toastError(toast, "Failed to clear stats", err);
    } finally {
      setNuking(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const resp = await fetch(`${BASE}/api/batting/extract`, { method: "POST", body: fd });
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        throw new Error(body?.error ?? `Extraction failed (${resp.status})`);
      }
      const { extracted: rows, unmatched } = (await resp.json()) as {
        extracted: ExtractedRow[];
        unmatched?: string[];
      };
      setExtracted(rows);
      setUploadOpen(false);
      toast({
        title: `Extracted stats for ${rows.length} player${rows.length === 1 ? "" : "s"} — review and save`,
        description:
          unmatched && unmatched.length > 0
            ? `Couldn't match: ${unmatched.join(", ")}. Check those names against your roster.`
            : undefined,
      });
    } catch (err) {
      toastError(toast, "Extraction failed", err);
    } finally {
      setUploading(false);
    }
  };

  const saveExtracted = async () => {
    if (!extracted) return;
    setSaving(true);
    try {
      // Season screenshots carry FULL season-to-date totals, so we send
      // them to the override endpoint (NOT per-row PUT). It stores the
      // totals verbatim and stamps a cutoff so every prior box-score
      // rollup is superseded while future games still accumulate.
      const resp = await fetch(`${BASE}/api/batting/import-season`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: extracted.map((row) => ({ ...row, sourceNote: "Imported from season stats" })),
        }),
      });
      if (!resp.ok) throw new Error(`import-season failed (${resp.status})`);
      qc.invalidateQueries({ queryKey: ["batting-stats"] });
      toast({ title: `Imported season stats for ${extracted.length} players` });
      setExtracted(null);
    } catch (err) {
      toastError(toast, "Failed to save extracted stats", err);
    } finally {
      setSaving(false);
    }
  };

  // Unified column spec for the batting stats table. PA is derived (AB+BB+HBP+SAC+SF),
  // R comes from rolled-up game lines (not editable here), and AVG/OBP/SLG/OPS are
  // derived rates. `editKey` marks the BattingStats column the cell maps to in the
  // manual edit form; columns without `editKey` render as derived/read-only in edit mode.
  const COLS: Array<{ label: string; statKey: string; editKey?: string; derived?: "pa" | "rate" | "runs" | "games" }> = [
    // G = distinct games with a saved box score for this player.
    // Pairs with PA so a coach can eyeball PA/G ("are my 6th-9th
    // hitters getting roughly the same plate appearances per game?").
    // Renders "—" for manual-only stat rows because we don't know
    // how many games those plate appearances came from.
    { label: "G",   statKey: "gamesRecorded", derived: "games" },
    { label: "PA",  statKey: "pa",      derived: "pa" },
    { label: "AB",  statKey: "ab",      editKey: "ab" },
    { label: "H",   statKey: "hits",    editKey: "hits" },
    { label: "AVG", statKey: "avg",     derived: "rate" },
    { label: "OBP", statKey: "obp",     derived: "rate" },
    { label: "SLG", statKey: "slg",     derived: "rate" },
    { label: "OPS", statKey: "ops",     derived: "rate" },
    { label: "R",   statKey: "runs",    derived: "runs" },
    { label: "RBI", statKey: "rbi",     editKey: "rbi" },
    { label: "2B",  statKey: "doubles", editKey: "doubles" },
    { label: "3B",  statKey: "triples", editKey: "triples" },
    { label: "HR",  statKey: "hr",      editKey: "hr" },
    { label: "BB",  statKey: "bb",      editKey: "bb" },
    { label: "K",   statKey: "k",       editKey: "k" },
    { label: "HBP", statKey: "hbp",     editKey: "hbp" },
    { label: "SB",  statKey: "sb",      editKey: "sb" },
    { label: "SAC", statKey: "sac",     editKey: "sac" },
    { label: "SF",  statKey: "sf",      editKey: "sf" },
  ];

  const fmtAvg = (v: number | null | undefined) => v != null ? v.toFixed(3).replace(/^0/, "") : "—";

  /** PA is derived, never stored. Treat missing rows as "no plate appearances yet". */
  const computePA = (s: { ab?: number | null; bb?: number | null; hbp?: number | null; sac?: number | null; sf?: number | null } | undefined | null): number | null => {
    if (!s) return null;
    return (s.ab ?? 0) + (s.bb ?? 0) + (s.hbp ?? 0) + (s.sac ?? 0) + (s.sf ?? 0);
  };

  /**
   * Extract the comparable value for a sort column. PA is derived from
   * the row; rates / counts come straight off the stats record. Returns
   * null when the player has no stat row (or the field isn't populated)
   * so they can be parked at the bottom regardless of direction.
   */
  const sortValue = (p: { id: number }, key: string): number | null => {
    const s = statsMap[p.id];
    if (!s) return null;
    if (key === "pa") return computePA(s);
    // For G, treat manual-only rows (no per-game lines) as null so
    // they sort to the bottom — sorting them as "0" would push real
    // box-score data below players who simply haven't been imported.
    if (key === "gamesRecorded") {
      if (!s.hasPerGameLines) return null;
      return s.gamesRecorded ?? null;
    }
    const v = (s as unknown as Record<string, number | null | undefined>)[key];
    return v == null ? null : v;
  };

  const sortedPlayers = (() => {
    if (!sortKey) return players;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...players].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulls always to the bottom
      if (vb == null) return -1;
      if (va === vb) return a.name.localeCompare(b.name);
      return (va - vb) * dir;
    });
  })();

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
      return;
    }
    if (sortDir === "desc") {
      setSortDir("asc");
      return;
    }
    setSortKey(null); // third click clears
  };

  const SortIcon = ({ k }: { k: string }) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 inline-block ml-0.5 opacity-30" />;
    return sortDir === "desc"
      ? <ArrowDown className="h-3 w-3 inline-block ml-0.5 text-primary" />
      : <ArrowUp className="h-3 w-3 inline-block ml-0.5 text-primary" />;
  };

  return (
    <div className="flex flex-col gap-6">
      {/*
        Compact mobile toolbar: the destructive "Delete all manual
        stats" button used to live next to "Extract from Screenshot",
        which wrapped to a second row on phones and pushed the table
        below the fold. Now the primary Extract action is icon-only on
        mobile (full label from `sm` up) and the destructive action
        moves into a kebab menu so the toolbar always fits a single
        line.
      */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Track offensive stats for lineup optimization. High OBP players can be prioritized for important games.
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUploadOpen(true)}
            aria-label="Import batting stats"
          >
            <Wand2 className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Import Stats</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More batting actions">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  setNukeConfirm("");
                  setNukeOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete all manual stats
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Extracted preview */}
      {extracted && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-yellow-800">Extracted stats — review before saving</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setExtracted(null)}>Discard</Button>
              <Button size="sm" onClick={saveExtracted} disabled={saving}>Save All</Button>
            </div>
          </div>
          <ScrollX>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-yellow-300">
                <th className="text-left py-1 pr-3 sticky left-0 z-20 bg-yellow-50 border-r border-yellow-200">Player</th>
                {COLS.map((c) => (
                  <th
                    key={c.statKey}
                    className="px-1 text-center"
                    title={c.derived === "pa" ? "Plate Appearances = AB + BB + HBP + SAC + SF" : undefined}
                  >
                    {c.label}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {extracted.map((row, i) => {
                  const livePA = computePA(row);
                  return (
                    <tr key={i} className="border-b border-yellow-100">
                      <td className="py-1 pr-3 font-medium sticky left-0 z-10 bg-yellow-50 border-r border-yellow-200">{row.playerName}</td>
                      {COLS.map((c) => {
                        if (c.editKey) {
                          return (
                            <td key={c.statKey} className="px-1 text-center">
                              <NumberInput
                                min={0}
                                fallback={0}
                                className="h-auto w-10 rounded border-yellow-300 bg-white p-0.5 text-center text-xs shadow-none"
                                value={(row as unknown as Record<string, number>)[c.editKey] ?? 0}
                                onChange={(n) => {
                                  const updated = [...extracted];
                                  (updated[i] as unknown as Record<string, number>)[c.editKey!] = n;
                                  setExtracted(updated);
                                }}
                              />
                            </td>
                          );
                        }
                        if (c.derived === "pa") {
                          return (
                            <td
                              key={c.statKey}
                              className="px-1 text-center text-[11px] font-bold text-yellow-900"
                              title="Plate Appearances = AB + BB + HBP + SAC + SF (auto-calculated)"
                            >
                              {livePA ?? 0}
                            </td>
                          );
                        }
                        return <td key={c.statKey} className="px-1 text-center text-yellow-700">—</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollX>
        </div>
      )}

      {/* Player stats table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Batting Stats</CardTitle></CardHeader>
        <CardContent>
          <ScrollX>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground sticky left-0 z-20 bg-card border-r border-border">Player</th>
                  {COLS.map((c) => (
                    <th
                      key={c.statKey}
                      className="text-center px-2 font-medium text-muted-foreground select-none cursor-pointer hover:text-foreground"
                      title={
                        c.derived === "pa"
                          ? "Plate Appearances = AB + BB + HBP + SAC + SF. Click to sort."
                          : c.derived === "games"
                          ? "Games Played = distinct games with a saved box score. Pair with PA for plate appearances per game. Click to sort."
                          : "Click to sort"
                      }
                      onClick={() => toggleSort(c.statKey)}
                    >
                      {c.label}
                      <SortIcon k={c.statKey} />
                    </th>
                  ))}
                  <th className="px-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((p) => {
                  const s = statsMap[p.id];
                  if (editId === p.id) {
                    const livePA = computePA(editData);
                    return (
                      <tr key={p.id} className="border-b border-border/50 bg-primary/5">
                        <td className="py-2 pr-4 font-medium sticky left-0 z-10 bg-card border-r border-border">{p.name}</td>
                        {COLS.map((c) => {
                          if (c.editKey) {
                            return (
                              <td key={c.statKey} className="px-1">
                                <NumberInput
                                  min={0}
                                  fallback={0}
                                  className="h-auto w-12 rounded border-primary/30 bg-white p-1 text-center text-xs shadow-none"
                                  value={(editData as Record<string, number>)[c.editKey] ?? 0}
                                  onChange={(n) => setEditData((prev) => ({ ...prev, [c.editKey!]: n }))}
                                />
                              </td>
                            );
                          }
                          if (c.derived === "pa") {
                            return (
                              <td
                                key={c.statKey}
                                className="px-1 text-center text-xs font-bold text-primary"
                                title="Plate Appearances = AB + BB + HBP + SAC + SF (auto-calculated)"
                              >
                                {livePA ?? 0}
                              </td>
                            );
                          }
                          // G in edit mode: read-only — sourced from
                          // box-score imports, not the manual form.
                          return <td key={c.statKey} className="px-1 text-center text-muted-foreground">—</td>;
                        })}
                        <td className="py-2 pl-2 whitespace-nowrap">
                          <div className="flex gap-1">
                            <Button size="sm" className="h-7 text-xs" onClick={saveEdit} disabled={saving}>Save</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditId(null)}>Cancel</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  const pa = computePA(s);
                  return (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2.5 pr-4 sticky left-0 z-10 bg-card border-r border-border">
                        <button
                          type="button"
                          onClick={() => setLogPlayerId(p.id)}
                          className="font-medium text-left hover:underline focus:underline focus:outline-none"
                          title="View game log"
                        >
                          {p.name}
                        </button>
                        {p.number != null && <div className="text-xs text-muted-foreground">#{p.number}</div>}
                      </td>
                      {COLS.map((c) => {
                        if (c.derived === "pa") {
                          return (
                            <td
                              key={c.statKey}
                              className="text-center px-2 font-medium"
                              title="Plate Appearances = AB + BB + HBP + SAC + SF"
                            >
                              {pa ?? "—"}
                            </td>
                          );
                        }
                        if (c.derived === "games") {
                          // Show "—" when the player has no per-game
                          // lines so a manual-only row doesn't display
                          // a misleading "0" — they may well have
                          // played, we just don't have per-game data.
                          const g = s?.hasPerGameLines ? s.gamesRecorded ?? 0 : null;
                          return (
                            <td
                              key={c.statKey}
                              className="text-center px-2 font-medium"
                              title={
                                g == null
                                  ? "No box-score data imported for this player yet."
                                  : "Games with a saved box score"
                              }
                            >
                              {g ?? "—"}
                            </td>
                          );
                        }
                        if (c.derived === "rate") {
                          const rate = s ? (s as unknown as Record<string, number | null | undefined>)[c.statKey] ?? null : null;
                          const highlight =
                            (c.statKey === "avg" && (rate ?? 0) >= 0.3) ||
                            (c.statKey === "obp" && (rate ?? 0) >= 0.35) ||
                            (c.statKey === "slg" && (rate ?? 0) >= 0.4) ||
                            (c.statKey === "ops" && (rate ?? 0) >= 0.8);
                          const text =
                            c.statKey === "ops"
                              ? (rate != null ? rate.toFixed(3) : "—")
                              : fmtAvg(rate);
                          return (
                            <td
                              key={c.statKey}
                              className={`text-center px-2 font-mono font-medium ${highlight ? "text-green-700" : ""}`}
                            >
                              {text}
                            </td>
                          );
                        }
                        const val = s ? (s as unknown as Record<string, number | null | undefined>)[c.statKey] : undefined;
                        return (
                          <td key={c.statKey} className="text-center px-2">
                            {val ?? "—"}
                          </td>
                        );
                      })}
                      <td className="py-2.5 pl-2 whitespace-nowrap">
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startEdit(p.id)}>
                            <Plus className="h-3 w-3 mr-0.5" />{s ? "Edit" : "Add"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollX>
        </CardContent>
      </Card>

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Import Batting Stats</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <p className="text-sm text-muted-foreground">
              Upload a <strong>GameChanger stats export (.csv)</strong> for an exact import, or a photo/screenshot of a scorebook or stat sheet to read with AI. Stats are matched to your roster by jersey number and name.
            </p>
            <p className="rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
              Importing <strong>season</strong> stats replaces all prior totals (including imported box scores) for each matched player as of today. Games you record afterward will add on top.
            </p>
            <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors ${uploading ? "opacity-50 pointer-events-none" : "hover:border-primary/50 hover:bg-muted/30"}`}>
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Click to upload CSV, image, or PDF</span>
              <input
                type="file"
                className="hidden"
                accept=".csv,text/csv,image/*,.pdf"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
              />
            </label>
            {uploading && <p className="text-sm text-center text-muted-foreground animate-pulse">Reading stats...</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete-all confirmation */}
      <Dialog open={nukeOpen} onOpenChange={(open) => { setNukeOpen(open); if (!open) setNukeConfirm(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete all manual batting stats?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2 text-sm">
            <p>
              This wipes every hand-entered batting row across your roster.
              Per-game stats imported from box scores are <strong>not</strong> touched.
            </p>
            <p className="text-muted-foreground">
              You can undo this from the toast for a few seconds.
            </p>
            <div>
              <Label htmlFor="nuke-confirm" className="text-xs">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </Label>
              <Input
                id="nuke-confirm"
                autoFocus
                value={nukeConfirm}
                onChange={(e) => setNukeConfirm(e.target.value)}
                placeholder="DELETE"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNukeOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={nukeConfirm !== "DELETE" || nuking}
              onClick={clearAllManualStats}
            >
              {nuking ? "Deleting…" : "Delete all"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PlayerGameLogDialog
        playerId={logPlayerId}
        open={logPlayerId != null}
        onOpenChange={(v) => !v && setLogPlayerId(null)}
      />
    </div>
  );
}
