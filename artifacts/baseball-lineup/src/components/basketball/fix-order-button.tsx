import { useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RotationInput } from "@/lib/basketball-rotation";
import { hasPairingRules } from "@/lib/basketball-pairing";
import { fixOrderForRules, orderViolations } from "@/lib/basketball-pairing-fix";

/**
 * Set Lineup / Bench Sheet: when this starting order breaks a pairing rule,
 * offer to find one that doesn't (and say so plainly if none exists).
 */
export function FixOrderForRules({ input, onOrder, disabled }: { input: RotationInput; onOrder: (order: string[]) => void; disabled?: boolean }) {
  const [result, setResult] = useState<string | null>(null);
  const breaks = useMemo(() => (hasPairingRules(input.pairing) ? orderViolations(input) : 0), [input]);
  if (!hasPairingRules(input.pairing) || (breaks === 0 && !result)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {breaks > 0 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={disabled}
          onClick={() => {
            const fixed = fixOrderForRules(input);
            if (fixed.after < fixed.before) onOrder(fixed.order);
            setResult(
              fixed.after === 0
                ? "Reordered: every shift now follows your pairing rules."
                : fixed.after < fixed.before
                  ? `Reordered: ${fixed.after} shift${fixed.after === 1 ? "" : "s"} still break a rule. With this rotation it can't be fully met (e.g. 5 front players sharing 3 spots always overlap); Rebalance on the court display can keep them apart.`
                  : "No starting order meets these pairing rules with this rotation. Rebalance on the court display can, within your limits.",
            );
          }}
        >
          <Wrench className="h-4 w-4" /> Fix order for rules
        </Button>
      )}
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
    </div>
  );
}
