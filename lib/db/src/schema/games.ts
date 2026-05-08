import { pgTable, text, serial, timestamp, integer, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Snapshot of a single lineup_entries row, captured before the coach overrides
// the saved lineup with a post-game photo. We freeze the player NAME (not just
// id) so the snapshot still reads sensibly if a player is later removed.
export type PlanSnapshotEntry = {
  playerId: number;
  playerName: string;
  inning: number;
  position: string;
  battingOrder: number | null;
};

export const gamesTable = pgTable(
  "games",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    opponent: text("opponent").notNull(),
    gameDate: timestamp("game_date", { withTimezone: true }).notNull(),
    location: text("location"),
    innings: integer("innings").notNull().default(6),
    status: text("status").notNull().default("upcoming"),
    // Event kind: "game" | "practice" | "other"
    type: text("type").notNull().default("game"),
    // Optional competitive context — drives the lineup generator's bias.
    //   "tournament" → most competitive (best fielders, OBP-ordered batting)
    //   "league"     → rebalances season plate appearances (low-PA kids bat earlier)
    //   null         → unspecified, falls back to the global equity slider
    gameType: text("game_type"),
    ourScore: integer("our_score"),
    opponentScore: integer("opponent_score"),
    // Wall-clock time of the actual first pitch (set by the dugout coach
    // tapping "Start Game" on the field display). Distinct from gameDate
    // (the SCHEDULED start) — tournaments routinely start late, and the
    // running game timer needs to reflect actual elapsed play, not the
    // scheduled slot. Null until the coach kicks it off; resettable via
    // a PATCH with `startedAt: null` if they fat-fingered the button.
    startedAt: timestamp("started_at", { withTimezone: true }),
    // Optional link to a tournaments row when this game is part of a
    // multi-game tournament weekend. Drives the rolling per-pitcher
    // pitch-count math ("how many pitches does Sarah have left today
    // given what she threw in earlier games of this tournament").
    // Null for league games / one-offs. ON DELETE SET NULL so removing
    // a tournament doesn't blow away its games.
    tournamentId: integer("tournament_id"),
    notes: text("notes"),
    // Snapshot of the planned lineup (taken when the coach chose "Keep both"
    // before overriding with a post-game photo). Null = no snapshot.
    planSnapshot: jsonb("plan_snapshot").$type<PlanSnapshotEntry[]>(),
    // Set when a coach uploads a GameChanger / scorebook box score and
    // commits the extracted batting + pitching lines. Drives the
    // "Already imported — re-import will replace" banner on the import
    // dialog and is the single source of truth for whether per-game
    // batting lines exist for this game (the actual rows live in
    // `game_batting_lines`; this column lets the UI avoid an extra
    // count(*) round-trip on the game-detail page).
    boxScoreImportedAt: timestamp("box_score_imported_at", { withTimezone: true }),
    // Object-storage paths (e.g. "/objects/uploads/<uuid>") for the
    // GameChanger / scorebook screenshots the coach uploaded for the
    // last box-score import. Stored so we can render the originals
    // back in the import dialog ("here's what you uploaded"). Wiped
    // on DELETE /box-score; replaced on each re-import.
    boxScoreImagePaths: jsonb("box_score_image_paths").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete timestamp. Null = visible. Set by the trash action
    // so the coach can hit Undo on the toast. All read queries scope
    // to `deletedAt IS NULL`; the restore endpoint clears it.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("games_user_id_idx").on(table.userId)],
);

export const insertGameSchema = createInsertSchema(gamesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;
