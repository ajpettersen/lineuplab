import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { playersTable } from "./players";
import { rowVersion } from "./row-version";

export const historicalFieldingTable = pgTable("historical_fielding", {
  id: serial("id").primaryKey(),
  rowVersion: rowVersion(),
  playerId: integer("player_id")
    .notNull()
    .references(() => playersTable.id, { onDelete: "cascade" }),
  importLabel: text("import_label").notNull(),
  inningsP: integer("innings_p").notNull().default(0),
  inningsC: integer("innings_c").notNull().default(0),
  innings1b: integer("innings_1b").notNull().default(0),
  innings2b: integer("innings_2b").notNull().default(0),
  innings3b: integer("innings_3b").notNull().default(0),
  inningsSs: integer("innings_ss").notNull().default(0),
  inningsLf: integer("innings_lf").notNull().default(0),
  inningsCf: integer("innings_cf").notNull().default(0),
  inningsRf: integer("innings_rf").notNull().default(0),
  inningsBench: integer("innings_bench").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HistoricalFielding = typeof historicalFieldingTable.$inferSelect;
