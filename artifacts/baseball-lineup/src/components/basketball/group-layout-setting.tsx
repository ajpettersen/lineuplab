import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";
import { GROUP_LAYOUT_IDS, GROUP_LAYOUTS, type GroupLayoutId } from "@/lib/basketball-rotation";
import { BASKETBALL_SETUP_KEY, fetchBasketballSetup, normalizeSetup, type BasketballSetup } from "@/lib/basketball-setup";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Settings → Rotation: how the five spots are grouped. Each player's role is
 * one of these groups, and subs only swap players within a group.
 */
export function GroupLayoutSetting({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: BASKETBALL_SETUP_KEY, queryFn: fetchBasketballSetup, select: normalizeSetup });
  const save = useMutation({
    mutationFn: async (groupLayout: GroupLayoutId) => {
      const r = await fetch(`${BASE}/api/basketball-rotation/group-layout`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupLayout }),
      });
      if (!r.ok) throw new Error(`Save failed (${r.status})`);
    },
    onMutate: (groupLayout) => {
      qc.setQueryData<BasketballSetup>(BASKETBALL_SETUP_KEY, (old) =>
        old ? { ...old, settings: { ...old.settings, groupLayout } } : old,
      );
    },
    onError: (err) => {
      toastError(toast, "Couldn't save the position groups", err);
      void qc.invalidateQueries({ queryKey: BASKETBALL_SETUP_KEY });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: BASKETBALL_SETUP_KEY }),
  });
  const current = data?.settings.groupLayout ?? "guards-front";

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Position groups</Label>
      <p className="text-xs text-muted-foreground">
        How your offense groups the five spots. Each player's role is one of these groups (set on the Bench Sheet),
        and subs always swap a player for someone in the same group.
      </p>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Position groups">
        {GROUP_LAYOUT_IDS.map((id) => {
          const layout = GROUP_LAYOUTS[id];
          const selected = current === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || !data || save.isPending}
              onClick={() => save.mutate(id)}
              className={`rounded-md border-2 p-3 text-left transition-colors disabled:opacity-60 ${selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}
            >
              <span className="block text-sm font-bold">{layout.label}</span>
              <span className="mt-1 flex flex-wrap gap-1">
                {layout.groups.map((g) => (
                  <span key={g.key} className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold">
                    {g.label} {g.spots.join("·")}
                  </span>
                ))}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{layout.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
