import { ALL_FIELD_POSITIONS } from "./constants";

export type FieldPos = (typeof ALL_FIELD_POSITIONS)[number];

/**
 * Drag-and-drop "where am I dropping" payload, attached to each droppable
 * via @dnd-kit's `data` field and pulled out in handleDragEnd. Field Display
 * only ever shows one inning at a time so we don't carry inning info in the
 * payload — the component reads `currentInning` directly when applying moves.
 *   tile       → drop onto an occupied position chip (swap)
 *   emptyField → drop onto an empty position chip (move into open slot)
 *   benchArea  → drop onto the bench strip itself (send to bench)
 */
export type MoveTarget =
  | { kind: "tile"; entryId: number; position: string }
  | { kind: "emptyField"; position: string }
  | { kind: "benchArea" };

/**
 * Time-of-day lighting for the field. Bands picked to match how a youth
 * baseball/softball season actually plays out:
 *   morning   05:00–08:59  early Saturday tournament games — soft golden light
 *   day       09:00–15:59  bright midday — the default cheery green field
 *   evening   16:00–18:59  weeknight games at the start of the season —
 *                          warm orange "golden hour" wash over the field
 *   night     19:00–04:59  weeknight games mid-summer or late tournaments —
 *                          dark grass with stadium-light pools from the back
 *
 * Driven off the game's scheduled start time (`game.gameDate`), not wall
 * clock — once a game starts at 7pm it stays "night" for the duration even
 * if it runs late into the evening, so the visual identity is stable.
 */
export type LightingMode = "morning" | "day" | "evening" | "night";

export interface LightingPalette {
  /** CSS background for the field card itself (the grass gradient). */
  grassGradient: string;
  /** Tailwind gradient classes for the soft top vignette. */
  topVignette: string;
  /** Optional warm/cool wash overlaid on the field with mix-blend-soft-light
   *  to simulate sun/dusk light without bleaching the chips. Null = none. */
  ambientOverlay: string | null;
  /** When true, render the 3 stadium-light pools at the top of the field. */
  stadiumLights: boolean;
  /** For data-testid so e2e tests can assert the right palette is active. */
  label: LightingMode;
}

export type TPAvailability = {
  playerId: number;
  playerName: string;
  totalPitchesInTournament: number;
  pitchesToday: number;
  pitchesAvailableToday: number | null;
  pitchesAvailableInTournament: number | null;
  restingUntil?:
    | null
    | {
        availableOn: string;
        fromOutingDate: string;
        fromOutingPitches: number;
        daysRest: number;
      };
};
