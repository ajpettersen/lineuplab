import { useState } from "react";
import { useGetSeasonStats, useGetPlayerStats, useListPlayers } from "@workspace/api-client-react";

interface ExtendedPlayerStats {
  playerId: number;
  playerName: string;
  playerNumber: number | null;
  gamesPlayed: number;
  totalInnings: number;
  benchInnings: number;
  unavailableInnings: number;
  positionInnings: Record<string, number>;
  inningsPitched: number;
  combinedTotal: number;
  combinedBench: number;
  combinedPositionInnings: Record<string, number>;
  historicalTotal: number;
  groups: Record<string, number>;
  groupPct: Record<string, number>;
}
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Upload, Plus, Trash2, Download, Wand2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ---- position group helpers ----
const GROUP_LABELS: Record<string, string> = {
  pitcher: "Pitcher",
  catcher: "Catcher",
  cornerInfield: "Corner IF",
  middleInfield: "Middle IF",
  infield: "Infield",
  outfield: "Outfield",
  bench: "Bench",
  unavailable: "Out",
};
const GROUP_ORDER = ["pitcher", "catcher", "cornerInfield", "middleInfield", "outfield", "bench"];
const GROUP_ORDER_MERGED = ["pitcher", "infield", "outfield", "bench"];
const MERGED_INFIELD_PARTS = ["catcher", "cornerInfield", "middleInfield"] as const;
const GROUP_COLORS: Record<string, string> = {
  pitcher: "#c0392b",
  catcher: "#e67e22",
  cornerInfield: "#f1c40f",
  middleInfield: "#27ae60",
  infield: "#27ae60",
  outfield: "#2980b9",
  bench: "#95a5a6",
  unavailable: "#d97706",
};

// ---- API helpers ----
function useHistoricalFielding() {
  return useQuery({
    queryKey: ["history-fielding"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/history/fielding`);
      return r.json() as Promise<HistoricalRow[]>;
    },
  });
}

function useBattingStats() {
  return useQuery({
    queryKey: ["batting-stats"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/batting`);
      return r.json() as Promise<BattingRow[]>;
    },
  });
}

interface HistoricalRow {
  id: number;
  playerId: number;
  playerName: string;
  playerNumber: number | null;
  importLabel: string;
  inningsP: number; inningsC: number; innings1b: number; innings2b: number;
  innings3b: number; inningsSs: number; inningsLf: number; inningsCf: number;
  inningsRf: number; inningsBench: number;
  createdAt: string;
}

interface BattingRow {
  id: number;
  playerId: number;
  playerName: string;
  playerNumber: number | null;
  seasonLabel: string;
  ab: number; hits: number; doubles: number; triples: number; hr: number;
  rbi: number; bb: number; k: number; hbp: number; sac: number; sb: number;
  avg: number | null; obp: number | null; slg: number | null; ops: number | null;
  sourceNote: string | null;
  updatedAt: string;
}

type ExtractedRow = { playerId: number; playerName: string; ab: number; hits: number; doubles: number; triples: number; hr: number; rbi: number; bb: number; k: number; hbp: number; sac: number; sb: number };

// ---- CSV parsing ----
const CSV_COLS = ["Player", "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "Bench"];

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? "0"; });
    return row;
  });
}

