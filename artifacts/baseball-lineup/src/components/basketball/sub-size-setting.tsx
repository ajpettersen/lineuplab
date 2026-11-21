import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";
import { BASKETBALL_SETUP_KEY, fetchBasketballSetup, normalizeSetup, type BasketballSetup } from "@/lib/basketball-setup";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const CHOICES: { value: number | null; label: string }[] = [
  { value: null, label: "Ask each game" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5" },
];

/** Settings → Rotation: default subs at a time for new game lineups, or ask each time. */
export function SubSizeSetting({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: BASKETBALL_SETUP_KEY, queryFn: fetchBasketballSetup, select: normalizeSetup });
  const save = useMutation({
    mutationFn: async (defaultSubSize: number | null) => {
      const r = await fetch(`${BASE}/api/basketball-rotation/default-sub-size`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultSubSize }),
      });
      if (!r.ok) throw new Error(`Save failed (${r.status})`);
    },
    onMutate: (defaultSubSize) => {
      qc.setQueryData<BasketballSetup>(BASKETBALL_SETUP_KEY, (old) => (old ? { ...old, defaultSubSize } : old));
    },
    onError: (err) => {
      toastError(toast, "Couldn't save subs at a time", err);
      void qc.invalidateQueries({ queryKey: BASKETBALL_SETUP_KEY });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: BASKETBALL_SETUP_KEY }),
  });
  const current = data ? data.defaultSubSize : undefined;

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Subs at a time</Label>
      <p className="text-xs text-muted-foreground">
        How many players change each sub when you set a game's lineup. Pick a default, or have Set Lineup ask every time.
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Default subs at a time">
        {CHOICES.map((c) => (
          <button
            key={c.label}
            type="button"
            role="radio"
            aria-checked={current === c.value}
            disabled={disabled || current === undefined || save.isPending}
            onClick={() => save.mutate(c.value)}
            className={`min-h-10 rounded-md border-2 px-4 text-sm font-bold transition-colors disabled:opacity-60 ${
              current === c.value ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
