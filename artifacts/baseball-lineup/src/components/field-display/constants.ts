import type { FieldPos, LightingMode, LightingPalette } from "./types";

// Every position the field display knows how to lay out. The team's actual
// `activeFieldPositions` (from team_settings) is intersected with this list
// at render time, so a standard-9 team sees the classic LF/CF/RF outfield
// while a 10-player team sees LF/LCF/RCF/RF.
export const ALL_FIELD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "CF", "RCF", "RF"] as const;

/**
 * Diamond-shaped position layout for the dugout-fence iPad. Coordinates are
 * percentages of the field's bounding box so the SVG/CSS layout scales to
 * any screen size. Picked to match how a coach in the dugout naturally reads
 * the field: pitcher in the middle, catcher behind home, infielders form an
 * arc, outfielders along the back.
 */
export const POSITION_LAYOUT: Record<FieldPos, { top: string; left: string }> = {
  CF: { top: "11%", left: "50%" },
  // 10-player split: LCF and RCF sit between LF/CF and CF/RF respectively,
  // a touch deeper than CF so the back of the outfield reads as a smooth arc.
  LCF: { top: "13%", left: "36%" },
  RCF: { top: "13%", left: "64%" },
  LF: { top: "20%", left: "22%" },
  RF: { top: "20%", left: "78%" },
  SS: { top: "46%", left: "38%" },
  "2B": { top: "46%", left: "62%" },
  "3B": { top: "58%", left: "23%" },
  "1B": { top: "58%", left: "77%" },
  P: { top: "62%", left: "50%" },
  C: { top: "88%", left: "50%" },
};

/**
 * Color-code each position by group so the field reads at a glance from
 * across the dugout. Pitcher = bold gold (matches the at-bat hero accent),
 * infield = warm amber, outfield = cool sky, catcher = neutral white. The
 * accent shows up on the position pill above each player chip.
 */
export const POSITION_ACCENT: Record<FieldPos, string> = {
  P: "bg-amber-400 text-slate-950",
  C: "bg-slate-100 text-slate-900",
  "1B": "bg-amber-300 text-slate-900",
  "2B": "bg-amber-300 text-slate-900",
  "3B": "bg-amber-300 text-slate-900",
  SS: "bg-amber-300 text-slate-900",
  LF: "bg-sky-300 text-slate-900",
  LCF: "bg-sky-300 text-slate-900",
  CF: "bg-sky-300 text-slate-900",
  RCF: "bg-sky-300 text-slate-900",
  RF: "bg-sky-300 text-slate-900",
};

// Brightness pass (May 2026) — every grass gradient bumped ~20-30%,
// night ambient/vignette opacities relaxed, and the field container's
// inset shadow softened from 0.55 → 0.35. Coaches reported the field
// reading "a little dark" indoors / under bad gym lighting — these
// numbers keep the broadcast time-of-day vibe but lift overall
// luminance enough that chips pop and the diamond stays legible at
// arm's length on a phone.
export const FIELD_LIGHTING: Record<LightingMode, LightingPalette> = {
  morning: {
    grassGradient:
      "radial-gradient(ellipse 75% 60% at 50% 60%, rgb(78, 168, 96) 0%, rgb(48, 124, 66) 55%, rgb(24, 72, 36) 100%)",
    topVignette: "from-amber-200/20 to-transparent",
    ambientOverlay:
      "bg-gradient-to-br from-amber-200/30 via-yellow-100/10 to-transparent",
    stadiumLights: false,
    label: "morning",
  },
  day: {
    grassGradient:
      "radial-gradient(ellipse 75% 60% at 50% 60%, rgb(58, 146, 80) 0%, rgb(34, 108, 54) 55%, rgb(14, 54, 26) 100%)",
    topVignette: "from-black/20 to-transparent",
    ambientOverlay: null,
    stadiumLights: false,
    label: "day",
  },
  evening: {
    grassGradient:
      "radial-gradient(ellipse 75% 60% at 50% 60%, rgb(66, 134, 76) 0%, rgb(40, 96, 50) 55%, rgb(18, 56, 30) 100%)",
    topVignette: "from-orange-500/25 via-rose-400/10 to-transparent",
    ambientOverlay:
      "bg-gradient-to-br from-orange-500/30 via-rose-400/12 to-transparent",
    stadiumLights: false,
    label: "evening",
  },
  night: {
    grassGradient:
      "radial-gradient(ellipse 75% 60% at 50% 60%, rgb(36, 100, 54) 0%, rgb(20, 66, 34) 55%, rgb(8, 32, 16) 100%)",
    topVignette: "from-slate-950/40 to-transparent",
    ambientOverlay: "bg-gradient-to-b from-slate-950/20 via-transparent to-slate-950/15",
    stadiumLights: true,
    label: "night",
  },
};
