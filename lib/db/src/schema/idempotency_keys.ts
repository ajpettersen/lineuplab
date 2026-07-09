import { pgTable, text, timestamp, jsonb, integer, primaryKey, index } from "drizzle-orm/pg-core";

/**
 * Replay-protection for offline-queued POST creates.
 *
 * Offline clients stamp each queued create with a client-generated UUID
 * `Idempotency-Key` header. The api-server middleware records the first
 * successful response here keyed by (userId, key); a replay of the same
 * key short-circuits with the cached response instead of creating a
 * duplicate row (flaky-WiFi retries, two drainers, reload replays).
 *
 * Rows are useful for ~24h (long enough to cover an overnight offline
 * period); the middleware opportunistically deletes expired rows so the
 * table doesn't grow forever. Keyed by the AUTHENTICATED userId — not
 * the team scope key — so a key can't be replayed across users.
 */
export const idempotencyKeysTable = pgTable(
  "idempotency_keys",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    route: text("route").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.key] }),
    index("idempotency_keys_created_at_idx").on(table.createdAt),
  ],
);

export type IdempotencyKeyRow = typeof idempotencyKeysTable.$inferSelect;
