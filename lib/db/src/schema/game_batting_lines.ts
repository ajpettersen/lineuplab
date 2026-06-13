import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { gamesTable } from "./games";
import { playersTable } from "./players";

/**
 * One row per (game, player) for batting stats imported from a box
 * score (GameChanger screenshot, paste, etc.) or entered manually
 * per-game.
 *
 * Why a separate table from `batting_stats` (the per-player season
 * aggregate)?
 *
 *   - **No double-counting on re-import.** The unique (game_id,
 *     player_id) constraint means re-importing the same game's box
 *     score is an UPSERT, not an INSERT — coaches can fix a typo by
 *     re-uploading and rates self-correct.
 *   - **Per-game traceability.** Coaches can drill into "where did
 *     this season's HR total come from" and see each game's line.
 *   - **Idempotent revert.** Deleting a game cascades these rows
 *     away; deleting just the import (without the game) is also
 *     supported.
 *
 * The season-totals view that the lineup generator and stats UI
 * read is computed live as `manual batting_stats counts + SUM(this
 * table)` per player, then rates are recomputed. See
 * `lib/batting-totals.ts` in the api-server.
 *
 * `userId` is denormalized so multi-tenant queries don't need a
 * join through games or players to enforce ownership.
 *
 * Cascade-deletes on game/player removal: the line is meaningless
 * once its game or player is gone.
 */
export const gameBattingLinesTable = pgTable(
  "game_batting_lines",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    gameId: integer("game_id")
      .notNull()
      .references(() => gamesTable.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => playersTable.id, { onDelete: "cascade" }),
    ab: integer("ab").notNull().default(0),
    hits: integer("hits").notNull().default(0),
    doubles: integer("doubles").notNull().default(0),
    triples: integer("triples").notNull().default(0),
    hr: integer("hr").notNull().default(0),
    rbi: integer("rbi").notNull().default(0),
    bb: integer("bb").notNull().default(0),
    k: integer("k").notNull().default(0),
    hbp: integer("hbp").notNull().default(0),
    sac: integer("sac").notNull().default(0),
    sf: integer("sf").notNull().default(0),
    sb: integer("sb").notNull().default(0),
    runs: integer("runs").notNull().default(0),
    sourceNote: text("source_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("game_batting_lines_user_id_idx").on(table.userId),
    index("game_batting_lines_game_id_idx").on(table.gameId),
    index("game_batting_lines_player_id_idx").on(table.playerId),
    unique("game_batting_lines_game_player_uq").on(table.gameId, table.playerId),
  ],
);

export type GameBattingLine = typeof gameBattingLinesTable.$inferSelect;
