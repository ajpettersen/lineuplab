import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { gamesTable } from "./games";
import { playersTable } from "./players";
import { rowVersion } from "./row-version";

export const lineupLocksTable = pgTable(
  "lineup_locks",
  {
    id: serial("id").primaryKey(),
    rowVersion: rowVersion(),
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
    // A given player can only be locked once per (game, inning).
    perPlayerInning: uniqueIndex("lineup_locks_game_player_inning_unique").on(
      t.gameId,
      t.playerId,
      t.inning,
    ),
    // A given non-Bench field position can only be held by one player per
    // (game, inning). Bench can repeat (multiple players can sit). This is
    // the DB-level guard against the read-then-insert race in POST /locks
    // (without it, two concurrent requests could both pass the conflict
    // check and store two players at C in inning 3).
    perFieldPositionInning: uniqueIndex("lineup_locks_game_inning_position_unique")
      .on(t.gameId, t.inning, t.position)
      .where(sql`position <> 'Bench'`),
  }),
);

export type LineupLock = typeof lineupLocksTable.$inferSelect;
export type NewLineupLock = typeof lineupLocksTable.$inferInsert;
