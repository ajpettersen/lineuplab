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
  );
}
