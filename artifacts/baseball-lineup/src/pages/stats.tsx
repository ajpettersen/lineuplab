import { useEffect, useRef, useState } from "react";
import { useGetSeasonStats, useGetPlayerStats, useListPlayers, useGetPreferences } from "@workspace/api-client-react";

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
import { BroadcastStatCard } from "@/components/broadcast-stat-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPlayerNameShort } from "@/lib/player-name";
import { Trash2, Download, Info, Sparkles, Send, User } from "lucide-react";
import { ScrollX } from "@/components/ui/scroll-x";
import { PlayerGameLogDialog } from "@/components/player-game-log-dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
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
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">Fairness Score</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="How is the Fairness Score calculated?"
                className="text-muted-foreground hover:text-foreground transition-colors"
                data-testid="tooltip-fairness-info-stats"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-left leading-relaxed">
              <p className="font-semibold mb-1">How this is calculated</p>
              <p>
                For every active player we compute their bench rate
                (innings sat ÷ innings played) across all completed
                games. The score is{" "}
                <span className="font-mono">100 − stddev × 400</span>,
                where stddev is the standard deviation of those bench
                rates (how much they vary). 100 means every player sits
                the same share of innings; the score drops quickly as
                bench time gets lopsided — a stddev of 20 percentage
                points lands near 20. Practices and uncompleted games
                don't count.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
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

// ---- Rotation Assistant ----
// Inline season-wide AI assistant scoped to rotation/playing-time questions.
// Reuses the same READ-ONLY tool-calling endpoint as the app-wide /ask page
// (POST /api/assistant) — that loop already exposes get_position_by_inning,
// which answers per-inning questions like "started the game on the bench"
// (position "Bench" in inning 1). No backend change needed.
type AssistantMessage = { role: "user" | "assistant"; content: string };

const ROTATION_SUGGESTIONS = [
  "How many innings has each player started the game on the bench?",
  "Who has sat on the bench the most this season?",
  "Has anyone never played the infield?",
  "Who has pitched the fewest innings?",
];

