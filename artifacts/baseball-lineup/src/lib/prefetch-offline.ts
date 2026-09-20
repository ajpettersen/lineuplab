import type { QueryClient } from "@tanstack/react-query";
import {
  getListGamesQueryOptions,
  getListPlayersQueryOptions,
  getGetGameQueryOptions,
  getGetGameLineupQueryOptions,
  getGetGamePitchCountsQueryOptions,
  getGetTournamentQueryOptions,
  getListDashboardTasksQueryOptions,
  getListPracticesQueryOptions,
  getGetTeamSettingsQueryOptions,
  getGetPreferencesQueryOptions,
  getGetSeasonStatsQueryOptions,
  getGetPlayerStatsQueryOptions,
  getListTournamentsQueryOptions,
  type Game,
} from "@workspace/api-client-react";
import { getPendingWriteGameIds } from "./offline-queue";
import {
  armWatchQuery,
  battingStatsQuery,
  historicalFieldingQuery,
  pitchingStatsQuery,
} from "./extra-queries";

/**
 * Warm the offline cache so a coach can walk from the schedule straight
 * into the Field Display of an upcoming game with NO connection.
 *
 * The app already persists the React Query cache to IndexedDB (see
 * query-persister.ts, 14-day maxAge) and the service worker precaches
 * the app shell — so anything a coach OPENED while online is available
 * offline. The gap this closes: data for games the coach never tapped
 * into. This runs while online and proactively fetches the games/roster
 * list plus, for every game in the warm window, the same per-game
 * queries the Field Display and game-detail pages read (game, lineup,
 * pitch counts) and any parent tournament — populating the EXACT cache
 * keys those pages consume (we reuse the generated query options, so the
 * keys/queryFns match identically). Once warmed and persisted, the pages
 * render from cache offline.
 *
 * Bounded on purpose: we don't blindly fetch the entire history. We warm
 * every not-yet-completed game (the ones a coach will actually open at a
 * field) plus recently completed games inside RECENT_WINDOW_DAYS, capped
 * at MAX_GAMES, fetched with a small concurrency limit so we never flood
 * the API. prefetchQuery is a no-op when fresh data already sits in the
 * cache, so repeated runs (boot + every reconnect) are cheap.
 */

/**
 * Dispatched on `window` by OnlineResumer AFTER it has drained the
 * offline write queue (and, on reconnect, invalidated queries). The
 * prefetcher waits for this instead of listening to the raw `online`
 * event so a warm GET can never land before a coach's queued offline
 * edits are flushed — otherwise the GET would cache pre-drain server
 * state and silently clobber the optimistic Field Display cache.
 */
export const OFFLINE_RESUME_COMPLETE_EVENT = "ll:offline-resume-complete";

// How far back to keep completed games warm. Covers a tournament
// weekend plus the recovery week, matching the persister's maxAge.
const RECENT_WINDOW_DAYS = 14;
// Hard ceiling on how many games we warm in one pass, so a coach with a
// huge season history doesn't trigger dozens of requests on every boot.
const MAX_GAMES = 60;
// How many per-game prefetches run at once.
const CONCURRENCY = 4;
// Treat data fetched within this window as fresh enough to skip, so a
// reconnect right after boot doesn't re-fetch everything.
const PREFETCH_STALE_MS = 5 * 60 * 1000;

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

/**
 * Closest-to-now first (past or future), so today's and tomorrow's games
 * warm before distant ones. Critical when the schedule exceeds MAX_GAMES:
 * the cap then drops only far-off games, never the imminent ones a coach
 * is about to open at a field.
 */
function byProximityToNow(now: number) {
  return (a: Game, b: Game): number => {
    const da = Math.abs(new Date(a.gameDate).getTime() - now);
    const db = Math.abs(new Date(b.gameDate).getTime() - now);
    return da - db;
  };
}

/**
 * Pick which games to warm: all real games (not practices/other) that
 * are either not yet completed, or completed within RECENT_WINDOW_DAYS,
 * prioritized by proximity to now and capped at MAX_GAMES.
 */
function selectGames(games: Game[]): Game[] {
  const now = Date.now();
  const cutoff = now - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return games
    .filter((g) => g.type === "game")
    .filter((g) => {
      if (g.status !== "completed") return true;
      const t = new Date(g.gameDate).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort(byProximityToNow(now))
    .slice(0, MAX_GAMES);
}

/** Run async tasks with a fixed concurrency, swallowing individual failures. */
async function runWithConcurrency(
  tasks: Array<() => Promise<unknown>>,
  limit: number,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      try {
        await task();
      } catch {
        // A single failed prefetch (e.g. a flaky request mid-walk to the
        // dugout) must not abort warming the rest of the schedule.
      }
    }
  });
  await Promise.all(workers);
}

