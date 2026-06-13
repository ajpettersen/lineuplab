import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";
import { playersTable } from "./players";

export const battingStatsTable = pgTable("batting_stats", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id")
    .notNull()
    .references(() => playersTable.id, { onDelete: "cascade" }),
  seasonLabel: text("season_label").notNull().default("Current"),
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
  avg: real("avg"),
  obp: real("obp"),
  slg: real("slg"),
  ops: real("ops"),
  sourceNote: text("source_note"),
  // When set, this manual row holds the FULL season totals as of this
  // moment (from a season-screenshot import / override). Per-game
  // box-score lines for games dated AFTER this timestamp are added on
  // top in `getBattingTotals`; games dated on/before it are considered
  // already captured by the override and excluded — so a season import
  // overrides the individual game totals "up til that upload" while
  // future games still accumulate. null = legacy additive (delta) row.
  seasonImportedAt: timestamp("season_imported_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BattingStats = typeof battingStatsTable.$inferSelect;
