import { and, eq } from "drizzle-orm";
import { db } from "../index";
import { teamMembershipsTable, type TeamMembership } from "../schema/team_memberships";

/**
 * Idempotently make sure the team owner has a `team_memberships` row for
 * their own team (with `isOwner = true`, `permission = 'full'`). The row
 * is the single source of truth for the owner's display name + role on
 * their own team, so all "list members" / "my profile" queries can hit
 * one table.
 *
 * Safe to call on every authenticated request — the underlying
 * `(owner_user_id, member_user_id)` unique index turns a duplicate insert
 * into a no-op.
 *
 * Returns the resulting row (newly inserted OR pre-existing).
 */
export async function ensureOwnerMembership(
  ownerUserId: string,
  memberEmail: string | null,
): Promise<TeamMembership> {
  // Insert-if-missing. We don't update on conflict — owner display name /
  // role are user-controlled and should never be clobbered by a passive
  // bookkeeping call.
  await db
    .insert(teamMembershipsTable)
    .values({
      ownerUserId,
      memberUserId: ownerUserId,
      memberEmail,
      isOwner: true,
      permission: "full",
    })
    .onConflictDoNothing({
      target: [teamMembershipsTable.ownerUserId, teamMembershipsTable.memberUserId],
    });

  const [row] = await db
    .select()
    .from(teamMembershipsTable)
    .where(
      and(
        eq(teamMembershipsTable.ownerUserId, ownerUserId),
        eq(teamMembershipsTable.memberUserId, ownerUserId),
      ),
    );

  if (!row) {
    // This should be unreachable — the insert above either created the
    // row or it already existed. If it's missing here, surface a loud
    // error rather than returning a fake stub.
    throw new Error(
      `ensureOwnerMembership: row missing after upsert for ownerUserId=${ownerUserId}`,
    );
  }
  return row;
}
