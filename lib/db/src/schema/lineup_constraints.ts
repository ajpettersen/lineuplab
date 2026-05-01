import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { playersTable } from "./players";

export const lineupConstraintsTable = pgTable(
  "lineup_constraints",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    playerId: integer("player_id").references(() => playersTable.id, { onDelete: "cascade" }),
    position: text("position"),
    rule: text("rule").notNull(),
    value: integer("value"),
    description: text("description").notNull(),
    aiInput: text("ai_input"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lineup_constraints_user_id_idx").on(table.userId)],
);

export type LineupConstraint = typeof lineupConstraintsTable.$inferSelect;
