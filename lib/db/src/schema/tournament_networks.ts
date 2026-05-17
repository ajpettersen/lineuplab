import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { tournamentsTable } from "./tournaments";

/**
 * Cross-coach "tournament network". When two coaches independently add
 * the same real-world tournament to Lineup Lab (detected via a shared
 * fingerprint — normalized name + date range), they can opt in to share
 * the schedule, scores, and pool-play standings. This is the only way
 * standings exist for SportsEngine tournaments, which don't publish
 * public standings.
 *
 * The network row is lazy — it isn't created until the first coach
 * accepts a "join" suggestion. After that, additional matching
 * tournaments are auto-suggested to their coaches and they can join
 * the same network row.
 *
 * Fingerprint is unique so the second-coach-to-join path can `INSERT
 * ... ON CONFLICT DO NOTHING RETURNING id` cleanly and we never end up
 * with two networks for the same fingerprint.
 */
export const tournamentNetworksTable = pgTable(
  "tournament_networks",
  {
    id: serial("id").primaryKey(),
    /** SHA1 of normalized (name, startDate, endDate). See `lib/tournament-fingerprint.ts`. */
    fingerprint: text("fingerprint").notNull(),
    /** Display name shown to network members — first joiner's tournament.name. */
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("tournament_networks_fingerprint_uq").on(table.fingerprint)],
);

/**
 * One row per (network, tournament). A tournament can only be in one
 * network at a time (enforced by the unique constraint on tournamentId).
 * `userId` is denormalized from `tournaments.userId` for cheap lookup
 * — most reads only need "who else is in this network and what do they
 * share" without joining tournaments → memberships.
 *
 * `visible` defaults to false — privacy default per the product spec
 * is "hidden, opt in to show". `shareScores` defaults to true because
 * the entire point of joining is to pool scores across teams.
 *
 * Cascade-deletes on tournament removal: a deleted tournament can't be
 * in a network. The parent network row stays — other coaches may still
 * be in it.
 */
export const tournamentNetworkMembersTable = pgTable(
  "tournament_network_members",
  {
    id: serial("id").primaryKey(),
    networkId: integer("network_id")
      .notNull()
      .references(() => tournamentNetworksTable.id, { onDelete: "cascade" }),
    tournamentId: integer("tournament_id")
      .notNull()
      .references(() => tournamentsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    /** Coach has opted in to show their team name to other members. */
    visible: boolean("visible").notNull().default(false),
    /** Coach is sharing their game scores with the network. */
    shareScores: boolean("share_scores").notNull().default(true),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tournament_network_members_network_id_idx").on(table.networkId),
    index("tournament_network_members_user_id_idx").on(table.userId),
    unique("tournament_network_members_tournament_uq").on(table.tournamentId),
  ],
);

export type TournamentNetwork = typeof tournamentNetworksTable.$inferSelect;
export type TournamentNetworkMember = typeof tournamentNetworkMembersTable.$inferSelect;
