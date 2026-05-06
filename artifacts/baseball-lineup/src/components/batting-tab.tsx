import { useState } from "react";
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
import { Upload, Plus, Wand2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { showUndoToast, postJson } from "@/lib/undo-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BattingRow {
  id: number;
  playerId: number;
  playerName: string;
  playerNumber: number | null;
  seasonLabel: string;
  ab: number; hits: number; doubles: number; triples: number; hr: number;
  rbi: number; bb: number; k: number; hbp: number; sac: number; sb: number;
  runs?: number;
  avg: number | null; obp: number | null; slg: number | null; ops: number | null;
  sourceNote: string | null;
  updatedAt: string;
}

type ExtractedRow = { playerId: number; playerName: string; ab: number; hits: number; doubles: number; triples: number; hr: number; rbi: number; bb: number; k: number; hbp: number; sac: number; sb: number };

function useBattingStats() {
  return useQuery({
    queryKey: ["batting-stats"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/batting`);
      return r.json() as Promise<BattingRow[]>;
    },
  });
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

  const statsMap = Object.fromEntries(battingStats.map((b) => [b.playerId, b]));

  const startEdit = (playerId: number) => {
    const existing = statsMap[playerId];
    setEditId(playerId);
    setEditData(existing ? { ...existing } : { playerId, ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, k: 0, hbp: 0, sac: 0, sb: 0 });
  };

  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/api/batting/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData),
      });
      qc.invalidateQueries({ queryKey: ["batting-stats"] });
      toast({ title: "Stats saved" });
      setEditId(null);
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
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
    } catch {
      toast({ title: "Failed to clear stats", variant: "destructive" });
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
      const { extracted: rows } = await resp.json();
      setExtracted(rows);
      setUploadOpen(false);
      toast({ title: `Extracted stats for ${rows.length} players — review and save` });
    } catch {
      toast({ title: "Extraction failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const saveExtracted = async () => {
    if (!extracted) return;
    setSaving(true);
    try {
      for (const row of extracted) {
        await fetch(`${BASE}/api/batting/${row.playerId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...row, sourceNote: "Extracted from image" }),
        });
      }
      qc.invalidateQueries({ queryKey: ["batting-stats"] });
      toast({ title: `Saved stats for ${extracted.length} players` });
      setExtracted(null);
    } catch {
      toast({ title: "Failed to save extracted stats", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Unified column spec for the batting stats table. PA is derived (AB+BB+HBP+SAC),
  // R comes from rolled-up game lines (not editable here), and AVG/OBP/SLG/OPS are
  // derived rates. `editKey` marks the BattingStats column the cell maps to in the
  // manual edit form; columns without `editKey` render as derived/read-only in edit mode.
  const COLS: Array<{ label: string; statKey: string; editKey?: string; derived?: "pa" | "rate" | "runs" }> = [
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
  ];

  const fmtAvg = (v: number | null | undefined) => v != null ? v.toFixed(3).replace(/^0/, "") : "—";

  /** PA is derived, never stored. Treat missing rows as "no plate appearances yet". */
  const computePA = (s: { ab?: number | null; bb?: number | null; hbp?: number | null; sac?: number | null } | undefined | null): number | null => {
    if (!s) return null;
    return (s.ab ?? 0) + (s.bb ?? 0) + (s.hbp ?? 0) + (s.sac ?? 0);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Track offensive stats for lineup optimization. High OBP players can be prioritized for important games.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
            <Wand2 className="h-4 w-4 mr-1" /> Extract from Screenshot
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              setNukeConfirm("");
              setNukeOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4 mr-1" /> Delete all manual stats
          </Button>
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
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-yellow-300">
                <th className="text-left py-1 pr-3">Player</th>
                {COLS.map((c) => (
                  <th
                    key={c.statKey}
                    className="px-1 text-center"
                    title={c.derived === "pa" ? "Plate Appearances = AB + BB + HBP + SAC" : undefined}
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
                      <td className="py-1 pr-3 font-medium">{row.playerName}</td>
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
                              title="Plate Appearances = AB + BB + HBP + SAC (auto-calculated)"
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
          </div>
        </div>
      )}

      {/* Player stats table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Batting Stats</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Player</th>
                  {COLS.map((c) => (
                    <th
                      key={c.statKey}
                      className="text-center px-2 font-medium text-muted-foreground"
                      title={c.derived === "pa" ? "Plate Appearances = AB + BB + HBP + SAC" : undefined}
                    >
                      {c.label}
                    </th>
                  ))}
                  <th className="px-2"></th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const s = statsMap[p.id];
                  if (editId === p.id) {
                    const livePA = computePA(editData);
                    return (
                      <tr key={p.id} className="border-b border-border/50 bg-primary/5">
                        <td className="py-2 pr-4 font-medium">{p.name}</td>
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
                                title="Plate Appearances = AB + BB + HBP + SAC (auto-calculated)"
                              >
                                {livePA ?? 0}
                              </td>
                            );
                          }
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
                      <td className="py-2.5 pr-4">
                        <div className="font-medium">{p.name}</div>
                        {p.number != null && <div className="text-xs text-muted-foreground">#{p.number}</div>}
                      </td>
                      {COLS.map((c) => {
                        if (c.derived === "pa") {
                          return (
                            <td
                              key={c.statKey}
                              className="text-center px-2 font-medium"
                              title="Plate Appearances = AB + BB + HBP + SAC"
                            >
                              {pa ?? "—"}
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
          </div>
        </CardContent>
      </Card>

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Extract Stats from Screenshot</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <p className="text-sm text-muted-foreground">
              Upload a photo or screenshot of a scorebook, stat sheet, or document. The AI will read the batting stats and match them to your roster.
            </p>
            <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors ${uploading ? "opacity-50 pointer-events-none" : "hover:border-primary/50 hover:bg-muted/30"}`}>
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Click to upload image or PDF</span>
              <input
                type="file"
                className="hidden"
                accept="image/*,.pdf"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
              />
            </label>
            {uploading && <p className="text-sm text-center text-muted-foreground animate-pulse">Analyzing image...</p>}
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
    </div>
  );
}
