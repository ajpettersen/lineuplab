import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * One row per OpenAI request the app makes on a team's behalf. Used for:
 *   - Per-team daily budget enforcement (count rows in last 24 h).
 *   - Master-admin "AI usage" dashboard (which teams are spending what).
 *
 * `ownerUserId` is the team scope (the data tenant being acted on).
 * `callerUserId` is the actual signed-in coach who triggered the call;
 * may differ when an assistant coach hits an AI button on the head
 * coach's team. We index on (ownerUserId, createdAt) because every
 * read either filters on ownerUserId + a recent time window (budget
 * check) or aggregates across all teams over a recent window (admin
 * dashboard).
 *
 * Master-admin calls are NOT logged here (they're exempt from budget
 * enforcement and would only inflate the dashboard with debug noise).
 */
export const aiUsageLogTable = pgTable(
  "ai_usage_log",
  {
    id: serial("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    callerUserId: text("caller_user_id").notNull(),
    /**
     * Short kebab-case label for the feature that made the call, e.g.
     * `lineup-image`, `roster-import`, `box-score`, `ai-assistant`,
     * `practice-plan`, `help`, `lineup-constraints`, `batting-import`.
     * Free-form on the DB side; the app picks consistent values.
     */
    feature: text("feature").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerCreatedIdx: index("ai_usage_log_owner_created_idx").on(
      t.ownerUserId,
      t.createdAt,
    ),
    createdIdx: index("ai_usage_log_created_idx").on(t.createdAt),
  }),
);

export type AiUsageLogRow = typeof aiUsageLogTable.$inferSelect;
