import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Sparkles } from "lucide-react";
import { STANDARD_REST_TIERS, type RestTier } from "@/lib/pitch-rulesets";

type Props = {
  /** Null = no tiers configured (show empty state + Add button). */
  value: RestTier[] | null;
  onChange: (next: RestTier[] | null) => void;
  disabled?: boolean;
  /** Test-id prefix so multiple editors on a page get unique selectors. */
  testIdPrefix?: string;
  /** Optional placeholder text when value is null. */
  placeholder?: string;
};

/**
 * Editable rest-tier table. Each row is a `pitches ≤ X → Y days rest`
 * mapping; the coach can add/remove rows freely + load the standard
 * Little League ladder with one click.
 *
 * Sorting is the coach's responsibility — we render in array order so
 * they see exactly what they typed. The server-side resolver iterates
 * tiers in array order too, so the UI display matches the math.
 */
export function RestTiersEditor({
  value,
  onChange,
  disabled,
  testIdPrefix = "rest-tier",
  placeholder = "No rest tiers — add one below or load the standard ladder.",
}: Props) {
  const tiers = value ?? [];

  const updateTier = (idx: number, patch: Partial<RestTier>) => {
    const next = tiers.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const removeTier = (idx: number) => {
    const next = tiers.slice();
    next.splice(idx, 1);
    onChange(next.length === 0 ? null : next);
  };

  const addTier = () => {
    // Seed new row with sensible defaults — last row's pitch count + 15,
    // or 20/0 if there are no rows yet.
    const last = tiers[tiers.length - 1];
    const seed: RestTier = last
      ? { maxPitches: last.maxPitches + 15, daysRest: last.daysRest + 1 }
      : { maxPitches: 20, daysRest: 0 };
    onChange([...tiers, seed]);
  };

  return (
    <div className="space-y-2">
      {tiers.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{placeholder}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="text-left font-medium pb-1.5 pr-2">Pitches ≤</th>
                <th className="text-left font-medium pb-1.5 pr-2">Days rest</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {tiers.map((t, i) => (
                <tr key={i} data-testid={`${testIdPrefix}-row-${i}`}>
                  <td className="py-1 pr-2">
                    <Input
                      type="number"
                      min={0}
                      max={999}
                      value={t.maxPitches}
                      onChange={(e) =>
                        updateTier(i, {
                          maxPitches: Math.max(0, parseInt(e.target.value) || 0),
                        })
                      }
                      disabled={disabled}
                      className="h-8 w-20"
                      data-testid={`${testIdPrefix}-pitches-${i}`}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={t.daysRest}
                      onChange={(e) =>
                        updateTier(i, {
                          daysRest: Math.max(0, parseInt(e.target.value) || 0),
                        })
                      }
                      disabled={disabled}
                      className="h-8 w-20"
                      data-testid={`${testIdPrefix}-days-${i}`}
                    />
                  </td>
                  <td className="py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                      onClick={() => removeTier(i)}
                      disabled={disabled}
                      aria-label={`Remove tier ${i + 1}`}
                      data-testid={`${testIdPrefix}-remove-${i}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={addTier}
          disabled={disabled}
          data-testid={`${testIdPrefix}-add`}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add row
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onChange(STANDARD_REST_TIERS.slice())}
          disabled={disabled}
          data-testid={`${testIdPrefix}-load-standard`}
        >
          <Sparkles className="h-3 w-3 mr-1" />
          Use Little League rest tiers
        </Button>
        {tiers.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => onChange(null)}
            disabled={disabled}
            data-testid={`${testIdPrefix}-clear`}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
