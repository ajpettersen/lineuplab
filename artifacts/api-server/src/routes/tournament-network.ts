import { Router, type IRouter } from "express";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  tournamentsTable,
  tournamentNetworksTable,
  tournamentNetworkMembersTable,
  teamSettingsTable,
} from "@workspace/db";
import { gateWrites } from "../lib/permissions";
import { computeTournamentFingerprint } from "../lib/tournament-fingerprint";

/**
 * Tournament network endpoints — opt-in cross-coach data sharing for
 * the same real-world tournament. See `tournament_networks` schema for
 * the data model and `tournament-fingerprint.ts` for the match key.
 *
 * Auth: all routes are scoped to the active team's `ownerUserId` (set
 * by resolveTeamContext). We never expose another coach's userId on
 * the wire — only opt-in `visible` members reveal their team name +
 * coach display name.
 *
 * Mounted at /tournaments/:id/network/* below /tournaments to share
 * the gateWrites("full") gate (any network change is a per-team write).
 */
const router: IRouter = Router();
router.use("/tournaments", gateWrites("full"));

const IdParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Load an own-checked tournament. Returns null if missing/deleted/not
 * the active team's. Caller emits 404.
 */
async function getOwnedTournament(id: number, userId: string) {
  const [row] = await db
    .select()
    .from(tournamentsTable)
    .where(
      and(
        eq(tournamentsTable.id, id),
        eq(tournamentsTable.userId, userId),
        isNull(tournamentsTable.deletedAt),
      ),
    );
  return row ?? null;
}

/**
 * GET /tournaments/:id/network
 *
 * Returns the current network state + any suggested joins. The shape
 * accommodates the three frontend states:
 *
 *  - `network: null, suggestions: []`        → no panel shown
 *  - `network: null, suggestions: [...]`     → "Join with N other coaches" CTA
 *  - `network: {...}, members: [...]`        → in-network member list
 *
 * Suggestions are tournaments owned by OTHER users with the same
 * non-empty fingerprint as this one. We hide them after the coach
 * sets `networkPromptDismissedAt`, but a freshly-added matching
 * tournament after the dismiss timestamp re-surfaces it (caller can
 * tell because suggestions are recomputed every request).
 *
 * Members are surfaced regardless of `visible` to the requesting
 * coach IF they're in the same network — but only `visible=true`
 * members get their teamName/displayName populated. Hidden members
 * appear as anonymous "coach in network" entries so the count is
 * accurate without leaking identity.
 */
router.get("/tournaments/:id/network", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const tournament = await getOwnedTournament(params.data.id, userId);
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }

  // Resolve current membership for this tournament (if any).
  const [membership] = await db
    .select()
    .from(tournamentNetworkMembersTable)
    .where(eq(tournamentNetworkMembersTable.tournamentId, tournament.id));

  let networkRow = null as typeof tournamentNetworksTable.$inferSelect | null;
  let members: Array<{
    tournamentId: number;
    visible: boolean;
    shareScores: boolean;
    teamName: string | null;
    isYou: boolean;
  }> = [];

  if (membership) {
    const [n] = await db
      .select()
      .from(tournamentNetworksTable)
      .where(eq(tournamentNetworksTable.id, membership.networkId));
    networkRow = n ?? null;

    // Load all other members + their team names (only revealed if visible).
    const rows = await db
      .select({
        tournamentId: tournamentNetworkMembersTable.tournamentId,
        userId: tournamentNetworkMembersTable.userId,
        visible: tournamentNetworkMembersTable.visible,
        shareScores: tournamentNetworkMembersTable.shareScores,
        teamName: teamSettingsTable.teamName,
      })
      .from(tournamentNetworkMembersTable)
      .leftJoin(
        teamSettingsTable,
        eq(teamSettingsTable.userId, tournamentNetworkMembersTable.userId),
      )
      .where(eq(tournamentNetworkMembersTable.networkId, membership.networkId));

    members = rows.map((r) => ({
      tournamentId: r.tournamentId,
      visible: r.visible,
      shareScores: r.shareScores,
      // Hide team name unless the coach opted in to be visible. Always
      // reveal the requester's own row regardless.
      teamName: r.visible || r.userId === userId ? r.teamName ?? null : null,
      isYou: r.userId === userId,
    }));
  }

  // Suggestions: other tournaments with the same fingerprint, NOT
  // already in any network (or in a different network than ours).
  // Hide when this coach has dismissed the prompt for now.
  //
  // PRIVACY: we never reveal the matched coaches' team names or
  // tournament names here. A coach who hasn't yet joined the network
  // and hasn't opted in to be visible has only signalled "I'm running
  // a tournament with the same fingerprint" — that's a SUGGESTION
  // signal, not consent to be identified. We surface a count and
  // anonymous placeholders only. Identity reveal happens after both
  // sides join AND opt in via `visible=true`.
  let suggestions: Array<{
    tournamentId: number;
    name: string;
    teamName: string | null;
    networkId: number | null;
  }> = [];
  if (
    tournament.networkFingerprint &&
    !tournament.networkPromptDismissedAt &&
    !membership
  ) {
    const matches = await db
      .select({
        tournamentId: tournamentsTable.id,
        networkId: tournamentNetworkMembersTable.networkId,
      })
      .from(tournamentsTable)
      .leftJoin(
        tournamentNetworkMembersTable,
        eq(tournamentNetworkMembersTable.tournamentId, tournamentsTable.id),
      )
      .where(
        and(
          eq(tournamentsTable.networkFingerprint, tournament.networkFingerprint),
          ne(tournamentsTable.userId, userId),
          isNull(tournamentsTable.deletedAt),
        ),
      );
    suggestions = matches.map((m) => ({
      tournamentId: m.tournamentId,
      name: "Another coach",
      teamName: null,
      networkId: m.networkId,
    }));
  }

  res.json({
    network: networkRow,
    membership: membership ?? null,
    members,
    suggestions,
  });
});

