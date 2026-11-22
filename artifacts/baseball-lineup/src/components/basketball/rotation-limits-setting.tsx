import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";
import { DEFAULT_REBALANCE_RULES } from "@/lib/basketball-rebalance";
import { BASKETBALL_SETUP_KEY, fetchBasketballSetup, normalizeSetup, rebalanceRules, saveTeamRules, type TeamRules } from "@/lib/basketball-setup";

type MinuteKey = "maxOnSec" | "maxBenchSec" | "minShareGapSec";
const FIELDS: { key: MinuteKey; label: string; help: string; min: number; max: number }[] = [
  { key: "maxOnSec", label: "Max minutes on court in a row", help: "Then they get a rest.", min: 1, max: 40 },
  { key: "maxBenchSec", label: "Max minutes on the bench in a row", help: "Then they go back in.", min: 1, max: 40 },
  { key: "minShareGapSec", label: "Minimum minutes: equal share minus", help: "e.g. 4 = nobody ends more than 4 min under an even split.", min: 0, max: 40 },
];

/**
 * Settings → Rotation: the limits "Rebalance rest of game" plans within
 * (and the planner and Bench Sheet use as they grow into them).
 */
export function RotationLimitsSetting({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: BASKETBALL_SETUP_KEY, queryFn: fetchBasketballSetup, select: normalizeSetup });
  const rules = rebalanceRules(data?.rules);
  const [draft, setDraft] = useState<Record<MinuteKey, string>>({ maxOnSec: "", maxBenchSec: "", minShareGapSec: "" });
  useEffect(() => {
    if (!data) return;
    setDraft({
      maxOnSec: String(rules.maxOnSec / 60),
      maxBenchSec: String(rules.maxBenchSec / 60),
      minShareGapSec: String(rules.minShareGapSec / 60),
    });
    // Only when the saved values change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.rules]);
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof saveTeamRules>[0]) => saveTeamRules(patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: BASKETBALL_SETUP_KEY }),
    onError: (err) => {
      toastError(toast, "Couldn't save the rotation limits", err);
      void qc.invalidateQueries({ queryKey: BASKETBALL_SETUP_KEY });
    },
  });
  const commit = (key: MinuteKey, f: (typeof FIELDS)[number]) => {
    const n = Number(draft[key]);
    if (!Number.isFinite(n) || n < f.min || n > f.max) {
      setDraft((d) => ({ ...d, [key]: String(rules[key] / 60) }));
      return;
    }
    const sec = Math.round(n * 60);
    if (sec === rules[key]) return;
    // Back to the default = remove the saved value.
    save.mutate({ [key]: sec === DEFAULT_REBALANCE_RULES[key] ? null : sec } as Partial<TeamRules>);
  };

  return (
    <div className="space-y-6">
    <GameFormatSetting disabled={disabled} />
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">Rotation limits</Label>
        <p className="text-xs text-muted-foreground">
          Used when you tap Rebalance rest of game on the court display after subs the plan didn't call for.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="font-medium">{f.label}</span>
            <Input
              type="number"
              inputMode="decimal"
              min={f.min}
              max={f.max}
              step={0.5}
              disabled={disabled || !data || save.isPending}
              value={draft[f.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              onBlur={() => commit(f.key, f)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="mt-1 w-24"
            />
            <span className="mt-1 block text-xs text-muted-foreground">{f.help}</span>
          </label>
        ))}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={rules.keepGroupBalance}
          disabled={disabled || !data || save.isPending}
          onCheckedChange={(v) => save.mutate({ keepGroupBalance: v === true ? null : false })}
        />
        Keep the position-group balance on court (e.g. 2 guards + 3 front)
      </label>
    </div>
    </div>
  );
}

/**
 * Settings → Rotation: halves or quarters, and how long each one is. The
 * court display, Bench Sheet, shifts and team-foul resets follow it.
 */
function GameFormatSetting({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: BASKETBALL_SETUP_KEY, queryFn: fetchBasketballSetup, select: normalizeSetup });
  const periods = data?.settings.periods === 4 ? 4 : 2;
  const length = data?.settings.halfMinutes ?? 20;
  const [minutes, setMinutes] = useState("");
  useEffect(() => {
    if (data) setMinutes(String(length));
  }, [data, length]);
  const save = useMutation({
    mutationFn: (format: { periods: 2 | 4; periodMinutes: number }) => saveTeamRules({ format }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: BASKETBALL_SETUP_KEY }),
    onError: (err) => {
      toastError(toast, "Couldn't save the game format", err);
      void qc.invalidateQueries({ queryKey: BASKETBALL_SETUP_KEY });
    },
  });
  const choose = (next: 2 | 4) => {
    if (next === periods) return;
    // Keep the game about the same length: 2 × 16 ↔ 4 × 8.
    const periodMinutes = Math.max(1, Math.round(((length * periods) / next) * 2) / 2);
    save.mutate({ periods: next, periodMinutes });
  };
  const commitLength = () => {
    const n = Number(minutes);
    if (!Number.isFinite(n) || n < 1 || n > 30) {
      setMinutes(String(length));
      return;
    }
    if (n !== length) save.mutate({ periods: periods as 2 | 4, periodMinutes: n });
  };
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Game format</Label>
      <p className="text-xs text-muted-foreground">
        Halves or quarters. The court display, Bench Sheet, shifts and team-foul resets follow it (quarters: team fouls reset each quarter, bonus from the 5th).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2" role="radiogroup" aria-label="Halves or quarters">
          {([2, 4] as const).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={periods === n}
              disabled={disabled || !data || save.isPending}
              onClick={() => choose(n)}
              className={`min-h-10 rounded-md border-2 px-4 text-sm font-bold transition-colors disabled:opacity-60 ${
                periods === n ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
              }`}
            >
              {n === 2 ? "Halves" : "Quarters"}
            </button>
          ))}
        </div>
        <label className="block text-sm">
          <span className="font-medium">{periods === 4 ? "Quarter" : "Half"} length (min)</span>
          <Input
            type="number"
            inputMode="decimal"
            min={1}
            max={30}
            step={0.5}
            disabled={disabled || !data || save.isPending}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onBlur={commitLength}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="mt-1 w-24"
          />
        </label>
        <span className="pb-2 text-xs text-muted-foreground">{periods} × {length} min = {periods * length} min game</span>
      </div>
    </div>
  );
}
