import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { playersTable } from "./players";

export const lineupConstraintsTable = pgTable("lineup_constraints", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  playerId: integer("player_id").references(() => playersTable.id, { onDelete: "cascade" }),
  position: text("position"),
  rule: text("rule").notNull(),
  value: integer("value"),
  description: text("description").notNull(),
  aiInput: text("ai_input"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LineupConstraint = typeof lineupConstraintsTable.$inferSelect;
