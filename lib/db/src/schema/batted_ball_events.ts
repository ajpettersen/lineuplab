import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { gamesTable } from "./games";
import { playersTable } from "./players";
import { rowVersion } from "./row-version";

/**
 * One row per batted ball (hit) whose direction we know, for spray
 * charts. GameChanger's live scorer doesn't record exact field
 * coordinates — only the batted-ball type ("ground ball" / "line
 * drive" / "fly ball") and which fielder handled it, parsed from
 * play-by-play text (e.g. "singles on a ground ball to center
 * fielder"). `direction` + `battedBallType` are enough to place a
 * zone-accurate (not pixel-accurate) dot on a field diagram.
 *
 * Outs aren't recorded here — only hits, since that's what the
 * "where does this kid get his hits" spray chart is for. `userId` is
 * denormalized for the same multi-tenant reason as
 * `game_batting_lines`.
 */
export const battedBallEventsTable = pgTable(
  "batted_ball_events",
  {
    id: serial("id").primaryKey(),
    rowVersion: rowVersion(),
    userId: text("user_id").notNull(),
    gameId: integer("game_id")
      .notNull()
      .references(() => gamesTable.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => playersTable.id, { onDelete: "cascade" }),
    result: text("result").notNull(), // single | double | triple | home_run
    battedBallType: text("batted_ball_type").notNull(), // ground_ball | line_drive | fly_ball
    direction: text("direction").notNull(), // P | C | 1B | 2B | 3B | SS | LF | CF | RF
    sourceNote: text("source_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("batted_ball_events_user_id_idx").on(table.userId),
    index("batted_ball_events_player_id_idx").on(table.playerId),
    index("batted_ball_events_game_id_idx").on(table.gameId),
  ],
);

export type BattedBallEvent = typeof battedBallEventsTable.$inferSelect;