let inFlight: Promise<void> | null = null;

/**
 * Prefetch offline data. Safe to call repeatedly (boot + every
 * reconnect); concurrent calls share one in-flight pass.
 */
export function prefetchOfflineData(qc: QueryClient): Promise<void> {
  if (!isOnline()) return Promise.resolve();
  if (inFlight) return inFlight;

  inFlight = (async () => {
    // Top-level surfaces a coach lands on after a cold offline launch:
    // roster, dashboard, practices, settings/preferences, season stats,
    // and the tournaments list. Warming these means the whole app shell
    // has data to render with zero bars — not just the game pages.
    void qc.prefetchQuery({ ...getListPlayersQueryOptions(), staleTime: PREFETCH_STALE_MS });
    void qc.prefetchQuery({ ...getListDashboardTasksQueryOptions(), staleTime: PREFETCH_STALE_MS });
    void qc.prefetchQuery({ ...getListPracticesQueryOptions(), staleTime: PREFETCH_STALE_MS });
    void qc.prefetchQuery({ ...getGetTeamSettingsQueryOptions(), staleTime: PREFETCH_STALE_MS });
    void qc.prefetchQuery({ ...getGetPreferencesQueryOptions(), staleTime: PREFETCH_STALE_MS });
    void qc.prefetchQuery({ ...getGetSeasonStatsQueryOptions(), staleTime: PREFETCH_STALE_MS });
    void qc.prefetchQuery({ ...getListTournamentsQueryOptions(), staleTime: PREFETCH_STALE_MS });
    // Season-long report pages. Small payloads, and without them a coach
    // who never opened Arm Watch / Rotation Report while online finds
    // them empty at a field.
    void qc.prefetchQuery({ ...getGetPlayerStatsQueryOptions(), staleTime: PREFETCH_STALE_MS });
    void qc.prefetchQuery({ ...armWatchQuery(), staleTime: PREFETCH_STALE_MS });
    void qc.prefetchQuery({ ...battingStatsQuery(), staleTime: PREFETCH_STALE_MS });
    void qc.prefetchQuery({ ...pitchingStatsQuery(), staleTime: PREFETCH_STALE_MS });
    void qc.prefetchQuery({ ...historicalFieldingQuery(), staleTime: PREFETCH_STALE_MS });

    let games: Game[];
    try {
      games = await qc.fetchQuery({
        ...getListGamesQueryOptions(),
        staleTime: PREFETCH_STALE_MS,
      });
    } catch {
      // No games list (offline flip mid-fetch, auth not ready) — nothing
      // to warm. The next reconnect retries.
      return;
    }

    const selected = selectGames(games);
    // Skip per-game warming for games with unsynced offline edits — a
    // server GET would clobber the coach's optimistic Field Display
    // cache. This makes prefetch inherently race-safe regardless of when
    // it runs relative to the offline-write drain: a game with a pending
    // write is excluded now, and re-warmed after its key drains (the
    // resume-complete signal re-runs this pass). Reading the set once
    // per pass is fine — a write staged mid-pass just gets warmed on the
    // next run.
    const pending = getPendingWriteGameIds();
    const tournamentIds = new Set<number>();
    const tasks: Array<() => Promise<unknown>> = [];

    for (const game of selected) {
      const id = game.id;
      // The parent tournament is never offline-edited, so warm it even
      // when the game itself is skipped for a pending write.
      if (game.tournamentId != null) tournamentIds.add(game.tournamentId);
      if (pending.has(id)) continue;
      tasks.push(() =>
        qc.prefetchQuery({
          ...getGetGameQueryOptions(id),
          staleTime: PREFETCH_STALE_MS,
        }),
      );
      tasks.push(() =>
        qc.prefetchQuery({
          ...getGetGameLineupQueryOptions(id),
          staleTime: PREFETCH_STALE_MS,
        }),
      );
      tasks.push(() =>
        qc.prefetchQuery({
          ...getGetGamePitchCountsQueryOptions(id),
          staleTime: PREFETCH_STALE_MS,
        }),
      );
    }

    for (const tid of tournamentIds) {
      tasks.push(() =>
        qc.prefetchQuery({
          ...getGetTournamentQueryOptions(tid),
          staleTime: PREFETCH_STALE_MS,
        }),
      );
    }

    await runWithConcurrency(tasks, CONCURRENCY);
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
