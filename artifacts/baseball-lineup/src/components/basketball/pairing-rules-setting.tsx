import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";
import { BASKETBALL_SETUP_KEY, fetchBasketballSetup, normalizeSetup, saveTeamRules } from "@/lib/basketball-setup";

type Draft = { kind: "never" | "one"; label: string; ids: string[] } | null;

/**
 * Settings → Rotation: pairing rules. "Never on court together" and "keep at
 * least one of these on court" (e.g. a ball-handler). The Bench Sheet, Set
 * Lineup and Rebalance follow them, and warn when a rule can't be met.
 */
export function PairingRulesSetting({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: BASKETBALL_SETUP_KEY, queryFn: fetchBasketballSetup, select: normalizeSetup });
  const [draft, setDraft] = useState<Draft>(null);
  const never = data?.rules.neverTogether ?? [];
  const atLeastOne = data?.rules.atLeastOne ?? [];
  const nameOf = (id: string) => data?.players.find((p) => String(p.id) === id)?.name ?? "?";
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof saveTeamRules>[0]) => saveTeamRules(patch),
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: BASKETBALL_SETUP_KEY });
    },
    onError: (err) => toastError(toast, "Couldn't save the pairing rule", err),
  });
  const addDraft = () => {
    if (!draft) return;
    if (draft.kind === "never") save.mutate({ neverTogether: [...never, draft.ids] });
    else save.mutate({ atLeastOne: [...atLeastOne, { label: draft.label.trim(), ids: draft.ids }] });
  };
  const draftOk = !!draft && (draft.kind === "never" ? draft.ids.length >= 2 && draft.ids.length <= 5 : draft.ids.length >= 1 && draft.label.trim().length > 0);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">Pairing rules</Label>
        <p className="text-xs text-muted-foreground">
          Players who shouldn't be on court together, and groups that need someone on court at all times (e.g. at least one ball-handler). The Bench Sheet, Set Lineup and Rebalance follow them and warn when one can't be met.
        </p>
      </div>
      {never.length === 0 && atLeastOne.length === 0 && !draft && <p className="text-sm text-muted-foreground">No pairing rules yet.</p>}
      <ul className="space-y-1.5">
        {never.map((ids, i) => (
          <li key={`n${i}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <span><span className="font-semibold">Never together:</span> {ids.map(nameOf).join(", ")}</span>
            <Button variant="ghost" size="icon" aria-label="Remove rule" disabled={disabled || save.isPending} onClick={() => save.mutate({ neverTogether: never.filter((_, j) => j !== i) })}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
        {atLeastOne.map((rule, i) => (
          <li key={`o${i}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <span><span className="font-semibold">At least one {rule.label}:</span> {rule.ids.map(nameOf).join(", ")}</span>
            <Button variant="ghost" size="icon" aria-label="Remove rule" disabled={disabled || save.isPending} onClick={() => save.mutate({ atLeastOne: atLeastOne.filter((_, j) => j !== i) })}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      {draft ? (
        <div className="space-y-2 rounded-md border-2 border-primary/40 p-3">
          <div className="text-sm font-semibold">{draft.kind === "never" ? "Never on court together (pick 2–5)" : "Keep at least one on court"}</div>
          {draft.kind === "one" && (
            <label className="block text-sm">
              <span className="font-medium">What they are</span>
              <Input value={draft.label} maxLength={40} placeholder="e.g. ball-handler" onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="mt-1 max-w-xs" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {(data?.players ?? []).map((p) => {
              const id = String(p.id);
              const on = draft.ids.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => setDraft({ ...draft, ids: on ? draft.ids.filter((x) => x !== id) : [...draft.ids, id] })}
                  className={`min-h-9 rounded-full border-2 px-3 text-sm font-semibold ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!draftOk || save.isPending} onClick={addDraft}>Add rule</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="gap-1" disabled={disabled || !data || never.length >= 20} onClick={() => setDraft({ kind: "never", label: "", ids: [] })}>
            <Plus className="h-4 w-4" /> Never together
          </Button>
          <Button size="sm" variant="outline" className="gap-1" disabled={disabled || !data || atLeastOne.length >= 10} onClick={() => setDraft({ kind: "one", label: "ball-handler", ids: [] })}>
            <Plus className="h-4 w-4" /> At least one on court
          </Button>
        </div>
      )}
    </div>
  );
}
