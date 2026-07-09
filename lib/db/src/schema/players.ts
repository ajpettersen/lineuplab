import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { rowVersion } from "./row-version";

export const playersTable = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    rowVersion: rowVersion(),
    userId: text("user_id").notNull(),
    // `name` is kept as the canonical "First Last" display string and is
    // re-derived on every write from firstName + lastName. Existing reads
    // across the app (lineup grids, stats pages, AI prompts) continue to
    // use it. New writes MUST set both firstName and lastName so the box
    // score importer can fuzzy-match GameChanger's "F. Lastname" format.
    name: text("name").notNull(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    number: integer("number"),
    eligiblePositions: text("eligible_positions").array().notNull().default([]),
    preferredPositions: text("preferred_positions").array().notNull().default([]),
    canPitch: boolean("can_pitch").notNull().default(false),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete timestamp. Null = active. Set when a coach trashes
    // the player so the action can be undone (toast Undo button on
    // the client). All read queries filter `deletedAt IS NULL`; the
    // restore endpoint clears the timestamp. Cleanup of long-deleted
    // rows is intentionally not automated yet — a coach may want to
    // recover a player from earlier in the season.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("players_user_id_idx").on(table.userId)],
);

export const insertPlayerSchema = createInsertSchema(playersTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
