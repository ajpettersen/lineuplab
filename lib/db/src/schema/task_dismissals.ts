import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { gamesTable } from "./games";

/**
 * Per-coach dismissal log for derived dashboard tasks ("score not
 * logged", "pitch counts not logged"). The Tasks card on the dashboard
 * derives an open-task list at read time from games + pitch_counts;
 * a row here means the coach has clicked Ignore on that (game, type)
 * pair and never wants to see it again.
 *
 * Unique constraint on (userId, gameId, taskType) so re-dismissing
 * an already-dismissed task is a no-op via ON CONFLICT.
 *
 * Cascade-deletes on game removal: a deleted game can't have a task,
 * so its dismissal row is meaningless.
 */
export const taskDismissalsTable = pgTable(
  "task_dismissals",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    gameId: integer("game_id")
      .notNull()
      .references(() => gamesTable.id, { onDelete: "cascade" }),
    /** "score" | "pitch_counts" — see /dashboard/tasks for the catalog. */
    taskType: text("task_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("task_dismissals_user_id_idx").on(table.userId),
    unique("task_dismissals_user_game_type_uq").on(
      table.userId,
      table.gameId,
      table.taskType,
    ),
  ],
);

export type TaskDismissal = typeof taskDismissalsTable.$inferSelect;
