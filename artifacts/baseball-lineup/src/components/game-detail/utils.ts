import { format } from "date-fns";
import { type SportId } from "@workspace/sport-profiles";

export const STANDARD_FIELD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
// Canonical L→R column order for the lineup grid. Includes LCF/RCF so a
// team using a 10-player outfield gets sensible columns; the active
// positions list (from team_settings) is intersected with this for display.
export const POSITION_DISPLAY_ORDER = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "CF", "RCF", "RF"] as const;
export const INFIELD = new Set(["C", "1B", "2B", "3B", "SS"]);
// LCF/RCF are categorized as Outfield in the per-player tally.
export const OUTFIELD = new Set(["LF", "LCF", "CF", "RCF", "RF"]);

// Sport-aware "by position" tally columns. Baseball keeps its exact legacy
// categories + colors (Pitching/Infield/Outfield, with C counted as Infield)
// so existing coaches see no change; basketball rolls the five court spots up
// into Guard/Forward/Center. Bench + Out are appended generically by the
// renderer, so this only describes the colored field-position buckets.
export interface TallyCategory {
  key: string;
  label: string;
  /** Tailwind chip classes for a non-zero count. */
  cls: string;
  /** lowercased token for data-testid. */
  testid: string;
}
export const TALLY_CATEGORIES: Record<SportId, TallyCategory[]> = {
  baseball: [
    { key: "Pitching", label: "Pitching", cls: "bg-red-100 text-red-800", testid: "pitching" },
    { key: "Infield", label: "Infield", cls: "bg-emerald-100 text-emerald-800", testid: "infield" },
    { key: "Outfield", label: "Outfield", cls: "bg-indigo-100 text-indigo-800", testid: "outfield" },
  ],
  basketball: [
    { key: "Guard", label: "Guard", cls: "bg-red-100 text-red-800", testid: "guard" },
    { key: "Forward", label: "Forward", cls: "bg-emerald-100 text-emerald-800", testid: "forward" },
    { key: "Center", label: "Center", cls: "bg-indigo-100 text-indigo-800", testid: "center" },
  ],
};
// Map a single position code to its tally category key for the given sport.
// Returns "Bench" for the bench slot (and for anything unrecognized).
export function categoryForPos(pos: string, sport: SportId): string {
  if (pos === "Bench") return "Bench";
  if (sport === "basketball") {
    if (pos === "PG" || pos === "SG") return "Guard";
    if (pos === "SF" || pos === "PF") return "Forward";
    if (pos === "C") return "Center";
    return "Bench";
  }
  if (pos === "P") return "Pitching";
  if (INFIELD.has(pos)) return "Infield";
  if (OUTFIELD.has(pos)) return "Outfield";
  return "Bench";
}

export function positionColor(pos: string) {
  // Refined palette: each position keeps a distinct hue (so coaches can scan
  // a column at a glance) but all sit at a similar saturation/lightness so
  // the grid feels harmonious instead of rainbow-y.
  const colors: Record<string, string> = {
    P: "bg-red-50 text-red-800 border border-red-200/70",
    C: "bg-orange-50 text-orange-800 border border-orange-200/70",
    "1B": "bg-amber-50 text-amber-800 border border-amber-200/70",
    "2B": "bg-lime-50 text-lime-800 border border-lime-200/70",
    "3B": "bg-emerald-50 text-emerald-800 border border-emerald-200/70",
    SS: "bg-cyan-50 text-cyan-800 border border-cyan-200/70",
    LF: "bg-sky-50 text-sky-800 border border-sky-200/70",
    LCF: "bg-blue-50 text-blue-800 border border-blue-200/70",
    CF: "bg-indigo-50 text-indigo-800 border border-indigo-200/70",
    RCF: "bg-purple-50 text-purple-800 border border-purple-200/70",
    RF: "bg-violet-50 text-violet-800 border border-violet-200/70",
    Bench: "bg-slate-100 text-slate-600 border border-slate-200/70",
  };
  return colors[pos] ?? "bg-muted text-muted-foreground border border-border";
}

/**
 * Crash-safe wrapper around date-fns `format`. `format(new Date(x), …)`
 * throws "Invalid time value" the moment `x` is null, empty, or a
 * malformed date string — and because that happens during render, a
 * single bad row would take the WHOLE game-detail page down into the
 * ErrorBoundary ("Something went wrong / Reload page"). That's exactly
 * the "clicking into a game sometimes errors and makes me reload"
 * symptom coaches reported. Parse defensively and return a label
 * instead of throwing so one bad date can't blank the page.
 */
export function safeFormatDate(
  value: string | number | Date | null | undefined,
  fmt: string,
  fallback = "Date TBD",
): string {
  if (value == null) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return format(d, fmt);
}