// ---- Fairness bar ----
function FairnessBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-muted-foreground">Fairness Score</span>
        <span className={`text-2xl font-bold ${score >= 80 ? "text-green-700" : score >= 60 ? "text-yellow-600" : "text-red-600"}`}>
          {score}/100
        </span>
      </div>
      <div className="w-full bg-muted rounded-full h-3">
        <div className={`h-3 rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// ---- Pct bar ----
function PctBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-2">
        <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono w-8 text-right">{pct}%</span>
    </div>
  );
}

// ---- History Import Tab ----
function HistoryTab({ players }: { players: { id: number; name: string; number: number | null }[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: historical = [] } = useHistoricalFielding();

  const [label, setLabel] = useState("");
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState<Array<Record<string, string>> | null>(null);
  const [saving, setSaving] = useState(false);

  const uniqueLabels = [...new Set(historical.map((h) => h.importLabel))];

  const previewRows = () => {
    if (!csvText.trim()) { toast({ title: "Paste CSV data first", variant: "destructive" }); return; }
    const rows = parseCsv(csvText);
    setParsed(rows);
  };

  const handleImport = async () => {
    if (!label.trim()) { toast({ title: "Enter an import label (e.g. 2025 Spring)", variant: "destructive" }); return; }
    if (!parsed || parsed.length === 0) { toast({ title: "Preview the CSV first", variant: "destructive" }); return; }

    const rows = parsed.map((row) => ({
      playerName: row["Player"] ?? row["Name"] ?? row["player"] ?? "",
      importLabel: label.trim(),
      inningsP: parseInt(row["P"] ?? "0") || 0,
      inningsC: parseInt(row["C"] ?? "0") || 0,
      innings1b: parseInt(row["1B"] ?? "0") || 0,
      innings2b: parseInt(row["2B"] ?? "0") || 0,
      innings3b: parseInt(row["3B"] ?? "0") || 0,
      inningsSs: parseInt(row["SS"] ?? "0") || 0,
      inningsLf: parseInt(row["LF"] ?? "0") || 0,
      inningsCf: parseInt(row["CF"] ?? "0") || 0,
      inningsRf: parseInt(row["RF"] ?? "0") || 0,
      inningsBench: parseInt(row["Bench"] ?? row["BN"] ?? "0") || 0,
    })).filter((r) => r.playerName);

    setSaving(true);
    try {
      const resp = await fetch(`${BASE}/api/history/fielding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), rows }),
      });
      const result = await resp.json();
      qc.invalidateQueries({ queryKey: ["history-fielding"] });
      qc.invalidateQueries({ queryKey: ["batting-stats"] });
      toast({ title: `Imported ${result.inserted} players${result.notFound?.length ? ` (${result.notFound.length} not matched)` : ""}` });
      setCsvText("");
      setParsed(null);
      setLabel("");
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteLabel = async (lbl: string) => {
    await fetch(`${BASE}/api/history/fielding/${encodeURIComponent(lbl)}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["history-fielding"] });
    toast({ title: `Deleted import: ${lbl}` });
  };

  const downloadTemplate = () => {
    const header = CSV_COLS.join(",");
    const rows = players.map((p) => `${p.name},0,0,0,0,0,0,0,0,0,0`).join("\n");
    const blob = new Blob([header + "\n" + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fielding-history-template.csv";
    a.click();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Template download */}
      <div className="flex items-center justify-between p-4 bg-muted/40 rounded-lg border border-border/50">
        <div>
          <p className="text-sm font-medium">CSV Format</p>
          <p className="text-xs text-muted-foreground mt-0.5">Columns: Player, P, C, 1B, 2B, 3B, SS, LF, CF, RF, Bench (innings each)</p>
        </div>
        <Button variant="outline" size="sm" onClick={downloadTemplate} disabled={players.length === 0}>
          <Download className="h-4 w-4 mr-1" /> Template
        </Button>
      </div>

      {/* Import form */}
      <Card>
        <CardHeader><CardTitle className="text-base">Import Past Season Data</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Import Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 2025 Spring Season" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Paste CSV Data</Label>
            <Textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={"Player,P,C,1B,2B,3B,SS,LF,CF,RF,Bench\nAlex Smith,2,0,4,6,0,8,4,0,2,3"}
              rows={8}
              className="font-mono text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={previewRows}>Preview</Button>
            <Button onClick={handleImport} disabled={saving || !parsed}>
              {saving ? "Importing..." : "Import"}
            </Button>
          </div>
          {parsed && (
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {CSV_COLS.map((c) => <th key={c} className="px-2 py-1.5 text-left font-medium">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((row, i) => (
                    <tr key={i} className="border-t border-border/30">
                      {CSV_COLS.map((c) => <td key={c} className="px-2 py-1">{row[c] ?? "—"}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Existing imports */}
      {uniqueLabels.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Existing Imports</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {uniqueLabels.map((lbl) => {
              const rows = historical.filter((h) => h.importLabel === lbl);
              return (
                <div key={lbl} className="flex items-center justify-between p-3 rounded-md border border-border/50">
                  <div>
                    <p className="font-medium text-sm">{lbl}</p>
                    <p className="text-xs text-muted-foreground">{rows.length} players</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteLabel(lbl)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Batting Stats Tab ----
function BattingTab({ players }: { players: { id: number; name: string; number: number | null }[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: battingStats = [] } = useBattingStats();

  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<ExtractedRow>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedRow[] | null>(null);
  const [saving, setSaving] = useState(false);

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

  const deleteStats = async (playerId: number) => {
    await fetch(`${BASE}/api/batting/${playerId}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["batting-stats"] });
    toast({ title: "Stats removed" });
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

  // PA (Plate Appearances) is shown alongside AB so coaches can keep PA
  // equitable across the roster — kids who walk a lot or get HBP get fewer
  // ABs but still come to the plate, and that should count for "fairness."
  // Same formula the league-mode lineup generator uses internally:
  // PA = AB + BB + HBP + SAC.
  const STAT_COLS = ["AB", "PA", "H", "2B", "3B", "HR", "RBI", "BB", "K", "HBP", "SAC", "SB", "AVG", "OBP", "OPS"];
  const EDIT_COLS = [
    { label: "AB", key: "ab" }, { label: "H", key: "hits" }, { label: "2B", key: "doubles" },
    { label: "3B", key: "triples" }, { label: "HR", key: "hr" }, { label: "RBI", key: "rbi" },
    { label: "BB", key: "bb" }, { label: "K", key: "k" }, { label: "HBP", key: "hbp" },
    { label: "SAC", key: "sac" }, { label: "SB", key: "sb" },
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
        <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
          <Wand2 className="h-4 w-4 mr-1" /> Extract from Screenshot
        </Button>
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
                {EDIT_COLS.flatMap((c) =>
                  c.key === "ab"
                    ? [
                        <th key={c.key} className="px-1 text-center">{c.label}</th>,
                        <th
                          key="pa"
                          className="px-1 text-center"
                          title="Plate Appearances = AB + BB + HBP + SAC"
                        >
                          PA
                        </th>,
                      ]
                    : [<th key={c.key} className="px-1 text-center">{c.label}</th>]
                )}
              </tr></thead>
              <tbody>
                {extracted.map((row, i) => {
                  const livePA = computePA(row);
                  return (
                    <tr key={i} className="border-b border-yellow-100">
                      <td className="py-1 pr-3 font-medium">{row.playerName}</td>
                      {EDIT_COLS.flatMap((c) => {
                        const inputCell = (
                          <td key={c.key} className="px-1 text-center">
                            <NumberInput
                              min={0}
                              fallback={0}
                              className="h-auto w-10 rounded border-yellow-300 bg-white p-0.5 text-center text-xs shadow-none"
                              value={(row as Record<string, number>)[c.key] ?? 0}
                              onChange={(n) => {
                                const updated = [...extracted];
                                (updated[i] as Record<string, number>)[c.key] = n;
                                setExtracted(updated);
                              }}
                            />
                          </td>
                        );
                        if (c.key === "ab") {
                          return [
                            inputCell,
                            <td
                              key="pa-live"
                              className="px-1 text-center text-[11px] font-bold text-yellow-900"
                              title="Plate Appearances = AB + BB + HBP + SAC (auto-calculated)"
                            >
                              {livePA ?? 0}
                            </td>,
                          ];
                        }
                        return [inputCell];
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
                  {STAT_COLS.map((c) => <th key={c} className="text-center px-2 font-medium text-muted-foreground">{c}</th>)}
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
                        {EDIT_COLS.flatMap((c) => {
                          const inputCell = (
                            <td key={c.key} className="px-1">
                              <NumberInput
                                min={0}
                                fallback={0}
                                className="h-auto w-12 rounded border-primary/30 bg-white p-1 text-center text-xs shadow-none"
                                value={(editData as Record<string, number>)[c.key] ?? 0}
                                onChange={(n) => setEditData((prev) => ({ ...prev, [c.key]: n }))}
                              />
                            </td>
                          );
                          // Right after AB, render a live-computed PA cell so
                          // the coach sees the total update as they type.
                          if (c.key === "ab") {
                            return [
                              inputCell,
                              <td
                                key="pa-live"
                                className="px-1 text-center text-xs font-bold text-primary"
                                title="Plate Appearances = AB + BB + HBP + SAC (auto-calculated)"
                              >
                                {livePA ?? 0}
                              </td>,
                            ];
                          }
                          return [inputCell];
                        })}
                        <td className="px-1">—</td>
                        <td className="px-1">—</td>
                        <td className="px-1">—</td>
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
                      <td className="text-center px-2">{s?.ab ?? "—"}</td>
                      <td
                        className="text-center px-2 font-medium"
                        title="Plate Appearances = AB + BB + HBP + SAC"
                      >
                        {pa ?? "—"}
                      </td>
                      <td className="text-center px-2">{s?.hits ?? "—"}</td>
                      <td className="text-center px-2">{s?.doubles ?? "—"}</td>
                      <td className="text-center px-2">{s?.triples ?? "—"}</td>
                      <td className="text-center px-2">{s?.hr ?? "—"}</td>
                      <td className="text-center px-2">{s?.rbi ?? "—"}</td>
                      <td className="text-center px-2">{s?.bb ?? "—"}</td>
                      <td className="text-center px-2">{s?.k ?? "—"}</td>
                      <td className="text-center px-2">{s?.hbp ?? "—"}</td>
                      <td className="text-center px-2">{s?.sac ?? "—"}</td>
                      <td className="text-center px-2">{s?.sb ?? "—"}</td>
                      <td className={`text-center px-2 font-mono font-medium ${s && (s.avg ?? 0) >= 0.3 ? "text-green-700" : ""}`}>{fmtAvg(s?.avg)}</td>
                      <td className={`text-center px-2 font-mono font-medium ${s && (s.obp ?? 0) >= 0.35 ? "text-green-700" : ""}`}>{fmtAvg(s?.obp)}</td>
                      <td className={`text-center px-2 font-mono font-medium ${s && (s.ops ?? 0) >= 0.8 ? "text-green-700" : ""}`}>{s?.ops != null ? s.ops.toFixed(3) : "—"}</td>
                      <td className="py-2.5 pl-2 whitespace-nowrap">
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startEdit(p.id)}>
                            <Plus className="h-3 w-3 mr-0.5" />{s ? "Edit" : "Add"}
                          </Button>
                          {s && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteStats(p.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
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
      <Dialog open={uploadOpen} onOpenChange={(o) => !o && setUploadOpen(false)}>
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
    </div>
  );
}

// ---- Main Stats component ----
export default function Stats() {
  const { data: seasonStats } = useGetSeasonStats();
  const { data: rawPlayerStats = [] } = useGetPlayerStats();
  const playerStats = rawPlayerStats as unknown as ExtendedPlayerStats[];
  const { data: players = [] } = useListPlayers();
  const [groupInfield, setGroupInfield] = useState(true);
  const displayGroupOrder = groupInfield ? GROUP_ORDER_MERGED : GROUP_ORDER;

  const benchData = playerStats
    .filter((p) => p.combinedTotal > 0)
    .map((p) => ({
      name: p.playerName.split(" ")[0],
      bench: p.combinedBench,
      field: p.combinedTotal - p.combinedBench,
    }))
    .sort((a, b) => b.bench - a.bench);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Season Stats</h1>
        <p className="text-muted-foreground mt-1">Playing time, position fairness, and offensive stats</p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="text-3xl font-bold">{seasonStats?.totalGames ?? 0}</div>
            <div className="text-sm text-muted-foreground mt-0.5">Total Games</div>
            <div className="text-xs text-muted-foreground">{seasonStats?.completedGames ?? 0} completed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-3xl font-bold">{seasonStats?.totalInnings ?? 0}</div>
            <div className="text-sm text-muted-foreground mt-0.5">Live Field Innings</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <FairnessBar score={seasonStats?.fairnessScore ?? 0} />
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="fielding">
        <TabsList>
          <TabsTrigger value="fielding">Fielding Time</TabsTrigger>
          <TabsTrigger value="batting">Batting Stats</TabsTrigger>
          <TabsTrigger value="history">Import History</TabsTrigger>
        </TabsList>

        {/* Fielding Tab */}
        <TabsContent value="fielding" className="flex flex-col gap-6 mt-4">
          {/* Position group breakdown per player */}
          {playerStats.filter((p) => p.combinedTotal > 0).length > 0 ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle className="text-base">Position Group Breakdown (Season Total)</CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        Includes live games + imported history.{" "}
                        {groupInfield
                          ? "Infield = C + 1B/3B + 2B/SS."
                          : "C = Catcher, CIF = Corner IF (1B/3B), MIF = Middle IF (2B/SS), OF = Outfield, P = Pitcher"}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0 cursor-pointer">
                      <Checkbox
                        checked={groupInfield}
                        onCheckedChange={(v) => setGroupInfield(v === true)}
                        data-testid="checkbox-group-infield"
                      />
                      Group catcher + infield as "Infield"
                    </label>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Player</th>
                          <th className="text-center px-2 font-medium text-muted-foreground">Total Inn.</th>
                          {displayGroupOrder.map((g) => (
                            <th key={g} className="text-center px-2 font-medium text-muted-foreground">{GROUP_LABELS[g]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {playerStats
                          .filter((p) => p.combinedTotal > 0)
                          .sort((a, b) => b.combinedTotal - a.combinedTotal)
                          .map((p) => {
                            const groups = (p.groups as Record<string, number>) ?? {};
                            const groupPct = (p.groupPct as Record<string, number>) ?? {};
                            const getCount = (g: string) =>
                              g === "infield"
                                ? MERGED_INFIELD_PARTS.reduce((s, k) => s + (groups[k] ?? 0), 0)
                                : (groups[g] ?? 0);
                            const getPct = (g: string) =>
                              g === "infield"
                                ? MERGED_INFIELD_PARTS.reduce((s, k) => s + (groupPct[k] ?? 0), 0)
                                : (groupPct[g] ?? 0);
                            return (
                              <tr key={p.playerId} className="border-b border-border/50 hover:bg-muted/30">
                                <td className="py-2.5 pr-4">
                                  <div className="font-medium">{p.playerName}</div>
                                  {p.playerNumber != null && <div className="text-xs text-muted-foreground">#{p.playerNumber}</div>}
                                  {p.historicalTotal > 0 && <div className="text-xs text-blue-600">{p.historicalTotal} hist.</div>}
                                </td>
                                <td className="text-center px-2 font-mono">{p.combinedTotal}</td>
                                {displayGroupOrder.map((g) => {
                                  const count = getCount(g);
                                  const pct = getPct(g);
                                  return (
                                    <td key={g} className="text-center px-2" data-testid={`cell-${p.playerId}-${g}`}>
                                      {count > 0 ? (
                                        <div>
                                          <div className="font-mono text-sm">{count}</div>
                                          <PctBar pct={pct} color={GROUP_COLORS[g]} />
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground/40">—</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Bench time chart */}
              {benchData.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Bench vs. Field Innings (Season Total)</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={Math.max(160, benchData.length * 32)}>
                      <BarChart data={benchData} layout="vertical" margin={{ top: 5, right: 10, left: 50, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 12 }} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={65} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} formatter={(v: number) => [`${v} innings`]} />
                        <Bar dataKey="bench" name="Bench" fill="#e67e22" radius={[0, 4, 4, 0]} stackId="a" />
                        <Bar dataKey="field" name="Field" fill="#1e6b3c" radius={[0, 4, 4, 0]} stackId="a" />
                      </BarChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-muted-foreground mt-2">Orange = bench, Green = field</p>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card className="py-12">
              <CardContent className="text-center text-muted-foreground">
                <p>No fielding data yet. Generate and save lineups for games, or import past history.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Batting Tab */}
        <TabsContent value="batting" className="mt-4">
          <BattingTab players={players} />
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="mt-4">
          <HistoryTab players={players} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