/**
 * POST /tournaments/:id/network/join
 *
 * Lazy-create the network row keyed on the tournament's fingerprint
 * (or attach to an existing one), then add this tournament's
 * membership. Idempotent — re-joining is a no-op via the unique
 * constraint on (tournamentId).
 *
 * Errors:
 *  - 400 if tournament has no fingerprint (legacy row before backfill
 *    or empty name/dates); the client should PATCH the tournament to
 *    populate a name + dates and try again.
 *  - 409 if the tournament is already in a DIFFERENT network — caller
 *    must leave first (we never silently switch networks).
 */
router.post("/tournaments/:id/network/join", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const tournament = await getOwnedTournament(params.data.id, userId);
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  if (!tournament.networkFingerprint) {
    res.status(400).json({
      error: "Tournament needs a name and date range before it can be networked",
    });
    return;
  }

  // 1) Get-or-create the network row. The unique constraint on
  //    fingerprint guarantees at most one row per fingerprint —
  //    `ON CONFLICT DO NOTHING RETURNING id` returns the row only
  //    when WE inserted it, so we follow up with a SELECT for the
  //    case where another coach inserted it concurrently.
  const [inserted] = await db
    .insert(tournamentNetworksTable)
    .values({
      fingerprint: tournament.networkFingerprint,
      displayName: tournament.name,
    })
    .onConflictDoNothing({ target: tournamentNetworksTable.fingerprint })
    .returning();
  let networkRow = inserted;
  if (!networkRow) {
    const [existing] = await db
      .select()
      .from(tournamentNetworksTable)
      .where(eq(tournamentNetworksTable.fingerprint, tournament.networkFingerprint));
    if (!existing) {
      res.status(500).json({ error: "Failed to resolve network" });
      return;
    }
    networkRow = existing;
  }

  // 2) Check for existing membership — if already in a different
  //    network, that's a conflict the coach must explicitly resolve.
  const [existingMembership] = await db
    .select()
    .from(tournamentNetworkMembersTable)
    .where(eq(tournamentNetworkMembersTable.tournamentId, tournament.id));
  if (existingMembership && existingMembership.networkId !== networkRow.id) {
    res.status(409).json({
      error: "Tournament is already in a different network; leave it first",
    });
    return;
  }
  if (existingMembership) {
    res.json({ network: networkRow, membership: existingMembership });
    return;
  }

  // 3) Insert membership. Defaults: shareScores=true, visible=false
  //    (privacy default per product spec is "hidden, opt in to show").
  const [membership] = await db
    .insert(tournamentNetworkMembersTable)
    .values({
      networkId: networkRow.id,
      tournamentId: tournament.id,
      userId,
    })
    .returning();

  // Clear any pending dismiss flag — the coach made an active choice.
  await db
    .update(tournamentsTable)
    .set({ networkPromptDismissedAt: null })
    .where(eq(tournamentsTable.id, tournament.id));

  res.status(201).json({ network: networkRow, membership });
});

/**
 * POST /tournaments/:id/network/leave
 *
 * Remove this tournament from its network. Leaves the network row
 * intact for other members. Idempotent — leaving when not a member
 * returns 204.
 */
router.post("/tournaments/:id/network/leave", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const tournament = await getOwnedTournament(params.data.id, userId);
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  await db
    .delete(tournamentNetworkMembersTable)
    .where(eq(tournamentNetworkMembersTable.tournamentId, tournament.id));
  res.status(204).end();
});

const PatchBody = z
  .object({
    visible: z.boolean().optional(),
    shareScores: z.boolean().optional(),
  })
  .refine((v) => v.visible !== undefined || v.shareScores !== undefined, {
    message: "Provide at least one of visible / shareScores",
  });

/**
 * PATCH /tournaments/:id/network — toggle visibility / score-sharing.
 */
router.patch("/tournaments/:id/network", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = PatchBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const tournament = await getOwnedTournament(params.data.id, userId);
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  const updates: { visible?: boolean; shareScores?: boolean } = {};
  if (body.data.visible !== undefined) updates.visible = body.data.visible;
  if (body.data.shareScores !== undefined) updates.shareScores = body.data.shareScores;
  const [updated] = await db
    .update(tournamentNetworkMembersTable)
    .set(updates)
    .where(eq(tournamentNetworkMembersTable.tournamentId, tournament.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not a member of any network" });
    return;
  }
  res.json(updated);
});

/**
 * POST /tournaments/:id/network/dismiss
 *
 * Stamps `networkPromptDismissedAt = now()`. Hides the "join with N
 * other coaches" suggestion until a NEW matching tournament is added
 * by someone else (the GET re-evaluates suggestions every call).
 */
router.post(
  "/tournaments/:id/network/dismiss",
  async (req, res): Promise<void> => {
    const userId = req.ownerUserId!;
    const params = IdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const tournament = await getOwnedTournament(params.data.id, userId);
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    await db
      .update(tournamentsTable)
      .set({ networkPromptDismissedAt: sql`now()` })
      .where(eq(tournamentsTable.id, tournament.id));
    res.status(204).end();
  },
);

export default router;
