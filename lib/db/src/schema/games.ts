import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gamesTable = pgTable("games", {
  id: serial("id").primaryKey(),
  opponent: text("opponent").notNull(),
  gameDate: timestamp("game_date", { withTimezone: true }).notNull(),
  location: text("location"),
  innings: integer("innings").notNull().default(6),
  status: text("status").notNull().default("upcoming"),
  // Event kind: "game" | "practice" | "other"
  type: text("type").notNull().default("game"),
  ourScore: integer("our_score"),
  opponentScore: integer("opponent_score"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGameSchema = createInsertSchema(gamesTable).omit({ id: true, createdAt: true });
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;
