import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { practicesTable } from "./practices";
import { playersTable } from "./players";

/**
 * One row per (practice, player) the coach has marked attendance for.
 * Absent rows = "not yet marked" (rendered as a neutral state in the
 * UI, distinct from explicit "no" / `attended: false`).
 *
 * Cascade-deletes on practice removal (a deleted practice's attendance
 * isn't useful) and on player removal (deleted players have no
 * attendance to track).
 *
 * `userId` is denormalized so multi-tenant queries don't need a join
 * back through practices to enforce ownership — same pattern as
 * `pitch_counts`.
 *
 * `notes` lets the coach jot per-player practice notes (e.g. "great
 * cuts today" / "favoring left ankle"). Optional.
 */
export const practiceAttendanceTable = pgTable(
  "practice_attendance",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    practiceId: integer("practice_id")
      .notNull()
      .references(() => practicesTable.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => playersTable.id, { onDelete: "cascade" }),
    attended: boolean("attended").notNull().default(true),
    notes: text("notes"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("practice_attendance_user_id_idx").on(table.userId),
    index("practice_attendance_practice_id_idx").on(table.practiceId),
    index("practice_attendance_player_id_idx").on(table.playerId),
    unique("practice_attendance_practice_player_uq").on(
      table.practiceId,
      table.playerId,
    ),
  ],
);

export const insertPracticeAttendanceSchema = createInsertSchema(
  practiceAttendanceTable,
).omit({
  id: true,
  userId: true,
  recordedAt: true,
});
export type InsertPracticeAttendance = z.infer<
  typeof insertPracticeAttendanceSchema
>;
export type PracticeAttendance = typeof practiceAttendanceTable.$inferSelect;
