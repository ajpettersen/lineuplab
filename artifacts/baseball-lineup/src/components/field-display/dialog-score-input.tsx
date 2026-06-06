import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DialogScoreInputProps {
  label: string;
  value: number;
  onChange: (next: number) => void;
  testId: string;
}

export function DialogScoreInput({ label, value, onChange, testId }: DialogScoreInputProps) {
  return (
    <div className="flex flex-col items-center gap-2" data-testid={testId}>
      <span
        className="text-[10px] sm:text-xs font-display uppercase tracking-[0.18em] text-muted-foreground text-center max-w-full truncate"
        title={label}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`Decrease ${label} score`}
          data-testid={`${testId}-down`}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span
          className="text-3xl font-bold tabular-nums w-10 text-center font-['Roboto_Mono']"
          data-testid={`${testId}-value`}
        >
          {value}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onChange(value + 1)}
          aria-label={`Increase ${label} score`}
          data-testid={`${testId}-up`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
