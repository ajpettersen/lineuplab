import { useState } from "react";
import { useListPlayers } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// ---- Quick presets as UI toggles that create/remove DB constraints ----
function GlobalPresetsSection({ constraints, onRefresh }: { constraints: Constraint[]; onRefresh: () => void }) {
  const { toast } = useToast();

  const findGlobal = (type: string) => constraints.find((c) => c.type === type && c.active);

  const toggle = async (type: string, rule: string, value: number | null, description: string, enabled: boolean) => {
    const existing = constraints.find((c) => c.type === type);
    if (existing) {
      if (enabled) {
        // Update to active
        await apiPatch(`/api/constraints/${existing.id}`, { active: true });
      } else {
        await apiPatch(`/api/constraints/${existing.id}`, { active: false });
      }
    } else if (enabled) {
      await apiPost("/api/constraints", { type, rule, value, description, active: true });
    }
    onRefresh();
  };

  const updateValue = async (type: string, rule: string, value: number, description: string) => {
    const existing = constraints.find((c) => c.type === type);
    if (existing) {
      await apiDelete(`/api/constraints/${existing.id}`);
    }
    await apiPost("/api/constraints", { type, rule, value, description, active: true });
    onRefresh();
    toast({ title: `Updated: ${description}` });
  };

  const maxBench = findGlobal("global_max_bench");
  const maxPosition = findGlobal("global_max_position");
  const rotatePitcher = findGlobal("global_rotate_pitcher");
  const ensurePositions = findGlobal("global_ensure_positions");

  return (
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
            onCheckedChange={(v) => toggle("global_max_bench", "max", maxBench?.value ?? 2, `Max ${maxBench?.value ?? 2} bench innings per game`, v)}
          />
          <div className="flex-1">
            <Label className="font-medium">Max bench innings per game</Label>
            <p className="text-xs text-muted-foreground">Limits how many innings any player can sit on the bench</p>
            {maxBench && (
              <div className="mt-3 flex items-center gap-3">
                <Slider
                  value={[maxBench.value ?? 2]}
                  min={1} max={6} step={1}
                  className="w-40"
                  onValueChange={([v]) => updateValue("global_max_bench", "max", v, `Max ${v} bench innings per game`)}
                />
                <span className="text-sm font-mono font-bold w-8">{maxBench.value ?? 2}</span>
                <span className="text-xs text-muted-foreground">innings</span>
              </div>
            )}
          </div>
        </div>

        {/* Max same position */}
        <div className="flex items-start gap-4">
          <Switch
            checked={!!maxPosition}
            onCheckedChange={(v) => toggle("global_max_position", "max", maxPosition?.value ?? 2, `Max ${maxPosition?.value ?? 2} innings at same position`, v)}
          />
          <div className="flex-1">
            <Label className="font-medium">Max innings at the same position</Label>
            <p className="text-xs text-muted-foreground">Prevents a player from staying at the same spot all game</p>
            {maxPosition && (
              <div className="mt-3 flex items-center gap-3">
                <Slider
                  value={[maxPosition.value ?? 2]}
                  min={1} max={6} step={1}
                  className="w-40"
                  onValueChange={([v]) => updateValue("global_max_position", "max", v, `Max ${v} innings at same position`)}
                />
                <span className="text-sm font-mono font-bold w-8">{maxPosition.value ?? 2}</span>
                <span className="text-xs text-muted-foreground">innings</span>
              </div>
            )}
          </div>
        </div>

        {/* Ensure all positions */}
        <div className="flex items-start gap-4">
          <Switch
            checked={!!ensurePositions}
            onCheckedChange={(v) => toggle("global_ensure_positions", v ? "on" : "off", null, "All 9 positions covered each inning", v)}
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
            onCheckedChange={(v) => toggle("global_rotate_pitcher", v ? "on" : "off", null, "Rotate pitcher every inning", v)}
          />
          <div className="flex-1">
            <Label className="font-medium">Rotate pitcher every inning</Label>
            <p className="text-xs text-muted-foreground">Different pitcher each inning — no pitcher goes back-to-back</p>
          </div>
        </div>
      </CardContent>
    </Card>
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
  const [preview, setPreview] = useState<Omit<Constraint, "id" | "createdAt" | "active"> | null>(null);
  const [saving, setSaving] = useState(false);

  const handleParse = async () => {
    if (!input.trim()) return;
    setParsing(true);
    setPreview(null);
    try {
      const result = await apiPost("/api/constraints/parse", { input: input.trim() });
      setPreview(result);
    } catch {
      toast({ title: "Could not interpret rule", variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      await apiPost("/api/constraints", { ...preview, active: true });
      onAdd();
      toast({ title: "Rule saved" });
      setInput("");
      setPreview(null);
    } catch {
      toast({ title: "Failed to save rule", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Describe a Rule
        </CardTitle>
        <p className="text-xs text-muted-foreground">Type any rule in plain English — the AI will interpret it</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleParse()}
            placeholder="e.g. Jake can't pitch, Make sure everyone plays infield at least once, Max 2 bench innings..."
            className="flex-1"
          />
          <Button onClick={handleParse} disabled={parsing || !input.trim()} className="shrink-0">
            {parsing ? "Thinking..." : "Interpret"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {["Max 2 innings on bench", "Rotate pitcher every inning", "Everyone plays at least 1 field inning", "No one plays the same position twice"].map((ex) => (
            <button
              key={ex}
              onClick={() => setInput(ex)}
              className="text-xs px-2.5 py-1 rounded-full border border-border/50 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>

        {preview && (
          <div className="flex flex-col gap-3 p-4 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex items-start gap-2">
              <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">"{preview.description}"</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <Badge variant="secondary" className="text-xs">{TYPE_LABELS[preview.type] ?? preview.type}</Badge>
                  {preview.playerName && <Badge variant="outline" className="text-xs">{preview.playerName}</Badge>}
                  {preview.position && <Badge variant="outline" className="text-xs">{preview.position}</Badge>}
                  {preview.value != null && <Badge variant="outline" className="text-xs">value: {preview.value}</Badge>}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save This Rule"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPreview(null)}>Discard</Button>
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
