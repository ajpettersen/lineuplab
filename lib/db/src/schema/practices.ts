import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One coach-authored practice plan. The plan blocks (warmup, drills,
 * scrimmage, etc.) live as JSONB on this row rather than in a separate
 * `practice_blocks` table because the coach edits a practice as a single
 * document — drag-reorder, regenerate-from-AI, save — and we never need
 * to query individual blocks across practices. JSONB keeps that read
 * pattern a single round-trip and lets us swap the entire blocks array
 * atomically when the AI proposes a new plan.
 *
 * Attendance lives in a separate `practice_attendance` table because:
 *   - we DO query it cross-practice ("who skipped the last 3?"),
 *   - it's UPSERTED per-player at different times (live during practice),
 *   - it has its own UNIQUE(practiceId, playerId) constraint that JSONB
 *     can't enforce.
 *
 * `focusAreas` is a top-level array of focus-area keys
 * (e.g. ["hitting", "infield", "baserunning"]) — duplicated from the
 * union of each block's `focusAreas` so the list page can render focus
 * chips without unpacking blocks. The AI generator also reads it as the
 * primary input for what drills to suggest.
 */
export type PracticeBlockJson = {
  /** Stable client-generated UUID so React keys + drag-reorder don't churn. */
  id: string;
  /** 0-based ordinal within the practice. Persisted so we don't depend on array order. */
  orderIndex: number;
  /** Short human label, e.g. "Infield: Bare-hand & flip drill". */
  title: string;
  /** Time slot in minutes. Sum across blocks should ~match practice.durationMinutes. */
  durationMinutes: number;
  /** Free-text description of what the kids do, including coaching cues. */
  description: string;
  /**
   * Block category used for color-coding + filtering:
   *   "warmup" | "drill" | "scrimmage" | "conditioning" | "meeting"
   */
  drillType: string;
  /**
   * Focus-area keys this block targets (subset of practice.focusAreas).
   * Drives the per-player coverage tracking ("Tommy hasn't done batting
   * in 3 practices" — we look at attendance × block.focusAreas).
   */
  focusAreas: string[];
  /**
   * Optional player groupings for this block. The AI emits these for
   * defensive blocks (infield/outfield/catching/pitching) so the coach
   * sees who's working where without having to assign manually. Stored
   * as plain player names (not IDs) so renaming/removing a player from
   * the roster doesn't silently rewrite history. `undefined` for blocks
   * the AI didn't group (warmups, hitting stations, conditioning, etc.).
   */
  groups?: { label: string; playerNames: string[] }[];
};

export const practicesTable = pgTable(
  "practices",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** Scheduled start of the practice (date + time). */
    date: timestamp("date", { withTimezone: true }).notNull(),
    /** Total practice length the AI plans against. Defaults to 90 min. */
    durationMinutes: integer("duration_minutes").notNull().default(90),
    /**
     * Optional title override. Defaults are computed in the UI as
     * "<weekday> practice" (e.g. "Tuesday practice") when blank.
     */
    title: text("title"),
    /**
     * Top-level focus area keys for this practice (e.g. ["hitting",
     * "infield", "baserunning"]). Stored separately from per-block focus
     * areas so the list page + AI generator have a single canonical
     * source of truth for "what's this practice about".
     */
    focusAreas: jsonb("focus_areas").$type<string[]>().notNull().default([]),
    /**
     * Time-blocked plan as a JSONB array. See `PracticeBlockJson`.
     * Empty array = unplanned (coach hasn't run AI yet or hasn't added
     * blocks manually).
     */
    blocks: jsonb("blocks").$type<PracticeBlockJson[]>().notNull().default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("practices_user_id_idx").on(table.userId),
    index("practices_date_idx").on(table.date),
  ],
);

export const insertPracticeSchema = createInsertSchema(practicesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPractice = z.infer<typeof insertPracticeSchema>;
export type Practice = typeof practicesTable.$inferSelect;
