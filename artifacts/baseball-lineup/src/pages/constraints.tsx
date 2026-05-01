import { useEffect, useRef, useState } from "react";
import { useListPlayers } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus, Sparkles, Info, Check, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

interface Constraint {
  id: number;
  type: string;
  playerId: number | null;
  playerName: string | null;
  position: string | null;
  rule: string;
  value: number | null;
  description: string;
  aiInput: string | null;
  active: boolean;
  createdAt: string;
}

const CONSTRAINT_CATEGORY: Record<string, string> = {
  global_max_bench: "global",
  global_max_position: "global",
  global_min_field: "global",
  global_rotate_pitcher: "global",
  global_ensure_positions: "global",
  global_no_bench_two_of_three: "global",
  global_equity_weight: "global",
  player_must_play: "player",
  player_cannot_play: "player",
  player_min_field: "player",
  player_bench_first: "player",
  player_bench_last: "player",
  ai_parsed: "ai",
};

const TYPE_LABELS: Record<string, string> = {
  global_max_bench: "Max bench innings",
  global_max_position: "Max same position",
  global_min_field: "Min field innings",
  global_rotate_pitcher: "Rotate pitcher",
  global_ensure_positions: "All positions covered",
  global_no_bench_two_of_three: "No bench 2 of 3 innings",
  global_equity_weight: "Fairness dial",
  player_must_play: "Must play position",
  player_cannot_play: "Cannot play position",
  player_min_field: "Min field innings",
  player_bench_first: "Bench first inning",
  player_bench_last: "Bench last inning",
  ai_parsed: "AI rule",
};

