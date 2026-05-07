import type { Request } from "express";
import { and, count, eq, gte } from "drizzle-orm";
import { db, aiUsageLogTable } from "@workspace/db";
import { isMasterAdmin } from "./permissions";

/**
 * Per-team daily ceiling on AI requests. Sized to comfortably cover a
 * busy game day (lineup gen + assistant chat + box-score import + a
 * practice plan + a few help asks ≈ 30 calls) with plenty of headroom.
 * Tunable at runtime via the `AI_DAILY_TEAM_BUDGET` env var without a
 * code deploy. Exists primarily to contain runaway loops or a single
 * over-eager test coach — legitimate use should never trip it.
 */
export const AI_DAILY_TEAM_BUDGET: number = (() => {
  const raw = process.env.AI_DAILY_TEAM_BUDGET;
  if (!raw) return 150;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 150;
})();

export type AiChargeResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Reserve `units` AI requests for the current team and log them. Returns
 * `{ ok: false, status: 429 }` when the team has already burned through
 * its daily budget. Master admins are exempt (they're debugging the
 * system) and intentionally NOT recorded — their calls would inflate the
 * usage dashboard with noise that doesn't reflect actual customer load.
 *
 * Mount AFTER `requireAuth` + `resolveTeamContext` so both
 * `req.userId` and `req.ownerUserId` are populated.
 *
 * Pass `units` > 1 for routes that fan out into multiple OpenAI calls
 * for a single user action (e.g. box-score import sends one request
 * per uploaded screenshot). The whole batch is checked against the cap
 * up-front and either fully charged or fully rejected — partial
 * fulfilment would be confusing and produce a half-result anyway.
 */
export async function chargeAiCall(
  req: Request,
  feature: string,
  units: number = 1,
): Promise<AiChargeResult> {
  const ownerUserId = req.ownerUserId;
  const callerUserId = req.userId;
  if (!ownerUserId || !callerUserId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (units <= 0) return { ok: true };

  if (isMasterAdmin(callerUserId)) {
    // Exempt + unlogged. Skip both the budget read and the insert.
    return { ok: true };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [usedRow] = await db
    .select({ n: count(aiUsageLogTable.id) })
    .from(aiUsageLogTable)
    .where(
      and(
        eq(aiUsageLogTable.ownerUserId, ownerUserId),
        gte(aiUsageLogTable.createdAt, since),
      ),
    );
  const used = Number(usedRow?.n ?? 0);
  if (used + units > AI_DAILY_TEAM_BUDGET) {
    return {
      ok: false,
      status: 429,
      error: `This team has reached its AI usage limit (${AI_DAILY_TEAM_BUDGET} requests in the last 24 hours). Try again later, or contact the app owner if you need more.`,
    };
  }

  await db.insert(aiUsageLogTable).values(
    Array.from({ length: units }, () => ({
      ownerUserId,
      callerUserId,
      feature,
    })),
  );
  return { ok: true };
}
