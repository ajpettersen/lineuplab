import { and, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import {
  db,
  gamesTable,
  pushSubscriptionsTable,
  teamSettingsTable,
} from "@workspace/db";
import { sendPushToSubscription, pushEnabled } from "./push";
import { logger } from "./logger";

/**
 * GameChanger box-score reminder scheduler.
 *
 * Runs every 5 minutes (cheap query, single index scan on games). For
 * each team that has `usesGameChanger=true`, finds games where:
 *   - status != 'cancelled' AND deletedAt IS NULL
 *   - boxScoreImportedAt IS NULL
 *   - boxScoreReminderSentAt IS NULL  (single fire per game)
 *   - now() is between gameDate + 2h and gameDate + 7d
 *
 * For each match, fans out a push notification to every device the
 * subscribers on that team have registered. Sets
 * boxScoreReminderSentAt = now() in the SAME tick (after we've kicked
 * off the sends but before the next scheduler run) so a slow push
 * provider doesn't cause us to re-fire on the next tick.
 *
 * The 7-day upper bound stops a coach who toggles GameChanger on
 * months after a game from getting nagged about ancient history. The
 * 2-hour lower bound is the user-asked offset — typical youth game
 * runs ~90 minutes; 2h gives the coach time to drive home before the
 * phone buzzes.
 *
 * Designed to be safe to call concurrently with itself (idempotent
 * via the boxScoreReminderSentAt update) and safe when push is
 * disabled (early-returns).
 */

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runBoxScoreReminderTickOnce(): Promise<void> {
  if (!pushEnabled) return;
  if (running) return; // single-flight guard
  running = true;
  try {
    const now = Date.now();
    const lowerBound = new Date(now - SEVEN_DAYS_MS);
    const upperBound = new Date(now - TWO_HOURS_MS);

    // 1) Find candidate games. Join team_settings so we only consider
    //    teams that have GameChanger enabled — saves blasting pushes
    //    to teams that opted out of the dashboard task too.
    const candidates = await db
      .select({
        gameId: gamesTable.id,
        ownerUserId: gamesTable.userId,
        opponent: gamesTable.opponent,
        gameDate: gamesTable.gameDate,
      })
      .from(gamesTable)
      .innerJoin(
        teamSettingsTable,
        eq(teamSettingsTable.userId, gamesTable.userId),
      )
      .where(
        and(
          eq(teamSettingsTable.usesGameChanger, true),
          eq(gamesTable.type, "game"),
          ne(gamesTable.status, "cancelled"),
          isNull(gamesTable.deletedAt),
          isNull(gamesTable.boxScoreImportedAt),
          isNull(gamesTable.boxScoreReminderSentAt),
          lte(gamesTable.gameDate, upperBound),
          gte(gamesTable.gameDate, lowerBound),
        ),
      )
      .limit(200);

    if (candidates.length === 0) return;

    logger.info(
      { count: candidates.length },
      "box-score reminder: candidates found",
    );

    for (const c of candidates) {
      // 2) Mark sent FIRST (single-row UPDATE with the same null guard
      //    so a second concurrent tick can't double-send). If 0 rows
      //    update, another worker grabbed it — skip.
      const claimed = await db
        .update(gamesTable)
        .set({ boxScoreReminderSentAt: new Date() })
        .where(
          and(
            eq(gamesTable.id, c.gameId),
            isNull(gamesTable.boxScoreReminderSentAt),
          ),
        )
        .returning({ id: gamesTable.id });
      if (claimed.length === 0) continue;

      // 3) Fan out to every subscription registered against this team
      //    scope. teamOwnerUserId on the subscription matches the
      //    game's userId (which IS the owner scope).
      const subs = await db
        .select()
        .from(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.teamOwnerUserId, c.ownerUserId));

      if (subs.length === 0) {
        // Nobody to notify — that's fine, mark-sent stays so we don't
        // keep re-querying this game forever.
        continue;
      }

      const url = `/games/${c.gameId}`;
      const opponentLabel = c.opponent ? ` vs. ${c.opponent}` : "";
      const payload = {
        title: "Upload your box score",
        body: `Game${opponentLabel} wrapped — tap to import the GameChanger box score.`,
        url,
        tag: `box-score-${c.gameId}`,
      } as const;

      const results = await Promise.allSettled(
        subs.map((s) => sendPushToSubscription(s, payload)),
      );
      const sent = results.filter(
        (r) => r.status === "fulfilled" && r.value === "sent",
      ).length;
      logger.info(
        { gameId: c.gameId, subs: subs.length, sent },
        "box-score reminder: dispatched",
      );
    }
  } catch (err) {
    logger.error({ err }, "box-score reminder tick failed");
  } finally {
    running = false;
  }
}

export function startBoxScoreReminderScheduler(): void {
  if (timer) return;
  if (!pushEnabled) {
    logger.info(
      "box-score reminder scheduler not started (push disabled)",
    );
    return;
  }
  // Fire once shortly after boot (lets the first reminder go out within
  // ~30s of server start instead of waiting a full 5 min cycle), then
  // settle into the 5-minute cadence.
  setTimeout(() => {
    void runBoxScoreReminderTickOnce();
  }, 30 * 1000);
  timer = setInterval(() => {
    void runBoxScoreReminderTickOnce();
  }, FIVE_MINUTES_MS);
  // Don't keep the event loop alive on graceful shutdown.
  if (typeof timer.unref === "function") timer.unref();
  logger.info(
    { intervalMs: FIVE_MINUTES_MS },
    "box-score reminder scheduler started",
  );
}
