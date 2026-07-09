import type { NextFunction, Request, Response } from "express";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, idempotencyKeysTable } from "@workspace/db";

/**
 * Replay protection for offline-queued POST creates.
 *
 * Clients stamp queued creates with a client-generated UUID in the
 * `Idempotency-Key` header. First request through claims the key
 * (INSERT … ON CONFLICT DO NOTHING) and records the response body;
 * any replay of the same key short-circuits with the cached response
 * instead of creating a duplicate row. Requests WITHOUT the header
 * behave exactly as before.
 *
 * Semantics:
 *   - Keys are scoped to the AUTHENTICATED user (`req.userId`), not the
 *     team scope key, so keys can't be replayed across accounts.
 *   - Only 2xx responses are cached. A non-2xx outcome releases the
 *     claim so the client may retry the same key.
 *   - Claims are considered dead after CLAIM_STALE_MS without a stored
 *     response (handler crashed mid-flight) and can be re-claimed.
 *   - Rows expire after ~24h; expired rows are opportunistically pruned.
 */

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const CLAIM_STALE_MS = 60_000;
const TTL_MS = 24 * 60 * 60 * 1000;
const IN_FLIGHT_POLL_MS = 400;
const IN_FLIGHT_POLLS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pruneExpired(): Promise<void> {
  // Cheap opportunistic cleanup — ~5% of claiming requests pay one
  // indexed DELETE. Traffic is low; the table stays tiny.
  if (Math.random() > 0.05) return;
  await db
    .delete(idempotencyKeysTable)
    .where(lt(idempotencyKeysTable.createdAt, new Date(Date.now() - TTL_MS)));
}

/**
 * Express middleware. Mount on POST create routes AFTER requireAuth:
 *
 *   router.post("/games", idempotent("createGame"), handler)
 */
export function idempotent(routeName: string) {
  return async function idempotencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const key = req.header("idempotency-key");
    if (!key) {
      next();
      return;
    }
    const userId = req.userId;
    if (!userId) {
      // requireAuth should have run first; without a user we can't
      // scope the key safely, so fall through without idempotency.
      next();
      return;
    }
    if (!KEY_RE.test(key)) {
      res.status(400).json({
        error: "Invalid Idempotency-Key header — expected 8-128 url-safe characters",
      });
      return;
    }

    void pruneExpired().catch(() => {});

    const keyWhere = and(
      eq(idempotencyKeysTable.userId, userId),
      eq(idempotencyKeysTable.key, key),
    );

    // Try to claim the key. responseStatus=0 marks an in-flight claim.
    const claimed = await db
      .insert(idempotencyKeysTable)
      .values({ userId, key, route: routeName, responseStatus: 0 })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeysTable.key });

    if (claimed.length === 0) {
      // Someone holds (or held) this key. Replay the cached response,
      // wait briefly for an in-flight sibling, or steal a dead claim.
      for (let i = 0; i < IN_FLIGHT_POLLS; i++) {
        const [row] = await db
          .select()
          .from(idempotencyKeysTable)
          .where(keyWhere);
        if (!row) {
          // Prior attempt failed and released its claim — re-claim.
          const reclaimed = await db
            .insert(idempotencyKeysTable)
            .values({ userId, key, route: routeName, responseStatus: 0 })
            .onConflictDoNothing()
            .returning({ key: idempotencyKeysTable.key });
          if (reclaimed.length > 0) {
            attachCapture(req, res, keyWhere);
            next();
            return;
          }
          continue; // lost the race again — loop
        }
        if (row.responseStatus > 0) {
          res.setHeader("Idempotency-Replayed", "true");
          res.status(row.responseStatus).json(row.responseBody);
          return;
        }
        // In-flight claim. Steal it if it's dead (handler crashed).
        if (row.createdAt.getTime() < Date.now() - CLAIM_STALE_MS) {
          const stolen = await db
            .update(idempotencyKeysTable)
            .set({ createdAt: sql`now()` })
            .where(
              and(keyWhere, eq(idempotencyKeysTable.responseStatus, 0)),
            )
            .returning({ key: idempotencyKeysTable.key });
          if (stolen.length > 0) {
            attachCapture(req, res, keyWhere);
            next();
            return;
          }
          continue;
        }
        await sleep(IN_FLIGHT_POLL_MS);
      }
      res.status(409).json({
        error:
          "An identical request is still being processed. Please retry in a moment.",
        code: "idempotency_in_flight",
      });
      return;
    }

    attachCapture(req, res, keyWhere);
    next();
  };
}

/**
 * Wrap res.json to persist the outcome under the claimed key:
 * 2xx → cache body for replays; anything else → release the claim so
 * the client may retry. Also releases on close-without-json.
 */
function attachCapture(
  req: Request,
  res: Response,
  keyWhere: ReturnType<typeof and>,
): void {
  let settled = false;
  const origJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (!settled) {
      settled = true;
      const status = res.statusCode;
      if (status >= 200 && status < 300) {
        void db
          .update(idempotencyKeysTable)
          .set({ responseStatus: status, responseBody: body ?? null })
          .where(keyWhere)
          .catch((err: unknown) => {
            req.log?.error({ err }, "idempotency: failed to store response");
          });
      } else {
        void db
          .delete(idempotencyKeysTable)
          .where(keyWhere)
          .catch(() => {});
      }
    }
    return origJson(body as never);
  };
  res.on("close", () => {
    if (!settled) {
      settled = true;
      // Handler ended without a JSON body (crash / non-json response) —
      // release the claim so a retry can run the route for real.
      void db.delete(idempotencyKeysTable).where(keyWhere).catch(() => {});
    }
  });
}