function RotationAssistantCard() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    const next: AssistantMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setLoading(true);
    const myRequestId = ++requestIdRef.current;
    try {
      // Bounded tail keeps the prompt within the server's 24-message cap.
      const resp = await fetch(`${BASE}/api/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-20) }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${resp.status})`);
      }
      const data = await resp.json();
      if (myRequestId !== requestIdRef.current) return;
      setMessages((prev) => [...prev, { role: "assistant", content: data.text }]);
    } catch (e) {
      if (myRequestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
    }
  }

  const empty = messages.length === 0;

  return (
    <Card data-testid="card-rotation-assistant">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Ask about the rotation
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          One-off questions about playing time and position history — e.g. who's
          started the most innings on the bench. Reads your completed games (plus
          imported history for season totals).
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {empty ? (
          <div className="flex flex-wrap gap-2">
            {ROTATION_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                disabled={loading}
                className="text-xs rounded-full border px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
                data-testid="rotation-assistant-suggestion"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="max-h-72 overflow-y-auto rounded-lg border bg-muted/20 p-3 space-y-3"
            data-testid="rotation-assistant-messages"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`rotation-assistant-message-${m.role}`}
              >
                {m.role === "assistant" && (
                  <div className="shrink-0 rounded-full bg-primary/10 p-1.5 h-fit">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={`rounded-2xl px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap max-w-[80%] ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-card text-foreground rounded-bl-sm border"
                  }`}
                >
                  {m.content}
                </div>
                {m.role === "user" && (
                  <div className="shrink-0 rounded-full bg-muted p-1.5 h-fit">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-2.5 justify-start" data-testid="rotation-assistant-loading">
                <div className="shrink-0 rounded-full bg-primary/10 p-1.5 h-fit">
                  <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                </div>
                <div className="rounded-2xl rounded-bl-sm bg-card border px-3.5 py-2 text-sm text-muted-foreground">
                  Thinking…
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" data-testid="rotation-assistant-error">
            {error}
          </p>
        )}

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask about playing time, bench innings, positions…"
            rows={1}
            disabled={loading}
            data-testid="input-rotation-assistant"
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-h-32"
          />
          <Button
            type="submit"
            size="icon"
            disabled={loading || !input.trim()}
            data-testid="button-rotation-assistant-send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---- History Import Tab ----
function HistoryTab({ players }: { players: { id: number; name: string; number?: number | null }[] }) {
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
            <ScrollX className="border rounded-md">
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
            </ScrollX>
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

// ---- Main Stats component ----
export default function Stats() {
  const { data: seasonStats } = useGetSeasonStats();
  // Default true so we don't flash-hide the card on first load before prefs
  // arrive — matches Dashboard treatment.
  const { data: prefs } = useGetPreferences();
  const showFairness = prefs?.showFairnessScore ?? true;
  const { data: rawPlayerStats = [] } = useGetPlayerStats();
  const playerStats = rawPlayerStats as unknown as ExtendedPlayerStats[];
  const { data: players = [] } = useListPlayers();
  const [groupInfield, setGroupInfield] = useState(true);
  // Pitcher can additionally be folded into the merged "Infield" column the
  // same way catcher is — only meaningful in merged mode. Off by default so
  // pitching stays its own column unless the coach opts in.
  const [groupPitcher, setGroupPitcher] = useState(false);
  // When pitcher is folded in, its innings join the infield bucket and the
  // standalone "Pitcher" column drops out of the merged order.
  const mergedInfieldParts: readonly string[] = groupPitcher
    ? ["pitcher", ...MERGED_INFIELD_PARTS]
    : MERGED_INFIELD_PARTS;
  const displayGroupOrder = groupInfield
    ? groupPitcher
      ? ["infield", "outfield", "bench"]
      : GROUP_ORDER_MERGED
    : GROUP_ORDER;
  // Click-through to per-player game log — same dialog used on Season Stats.
  const [logPlayerId, setLogPlayerId] = useState<number | null>(null);

  const benchData = playerStats
    .filter((p) => p.combinedTotal > 0)
    .map((p) => ({
      name: formatPlayerNameShort(p.playerName),
      bench: p.combinedBench,
      field: p.combinedTotal - p.combinedBench,
    }))
    .sort((a, b) => b.bench - a.bench);

  // Pre-compute each player's per-group count + percentage once so the
  // desktop table and the mobile card list render from the SAME numbers
  // (avoids the getCount/getPct logic drifting between two layouts).
  const fieldingRows = playerStats
    .filter((p) => p.combinedTotal > 0)
    .sort((a, b) => b.combinedTotal - a.combinedTotal)
    .map((p) => {
      const groups = (p.groups as Record<string, number>) ?? {};
      const groupPct = (p.groupPct as Record<string, number>) ?? {};
      const cells = displayGroupOrder.map((g) => {
        const count =
          g === "infield"
            ? mergedInfieldParts.reduce((s, k) => s + (groups[k] ?? 0), 0)
            : (groups[g] ?? 0);
        const pct =
          g === "infield"
            ? mergedInfieldParts.reduce((s, k) => s + (groupPct[k] ?? 0), 0)
            : (groupPct[g] ?? 0);
        return { g, count, pct };
      });
      return { p, cells };
    });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="eyebrow text-primary/70">Season Analytics</div>
        <h1 className="page-title text-foreground mt-1">Rotation Report</h1>
        <p className="text-muted-foreground mt-2 text-sm">Playing time, position fairness, and offensive stats</p>
      </div>

      {/* Summary Cards. Fairness card is gated on the user's Show Fairness
          Score preference; layout collapses cleanly to 2 columns when off. */}
      <div className={`grid gap-4 ${showFairness ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        <BroadcastStatCard
          label="Total Games"
          value={seasonStats?.totalGames ?? 0}
          subtext={`${seasonStats?.completedGames ?? 0} completed`}
        />
        <BroadcastStatCard
          label="Live Field Innings"
          value={seasonStats?.totalInnings ?? 0}
        />
        {showFairness && (
          <Card className="relative overflow-hidden border-border/80 broadcast-stripe" data-testid="card-fairness-bar">
            <CardContent className="p-5">
              <FairnessBar score={seasonStats?.fairnessScore ?? 0} />
            </CardContent>
          </Card>
        )}
      </div>

      <RotationAssistantCard />

      <Tabs defaultValue="fielding">
        <TabsList>
          <TabsTrigger value="fielding">Fielding Time</TabsTrigger>
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
                          ? groupPitcher
                            ? "Infield = P + C + 1B/3B + 2B/SS."
                            : "Infield = C + 1B/3B + 2B/SS."
                          : "C = Catcher, CIF = Corner IF (1B/3B), MIF = Middle IF (2B/SS), OF = Outfield, P = Pitcher"}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <Checkbox
                          checked={groupInfield}
                          onCheckedChange={(v) => setGroupInfield(v === true)}
                          data-testid="checkbox-group-infield"
                        />
                        Group catcher + infield as "Infield"
                      </label>
                      {groupInfield && (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                          <Checkbox
                            checked={groupPitcher}
                            onCheckedChange={(v) => setGroupPitcher(v === true)}
                            data-testid="checkbox-group-pitcher"
                          />
                          Include pitcher in "Infield"
                        </label>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Desktop / tablet: wide multi-column table. */}
                  <ScrollX className="hidden md:block">
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
                        {fieldingRows.map(({ p, cells }) => (
                          <tr key={p.playerId} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="py-2.5 pr-4">
                              <button
                                type="button"
                                onClick={() => setLogPlayerId(p.playerId)}
                                className="font-medium text-left hover:underline focus:underline focus:outline-none"
                                title="View game log"
                              >
                                {p.playerName}
                              </button>
                              {p.playerNumber != null && <div className="text-xs text-muted-foreground">#{p.playerNumber}</div>}
                              {p.historicalTotal > 0 && <div className="text-xs text-blue-600">{p.historicalTotal} hist.</div>}
                            </td>
                            <td className="text-center px-2 font-mono">{p.combinedTotal}</td>
                            {cells.map(({ g, count, pct }) => (
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
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollX>

                  {/* Mobile: per-player cards. Each position group is its own
                      aligned row — fixed-width label, flexible bar, then the
                      innings count and percentage in right-aligned mono
                      columns so the numbers line up cleanly down the card. */}
                  <div className="flex flex-col gap-3 md:hidden">
                    {fieldingRows.map(({ p, cells }) => (
                      <div
                        key={p.playerId}
                        className="rounded-lg border border-border/60 p-3"
                        data-testid={`card-fielding-${p.playerId}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setLogPlayerId(p.playerId)}
                              className="font-medium text-left hover:underline focus:underline focus:outline-none truncate"
                              title="View game log"
                            >
                              {p.playerName}
                            </button>
                            {p.playerNumber != null && <div className="text-xs text-muted-foreground">#{p.playerNumber}</div>}
                            {p.historicalTotal > 0 && <div className="text-xs text-blue-600">{p.historicalTotal} hist.</div>}
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono text-lg leading-none">{p.combinedTotal}</div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">Total Inn.</div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-col gap-2">
                          {cells.map(({ g, count, pct }) => (
                            <div key={g} className="flex items-center gap-2" data-testid={`cell-${p.playerId}-${g}`}>
                              <span className="w-16 shrink-0 text-xs text-muted-foreground">{GROUP_LABELS[g]}</span>
                              {count > 0 ? (
                                <>
                                  <div className="flex-1 bg-muted rounded-full h-2">
                                    <div
                                      className="h-2 rounded-full"
                                      style={{ width: `${pct}%`, backgroundColor: GROUP_COLORS[g] }}
                                    />
                                  </div>
                                  <span className="w-7 shrink-0 text-right font-mono text-xs">{count}</span>
                                  <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">{pct}%</span>
                                </>
                              ) : (
                                <>
                                  <div className="flex-1 bg-muted/40 rounded-full h-2" />
                                  <span className="w-7 shrink-0 text-right text-muted-foreground/40">—</span>
                                  <span className="w-10 shrink-0" />
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
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
                        <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} formatter={(v: number) => [`${v} innings`]} />
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

        {/* History Tab */}
        <TabsContent value="history" className="mt-4">
          <HistoryTab players={players} />
        </TabsContent>
      </Tabs>

      <PlayerGameLogDialog
        playerId={logPlayerId}
        open={logPlayerId != null}
        onOpenChange={(v) => !v && setLogPlayerId(null)}
      />
    </div>
  );
}
