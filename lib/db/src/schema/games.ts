import { pgTable, text, serial, timestamp, integer, index, jsonb, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { rowVersion } from "./row-version";

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
    rowVersion: rowVersion(),
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
    /**
     * Per-game competitiveness override (0-100) for the BATTING ORDER only.
     * Null = legacy behavior (use the gameType label + global fairness dial).
     *   0   → fully equitable: order by ascending season plate appearances so
     *         under-used kids bat earlier and PAs even out.
     *   100 → fully competitive: OPS table-setter/cleanup order, blended with
     *         each player's learned preferred slot from past competitive games.
     * Values in between linearly blend the two orderings. Defense / field
     * equity is unaffected — this dial only moves the batting order.
     */
    competitiveness: integer("competitiveness"),
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
    /**
     * For tournament games only: which stage of the tournament this game
     * belongs to. Drives which pair of time-limit fields on the parent
     * tournament (`pool_play_*` vs `bracket_*`) applies to this game.
     * Null when the game has no `tournamentId`. New tournament games
     * default to "pool" — the coach can switch a game to "bracket" from
     * the game edit dialog once bracket play begins.
     */
    bracketStage: text("bracket_stage"),
    /**
     * Marks this game as the tournament championship. When true, the
     * Field Display auto-enables Championship Mode (gold frame glow,
     * rainbow chyron, crowns) without the coach having to flip the
     * per-device kebab toggle. Only meaningful on tournament games
     * (gameType="tournament"); the edit dialog hides the checkbox and the
     * API rejects setting it true otherwise. Default false so existing
     * games are unaffected.
     */
    isChampionship: boolean("is_championship").notNull().default(false),
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
    /**
     * Set when the box-score-reminder push notification has been sent
     * for this game (single fire per game). The scheduler only fires
     * for games where:
     *   - team_settings.usesGameChanger = true
     *   - boxScoreImportedAt IS NULL
     *   - boxScoreReminderSentAt IS NULL
     *   - status != 'cancelled'
     *   - now() between gameDate + 2h and gameDate + 7d
     * The 7-day window guards against an old un-imported game suddenly
     * spamming a coach who toggles GameChanger on weeks later.
     * Cleared on POST /games/:id/box-score (re-import) so a future
     * delete + re-prompt cycle works, but DELETE /box-score does NOT
     * clear it (we don't want to re-nag for the same game after the
     * coach explicitly removed the import).
     */
    boxScoreReminderSentAt: timestamp("box_score_reminder_sent_at", { withTimezone: true }),
    /**
     * Stable external identifier from the source the game was imported
     * from. Today only set by the iCal sync path — value is the VEVENT
     * UID. Used by the recurring iCal sync scheduler to upsert moved
     * games (date/time/location/opponent edits on the league side) and
     * to skip already-known events on subsequent fetches. Null for
     * games created manually in the app. Scoped (userId, sourceUid)
     * via a partial unique index so two coaches can sync from the
     * same league calendar without colliding.
     */
    sourceUid: text("source_uid"),
    /**
     * Set by the calendar sync when a synced upcoming game disappears from
     * the league feed and the sync cancels it (only games with no lineup).
     * Lets the sync un-cancel it if the league puts it back, without ever
     * overriding a coach who cancelled a game by hand.
     */
    sourceRemovedAt: timestamp("source_removed_at", { withTimezone: true }),
    /**
     * Last schedule change the calendar sync applied ("Moved from 12:00 PM
     * to 1:00 PM"). Shown as a badge on upcoming games so a coach notices a
     * league-side time/field change instead of showing up an hour early.
     */
    scheduleChangeNote: text("schedule_change_note"),
    scheduleChangedAt: timestamp("schedule_changed_at", { withTimezone: true }),
    /**
     * Umpire info from the league / umpire association (lib/umpires.ts).
     * `umpireOrg` = association assigned to the game (from MBL);
     * `umpireName` = assigned umpire(s) when the association publishes it
     * (North Metro / nmua.net), or "Not assigned yet". Names only — we
     * deliberately don't copy umpires' phone numbers (many are minors).
     */
    umpireOrg: text("umpire_org"),
    umpireName: text("umpire_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete timestamp. Null = visible. Set by the trash action
    // so the coach can hit Undo on the toast. All read queries scope
    // to `deletedAt IS NULL`; the restore endpoint clears it.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("games_user_id_idx").on(table.userId),
    // Partial unique so manual rows (sourceUid IS NULL) don't conflict
    // and so the iCal upsert can use ON CONFLICT to update in place.
    uniqueIndex("games_user_source_uid_uidx")
      .on(table.userId, table.sourceUid)
      .where(sql`${table.sourceUid} IS NOT NULL`),
  ],
);

export const insertGameSchema = createInsertSchema(gamesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;
