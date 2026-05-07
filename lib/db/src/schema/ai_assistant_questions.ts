import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";

/**
 * Per-question log of every prompt sent to the in-app AI Assistant
 * (`POST /api/games/:id/ai-assistant`). Distinct from `ai_usage_log`,
 * which only records call metadata for budget enforcement — this table
 * keeps the actual coach-typed message + model intent + short response
 * preview so the master-admin dashboard can see what coaches are asking
 * the assistant in the wild. That visibility is the basis for spotting
 * UX gaps ("everyone asks the same thing every game"), bad model
 * answers, and prompt-injection attempts.
 *
 * Storage notes:
 *   - `question` capped to 1000 chars on the route side (see
 *     ai-assistant.ts BodySchema), so this column is comfortably small.
 *   - `responsePreview` is the first ~280 chars of the assistant's
 *     answer/explanation — full answer not stored to keep this table
 *     light and to limit how much PII we keep around.
 *   - `intent` is the model-classified intent ("answer" | "regenerate"
 *     | "remove" | "error"). Free-form text on the DB side so we can
 *     add new intents without a migration.
 *   - `ownerUserId` = the team being acted on (the data tenant);
 *     `askedByUserId` = the actual signed-in coach (may differ on
 *     multi-coach teams). Master-admin calls are still logged — unlike
 *     ai_usage_log — because the admin tab is the consumer here and
 *     coaching against your own team is exactly the dogfood signal we
 *     want to keep.
 */
export const aiAssistantQuestionsTable = pgTable(
  "ai_assistant_questions",
  {
    id: serial("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    askedByUserId: text("asked_by_user_id").notNull(),
    gameId: integer("game_id"),
    question: text("question").notNull(),
    intent: text("intent").notNull(),
    responsePreview: text("response_preview"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("ai_assistant_questions_created_idx").on(t.createdAt),
    ownerCreatedIdx: index("ai_assistant_questions_owner_created_idx").on(
      t.ownerUserId,
      t.createdAt,
    ),
  }),
);

export type AiAssistantQuestionRow = typeof aiAssistantQuestionsTable.$inferSelect;
