import {
  pgTable,
  text,
  serial,
  timestamp,
  boolean,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Multi-coach access. A "team" is identified by the head coach's Clerk
 * userId (the `ownerUserId`). Other Clerk users (`memberUserId`) can be
 * added to a team via an invite link; once they accept, all data-scoping
 * queries treat their requests as if they came from the head coach,
 * giving them access (gated by `permission`) to that team's roster,
 * games, lineups, AI memory, etc.
 *
 * The OWNER also has a row in this table (with `isOwner = true`,
 * `permission = 'full'`). This is the single source of truth for the
 * coach's per-team profile (`displayName`, `role`) so we don't have a
 * second "owner profile" table to keep in sync. The owner-row is created
 * idempotently the first time the owner hits the API (see
 * `ensureOwnerMembership` and the `resolveTeamContext` middleware).
 *
 * `permission` tiers (linear rank, higher = more access):
 *   - 'full'    → everything: roster, lineups, games, practices, settings, coach mgmt.
 *   - 'partial' → edit lineups, games, practices, stats. NO roster / settings / coach mgmt.
 *   - 'upload'  → read everything + upload box scores ONLY (designed for a
 *                 stat-keeper / "GameChanger" parent). Cannot edit lineups,
 *                 roster, settings, etc. Box-score routes gate at this tier
 *                 so partial + full pass too.
 *   - 'view'    → read-only on every page; all writes 403.
 *
 * `role` is a free-form display label (e.g. "Head Coach", "Assistant
 * Coach", "Pitching Coach", "Parent Helper"). It does NOT affect
 * authorization — `permission` does.
 *
 * One coach can belong to multiple teams (e.g. they coach their own team
 * and assist another). The `user_active_team` table tracks which team is
 * currently selected for each user.
 */
export const teamMembershipsTable = pgTable(
  "team_memberships",
  {
    id: serial("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    memberUserId: text("member_user_id").notNull(),
    memberEmail: text("member_email"),
    /** Free-form display name the coach picked for this team. */
    displayName: text("display_name"),
    /** Free-form role label (e.g. "Head Coach"). Display only. */
    role: text("role"),
    /** 'full' | 'partial' | 'upload' | 'view'. Owner row is always 'full'. */
    permission: text("permission").notNull().default("full"),
    /** True for the owner's own row in their own team. */
    isOwner: boolean("is_owner").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("team_memberships_owner_member_idx").on(
      table.ownerUserId,
      table.memberUserId,
    ),
    index("team_memberships_member_idx").on(table.memberUserId),
    check(
      "team_memberships_permission_check",
      sql`${table.permission} in ('full', 'partial', 'upload', 'view')`,
    ),
  ],
);

export type TeamMembership = typeof teamMembershipsTable.$inferSelect;

export type PermissionTier = "full" | "partial" | "upload" | "view";

/**
 * Numeric ranking so callers can compare tiers with `>=`.
 * Higher value = more access.
 *
 * `upload` sits between view and partial: it grants box-score upload
 * (which the box-score routes gate at this rank) without unlocking
 * lineup/game/practice/stats editing.
 */
export const PERMISSION_RANK: Record<PermissionTier, number> = {
  view: 0,
  upload: 1,
  partial: 2,
  full: 3,
};

export function isPermissionTier(value: unknown): value is PermissionTier {
  return (
    value === "full" ||
    value === "partial" ||
    value === "upload" ||
    value === "view"
  );
}
