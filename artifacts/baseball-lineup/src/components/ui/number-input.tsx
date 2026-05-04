import * as React from "react";

import { Input } from "@/components/ui/input";

export interface NumberInputProps
  extends Omit<
    React.ComponentProps<"input">,
    "value" | "onChange" | "type" | "min" | "max" | "step"
  > {
  /** Current numeric value as held by the parent. */
  value: number;
  /**
   * Called whenever the parsed value changes. Fires on every keystroke that
   * yields a finite number, and once on blur with the committed value (which
   * may be the `fallback` if the field was left empty/invalid).
   */
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /**
   * Value committed if the user blurs the field while it's empty or
   * un-parseable. Defaults to the current `value` (i.e. revert on blur).
   * Pass an explicit fallback (e.g. a sensible default like `90`) when the
   * parent wants the input to "self-heal" to a known good value.
   */
  fallback?: number;
  /** Clamp to min/max on blur. Defaults to true. */
  clampOnBlur?: boolean;
}

/**
 * Integer-only number input that lets the user fully clear the field while
 * editing. Use this for whole-number fields like minutes, innings, jersey
 * numbers, counts, etc. — NOT for decimals or scientific notation. Parsing
 * uses `Number.parseInt`, so `1.5` becomes `1` and `1e2` becomes `1`.
 *
 * The plain controlled pattern `onChange={e => setX(parseInt(e.target.value) || fallback)}`
 * is broken: the moment the field is empty (mid-edit), `parseInt("")` is `NaN`,
 * the `|| fallback` snaps state back to the default, React re-renders the
 * input with the default value, and the user can never replace it. This
 * component fixes that by keeping its own draft string for display, only
 * forwarding finite parsed integers to `onChange` while typing, and committing
 * a clamped value (or `fallback`) on blur.
 *
 * Replace any `<Input type="number" value={n} onChange={(e) => setN(parseInt(e.target.value, 10) || X)} />`
 * with `<NumberInput value={n} onChange={setN} fallback={X} />` to inherit the
 * fix everywhere.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      onChange,
      min,
      max,
      step,
      fallback,
      clampOnBlur = true,
      onBlur,
      inputMode,
      ...rest
    },
    ref,
  ) => {
    // Internal display string — the source of truth for what the user sees
    // and edits. We only let the parent's `value` prop overwrite it when the
    // prop genuinely diverges from the current draft (e.g. a dialog reopens
    // with a different row, or an external mutation lands).
    const [draft, setDraft] = React.useState<string>(
      Number.isFinite(value) ? String(value) : "",
    );

    React.useEffect(() => {
      const parsed = draft === "" ? Number.NaN : Number.parseInt(draft, 10);
      if (parsed !== value) {
        setDraft(Number.isFinite(value) ? String(value) : "");
      }
      // We intentionally only react to the prop changing. Reading `draft`
      // here would loop because our own onChange round-trips through `value`.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
      <Input
        ref={ref}
        type="number"
        inputMode={inputMode ?? "numeric"}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          // Allow the field to be empty mid-edit. We don't push state to the
          // parent in that case — the displayed empty field IS the state, and
          // we'll commit a sensible value on blur.
          if (raw === "") return;
          const parsed = Number.parseInt(raw, 10);
          if (Number.isFinite(parsed)) {
            onChange(parsed);
          }
        }}
        onBlur={(e) => {
          const raw = draft.trim();
          let committed: number;
          const parsed = raw === "" ? Number.NaN : Number.parseInt(raw, 10);
          if (!Number.isFinite(parsed)) {
            committed = fallback ?? value;
          } else {
            let n = parsed;
            if (clampOnBlur) {
              if (typeof min === "number" && n < min) n = min;
              if (typeof max === "number" && n > max) n = max;
            }
            committed = n;
          }
          // Always re-sync the draft string so a clamp or fallback is
          // visible immediately. We also fire onChange so the parent state
          // matches what's on screen — important when the user blurs an
          // empty field (parent might still be holding the pre-clear value).
          setDraft(String(committed));
          if (committed !== value) onChange(committed);
          onBlur?.(e);
        }}
        {...rest}
      />
    );
  },
);
NumberInput.displayName = "NumberInput";
