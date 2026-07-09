import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { gamesTable } from "./games";
import { playersTable } from "./players";
import { rowVersion } from "./row-version";

export const lineupEntriesTable = pgTable("lineup_entries", {
  id: serial("id").primaryKey(),
  rowVersion: rowVersion(),
  gameId: integer("game_id").notNull().references(() => gamesTable.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  inning: integer("inning").notNull(),
  position: text("position").notNull(),
  battingOrder: integer("batting_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLineupEntrySchema = createInsertSchema(lineupEntriesTable).omit({ id: true, createdAt: true });
export type InsertLineupEntry = z.infer<typeof insertLineupEntrySchema>;
export type LineupEntry = typeof lineupEntriesTable.$inferSelect;
