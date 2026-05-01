import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { gamesTable } from "./games";
import { playersTable } from "./players";

export const aiPinnedAssignmentsTable = pgTable(
  "ai_pinned_assignments",
  {
    id: serial("id").primaryKey(),
    gameId: integer("game_id")
      .notNull()
      .references(() => gamesTable.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => playersTable.id, { onDelete: "cascade" }),
    inning: integer("inning").notNull(),
    position: text("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    perPlayerInning: uniqueIndex("ai_pinned_game_player_inning_unique").on(
      t.gameId,
      t.playerId,
      t.inning,
    ),
    perFieldPositionInning: uniqueIndex("ai_pinned_game_inning_position_unique")
      .on(t.gameId, t.inning, t.position)
      .where(sql`position <> 'Bench'`),
  }),
);

export type AiPinnedAssignment = typeof aiPinnedAssignmentsTable.$inferSelect;
export type NewAiPinnedAssignment = typeof aiPinnedAssignmentsTable.$inferInsert;