function useConstraints() {
  return useQuery<Constraint[]>({
    queryKey: ["constraints"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/constraints`);
      return r.json();
    },
  });
}

async function apiPost(path: string, body: object) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function apiPatch(path: string, body: object) {
  const r = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function apiDelete(path: string) {
  await fetch(`${BASE}${path}`, { method: "DELETE" });
}

// ---- Dialog asking for a numeric value ----
function ValuePromptDialog({
  open,
  title,
  unit,
  defaultValue,
  min,
  max,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  unit: string;
  defaultValue: number;
  min: number;
  max: number;
  onCancel: () => void;
  onConfirm: (value: number) => void;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center gap-4">
            <Slider
              value={[value]}
              min={min} max={max} step={1}
              className="flex-1"
              onValueChange={([v]) => setValue(v)}
            />
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold font-mono w-10 text-center">{value}</span>
              <span className="text-sm text-muted-foreground">{unit}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(value)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Fairness dial: 0 = best lineup, 50 = balanced, 100 = most equitable ----
function FairnessSection({ constraints, onRefresh }: { constraints: Constraint[]; onRefresh: () => void }) {
  // Pick the most recently created active row in case duplicates exist (defensive).
  const existing = [...constraints]
    .filter((c) => c.type === "global_equity_weight" && c.active)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const initial = existing?.value ?? 50;
  const [value, setValue] = useState(initial);

  // Serialize commits so rapid slider drags don't race (each commit had been
  // reading a stale snapshot of `constraints`, leaking duplicate rows).
  const pendingRef = useRef<Promise<void>>(Promise.resolve());
  // Track in-flight commits so we don't clobber the user's drag with a stale
  // refetch while a save is pending.
  const inFlightRef = useRef(0);

  // Sync the slider once the constraint list arrives (or when another tab edits
  // it), but never while we have an unsaved commit pending.
  useEffect(() => {
    if (inFlightRef.current === 0 && existing?.value != null && existing.value !== value) {
      setValue(existing.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.value]);

  const persist = (v: number) => {
    const description = v <= 25
      ? `Generator favors best lineup (fairness ${v}/100)`
      : v >= 75
        ? `Generator favors equal playing time (fairness ${v}/100)`
        : `Balanced lineup vs fairness (${v}/100)`;
    inFlightRef.current += 1;
    pendingRef.current = pendingRef.current
      .catch(() => undefined)
      .then(async () => {
        // Always re-fetch the live list and remove ALL rows of this type before
        // inserting a fresh one. Single-row invariant.
        const resp = await fetch(`${BASE}/api/constraints`);
        const all: Constraint[] = await resp.json();
        const stale = all.filter((c) => c.type === "global_equity_weight");
        await Promise.all(stale.map((c) => apiDelete(`/api/constraints/${c.id}`)));
        await apiPost("/api/constraints", {
          type: "global_equity_weight",
          rule: "weight",
          value: v,
          description,
          active: true,
        });
      })
      .finally(() => {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        if (inFlightRef.current === 0) onRefresh();
      });
  };

  const label =
    value <= 20 ? "Best lineup" :
    value <= 40 ? "Lean toward best" :
    value <= 60 ? "Balanced" :
    value <= 80 ? "Lean toward fair" :
    "Most equitable";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Fairness Dial
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Decide how strongly the generator should equalize playing time. Lower values keep
          stronger players in their preferred spots; higher values rotate everyone evenly.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Best lineup</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-primary" data-testid="text-equity-value">{value}</span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground" data-testid="text-equity-label">{label}</span>
          </div>
          <span className="text-sm text-muted-foreground">Most equitable</span>
        </div>
        <Slider
          value={[value]}
          min={0}
          max={100}
          step={5}
          onValueChange={([v]) => setValue(v)}
          onValueCommit={([v]) => persist(v)}
          data-testid="slider-equity"
        />
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Default is 50 (balanced). Players still keep their eligible/preferred positions and
            other rules (max bench, no bench 2-of-3, etc.) are always enforced regardless of this dial.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Quick presets as UI toggles that create/remove DB constraints ----
function GlobalPresetsSection({ constraints, onRefresh }: { constraints: Constraint[]; onRefresh: () => void }) {
  const { toast } = useToast();
  const [valuePrompt, setValuePrompt] = useState<{
    type: string;
    title: string;
    descTemplate: (v: number) => string;
    defaultValue: number;
  } | null>(null);

  const findGlobal = (type: string) => constraints.find((c) => c.type === type && c.active);

  // For boolean-only toggles
  const toggleBoolean = async (type: string, description: string, enabled: boolean) => {
    const existing = constraints.find((c) => c.type === type);
    if (existing) {
      await apiPatch(`/api/constraints/${existing.id}`, { active: enabled });
    } else if (enabled) {
      await apiPost("/api/constraints", { type, rule: "on", value: null, description, active: true });
    }
    onRefresh();
  };

  // For numeric toggles — opens dialog when turning on, just deactivates when turning off
  const toggleNumeric = async (
    type: string,
    title: string,
    descTemplate: (v: number) => string,
    defaultValue: number,
    newState: boolean
  ) => {
    const existing = constraints.find((c) => c.type === type);
    const wasActive = !!existing?.active;
    // Already in desired state — no-op (guards against duplicate fires)
    if (wasActive === newState) return;

    if (!newState) {
      // Turning off — just deactivate, no dialog
      if (existing) {
        await apiPatch(`/api/constraints/${existing.id}`, { active: false });
        onRefresh();
      }
      return;
    }
    // Turning on — open dialog to ask the number
    setValuePrompt({ type, title, descTemplate, defaultValue: existing?.value ?? defaultValue });
  };

  const handleValueConfirm = async (value: number) => {
    if (!valuePrompt) return;
    const { type, descTemplate } = valuePrompt;
    const existing = constraints.find((c) => c.type === type);
    if (existing) await apiDelete(`/api/constraints/${existing.id}`);
    await apiPost("/api/constraints", {
      type,
      rule: "max",
      value,
      description: descTemplate(value),
      active: true,
    });
    toast({ title: descTemplate(value) });
    setValuePrompt(null);
    onRefresh();
  };

  // Edit existing numeric value
  const editNumeric = (
    type: string,
    title: string,
    descTemplate: (v: number) => string,
    currentValue: number
  ) => {
    setValuePrompt({ type, title, descTemplate, defaultValue: currentValue });
  };

  const maxBench = findGlobal("global_max_bench");
  const maxPosition = findGlobal("global_max_position");
  const rotatePitcher = findGlobal("global_rotate_pitcher");
  const ensurePositions = findGlobal("global_ensure_positions");
  const noBenchTwoOfThree = findGlobal("global_no_bench_two_of_three");

  const benchDescTemplate = (v: number) => `Max ${v} bench innings per game`;
  const positionDescTemplate = (v: number) => `Max ${v} innings at same position`;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Global Rules
          </CardTitle>
          <p className="text-xs text-muted-foreground">Applied automatically to every lineup you generate</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* Max bench innings */}
          <div className="flex items-start gap-4">
            <Switch
              checked={!!maxBench}
              onCheckedChange={(v) => toggleNumeric("global_max_bench", "How many max bench innings?", benchDescTemplate, 2, v)}
            />
            <div className="flex-1">
              <Label className="font-medium">Max bench innings per game</Label>
              <p className="text-xs text-muted-foreground">Limits how many innings any player can sit on the bench</p>
              {maxBench && (
                <button
                  onClick={() => editNumeric("global_max_bench", "How many max bench innings?", benchDescTemplate, maxBench.value ?? 2)}
                  className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
                >
                  {maxBench.value} innings · edit
                </button>
              )}
            </div>
          </div>

          {/* Max same position */}
          <div className="flex items-start gap-4">
            <Switch
              checked={!!maxPosition}
              onCheckedChange={(v) => toggleNumeric("global_max_position", "Max innings at same position?", positionDescTemplate, 2, v)}
            />
            <div className="flex-1">
              <Label className="font-medium">Max innings at the same position</Label>
              <p className="text-xs text-muted-foreground">Prevents a player from staying at the same spot all game</p>
              {maxPosition && (
                <button
                  onClick={() => editNumeric("global_max_position", "Max innings at same position?", positionDescTemplate, maxPosition.value ?? 2)}
                  className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
                >
                  {maxPosition.value} innings · edit
                </button>
              )}
            </div>
          </div>

          {/* No bench 2 out of 3 */}
          <div className="flex items-start gap-4">
            <Switch
              checked={!!noBenchTwoOfThree}
              onCheckedChange={(v) => toggleBoolean("global_no_bench_two_of_three", "No player benched 2 out of any 3 innings", v)}
            />
            <div className="flex-1">
              <Label className="font-medium">No bench 2 out of 3 innings</Label>
              <p className="text-xs text-muted-foreground">No player should sit on the bench more than once in any 3-inning stretch</p>
            </div>
          </div>

          {/* Ensure all positions */}
          <div className="flex items-start gap-4">
            <Switch
              checked={!!ensurePositions}
              onCheckedChange={(v) => toggleBoolean("global_ensure_positions", "All 9 positions covered each inning", v)}
            />
            <div className="flex-1">
              <Label className="font-medium">All 9 positions covered each inning</Label>
              <p className="text-xs text-muted-foreground">Every defensive position is filled every inning</p>
            </div>
          </div>

          {/* Rotate pitcher */}
          <div className="flex items-start gap-4">
            <Switch
              checked={!!rotatePitcher}
              onCheckedChange={(v) => toggleBoolean("global_rotate_pitcher", "Rotate pitcher every inning", v)}
            />
            <div className="flex-1">
              <Label className="font-medium">Rotate pitcher every inning</Label>
              <p className="text-xs text-muted-foreground">Different pitcher each inning — no pitcher goes back-to-back</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {valuePrompt && (
        <ValuePromptDialog
          key={valuePrompt.type + valuePrompt.defaultValue}
          open={true}
          title={valuePrompt.title}
          unit="innings"
          defaultValue={valuePrompt.defaultValue}
          min={1}
          max={6}
          onCancel={() => setValuePrompt(null)}
          onConfirm={handleValueConfirm}
        />
      )}
    </>
  );
}

// ---- Add player-specific rule form ----
function AddPlayerRuleForm({
  players,
  onAdd,
}: {
  players: { id: number; name: string; number: number | null; eligiblePositions: string[] }[];
  onAdd: () => void;
}) {
  const { toast } = useToast();
  const [playerId, setPlayerId] = useState<string>("");
  const [ruleType, setRuleType] = useState<string>("player_cannot_play");
  const [position, setPosition] = useState<string>("");
  const [value, setValue] = useState("1");
  const [saving, setSaving] = useState(false);

  const needsPosition = ["player_must_play", "player_cannot_play"].includes(ruleType);
  const needsValue = ["player_min_field"].includes(ruleType);

  const buildDescription = () => {
    const p = players.find((pl) => pl.id === parseInt(playerId));
    const name = p?.name ?? "Player";
    if (ruleType === "player_must_play") return `${name} must play ${position}`;
    if (ruleType === "player_cannot_play") return `${name} cannot play ${position}`;
    if (ruleType === "player_min_field") return `${name} must play at least ${value} field inning(s)`;
    if (ruleType === "player_bench_first") return `${name} sits bench in inning 1`;
    if (ruleType === "player_bench_last") return `${name} sits bench in the last inning`;
    return "";
  };

  const handleAdd = async () => {
    if (!playerId) { toast({ title: "Select a player", variant: "destructive" }); return; }
    if (needsPosition && !position) { toast({ title: "Select a position", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await apiPost("/api/constraints", {
        type: ruleType,
        playerId: parseInt(playerId),
        position: needsPosition ? position : null,
        rule: ruleType.includes("cannot") ? "must_not" : ruleType.includes("bench_first") ? "first" : ruleType.includes("bench_last") ? "last" : "must",
        value: needsValue ? parseInt(value) : null,
        description: buildDescription(),
      });
      onAdd();
      toast({ title: "Rule added" });
      setPlayerId("");
      setPosition("");
    } catch {
      toast({ title: "Failed to add rule", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-3 items-end p-4 bg-muted/30 rounded-lg border border-border/50">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Player</Label>
        <Select value={playerId} onValueChange={setPlayerId}>
          <SelectTrigger className="w-40 h-8 text-sm">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {players.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}{p.number != null ? ` #${p.number}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Rule</Label>
        <Select value={ruleType} onValueChange={setRuleType}>
          <SelectTrigger className="w-52 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="player_cannot_play">Cannot play position</SelectItem>
            <SelectItem value="player_must_play">Must play position</SelectItem>
            <SelectItem value="player_min_field">Min field innings</SelectItem>
            <SelectItem value="player_bench_first">Bench in inning 1</SelectItem>
            <SelectItem value="player_bench_last">Bench in last inning</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {needsPosition && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Position</Label>
          <Select value={position} onValueChange={setPosition}>
            <SelectTrigger className="w-24 h-8 text-sm">
              <SelectValue placeholder="Pos..." />
            </SelectTrigger>
            <SelectContent>
              {POSITIONS.map((pos) => (
                <SelectItem key={pos} value={pos}>{pos}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {needsValue && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Min innings</Label>
          <Input
            type="number"
            min="1"
            max="6"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-20 h-8 text-sm"
          />
        </div>
      )}

      <Button size="sm" className="h-8" onClick={handleAdd} disabled={saving}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add Rule
      </Button>
    </div>
  );
}

// ---- AI input section ----
function AiRuleInput({ players, onAdd }: { players: { id: number; name: string }[]; onAdd: () => void }) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [previews, setPreviews] = useState<Omit<Constraint, "id" | "createdAt" | "active">[]>([]);
  const [saving, setSaving] = useState(false);

  const handleParse = async () => {
    if (!input.trim()) return;
    setParsing(true);
    setPreviews([]);
    try {
      const result = await apiPost("/api/constraints/parse", { input: input.trim() });
      const list: Omit<Constraint, "id" | "createdAt" | "active">[] = Array.isArray(result?.constraints)
        ? result.constraints
        : Array.isArray(result)
          ? result
          : result && typeof result === "object" && "type" in result
            ? [result]
            : [];
      if (list.length === 0) {
        toast({ title: "Could not interpret rule", variant: "destructive" });
      } else {
        setPreviews(list);
      }
    } catch {
      toast({ title: "Could not interpret rule", variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const handleSaveAll = async () => {
    if (previews.length === 0) return;
    setSaving(true);
    const failedIndices: number[] = [];
    try {
      for (let i = 0; i < previews.length; i++) {
        const p = previews[i];
        try {
          const r = await fetch(`${BASE}/api/constraints`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...p, active: true }),
          });
          if (!r.ok) {
            failedIndices.push(i);
          }
        } catch {
          failedIndices.push(i);
        }
      }
      const saved = previews.length - failedIndices.length;
      const failed = failedIndices.length;
      if (saved > 0) onAdd();
      if (failed === 0) {
        toast({ title: saved === 1 ? "Rule saved" : `${saved} rules saved` });
        setInput("");
        setPreviews([]);
      } else if (saved > 0) {
        toast({
          title: `Saved ${saved}, ${failed} failed`,
          description: "The failed rules are still listed below — try again or remove them.",
          variant: "destructive",
        });
        setPreviews((prev) => failedIndices.map((idx) => prev[idx]));
      } else {
        toast({ title: "Failed to save rules", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardOne = (idx: number) => {
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Describe Rules
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Type one or more rules in plain English — the AI will interpret each one. Separate rules with periods, new lines, or "and".
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleParse();
              }
            }}
            placeholder={"e.g. Jake can't pitch.\nMake sure everyone plays infield at least once.\nMax 2 bench innings."}
            className="flex-1 min-h-[88px]"
          />
          <Button onClick={handleParse} disabled={parsing || !input.trim()} className="shrink-0 sm:self-start">
            {parsing ? "Thinking..." : "Interpret"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {["Max 2 innings on bench", "Rotate pitcher every inning", "Everyone plays at least 1 field inning", "No one plays the same position twice"].map((ex) => (
            <button
              key={ex}
              onClick={() => setInput((prev) => (prev.trim() ? `${prev.trim()}\n${ex}` : ex))}
              className="text-xs px-2.5 py-1 rounded-full border border-border/50 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
            >
              + {ex}
            </button>
          ))}
        </div>

        {previews.length > 0 && (
          <div className="flex flex-col gap-3 p-4 bg-primary/5 border border-primary/20 rounded-lg">
            <p className="text-xs font-medium text-muted-foreground">
              {previews.length === 1 ? "Interpreted 1 rule" : `Interpreted ${previews.length} rules`}
            </p>
            <div className="flex flex-col gap-2">
              {previews.map((preview, idx) => (
                <div key={idx} className="flex items-start gap-2 p-3 rounded-md border border-border/50 bg-background/60">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">"{preview.description}"</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <Badge variant="secondary" className="text-xs">{TYPE_LABELS[preview.type] ?? preview.type}</Badge>
                      {preview.playerName && <Badge variant="outline" className="text-xs">{preview.playerName}</Badge>}
                      {preview.position && <Badge variant="outline" className="text-xs">{preview.position}</Badge>}
                      {preview.value != null && <Badge variant="outline" className="text-xs">value: {preview.value}</Badge>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => handleDiscardOne(idx)} className="shrink-0 h-7 px-2 text-xs">
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveAll} disabled={saving}>
                {saving
                  ? "Saving..."
                  : previews.length === 1
                    ? "Save Rule"
                    : `Save All ${previews.length} Rules`}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPreviews([])} disabled={saving}>
                Discard All
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Main page ----
export default function Constraints() {
  const qc = useQueryClient();
  const { data: constraints = [] } = useConstraints();
  const { data: players = [] } = useListPlayers();
  const { toast } = useToast();

  const refresh = () => qc.invalidateQueries({ queryKey: ["constraints"] });

  const deleteConstraint = async (id: number) => {
    await apiDelete(`/api/constraints/${id}`);
    refresh();
    toast({ title: "Rule removed" });
  };

  const toggleConstraint = async (id: number, active: boolean) => {
    await apiPatch(`/api/constraints/${id}`, { active });
    refresh();
  };

  const playerConstraints = constraints.filter((c) => CONSTRAINT_CATEGORY[c.type] === "player");
  const aiConstraints = constraints.filter((c) => CONSTRAINT_CATEGORY[c.type] === "ai");

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">Lineup Constraints</h1>
        <p className="text-muted-foreground mt-1">Rules applied automatically whenever you generate a lineup</p>
      </div>

      {/* Fairness dial */}
      <FairnessSection constraints={constraints} onRefresh={refresh} />

      {/* Global presets */}
      <GlobalPresetsSection constraints={constraints} onRefresh={refresh} />

      {/* Player-specific rules */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            Player-Specific Rules
          </CardTitle>
          <p className="text-xs text-muted-foreground">Position restrictions and playing time rules for individual players</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AddPlayerRuleForm players={players} onAdd={refresh} />

          {playerConstraints.length > 0 ? (
            <div className="flex flex-col gap-2">
              {playerConstraints.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${c.active ? "border-border bg-background" : "border-border/40 bg-muted/20 opacity-60"}`}
                >
                  <Switch
                    checked={c.active}
                    onCheckedChange={(v) => toggleConstraint(c.id, v)}
                    className="shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{c.description}</p>
                    <div className="flex gap-1.5 mt-0.5">
                      <Badge variant="secondary" className="text-xs">{TYPE_LABELS[c.type] ?? c.type}</Badge>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
                    onClick={() => deleteConstraint(c.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-3">No player rules yet</p>
          )}
        </CardContent>
      </Card>

      {/* AI rule input */}
      <AiRuleInput players={players} onAdd={refresh} />

      {/* AI-parsed rules list */}
      {aiConstraints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI-Interpreted Rules
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {aiConstraints.map((c) => (
              <div
                key={c.id}
                className={`flex items-center gap-3 p-3 rounded-lg border ${c.active ? "border-border" : "border-border/40 bg-muted/20 opacity-60"}`}
              >
                <Switch checked={c.active} onCheckedChange={(v) => toggleConstraint(c.id, v)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{c.description}</p>
                  {c.aiInput && <p className="text-xs text-muted-foreground italic mt-0.5">"{c.aiInput}"</p>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => deleteConstraint(c.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Hint */}
      <div className="flex items-start gap-2 p-3 bg-muted/40 rounded-lg text-sm text-muted-foreground border border-border/50">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <p>All active rules here are applied automatically when you generate a lineup from the Schedule page. Toggle any rule off to exclude it temporarily without deleting it.</p>
      </div>
    </div>
  );
}
