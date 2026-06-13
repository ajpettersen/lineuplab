import OpenAI, { APIError } from "openai";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

/**
 * Single source of truth for the chat model. Swapping models (e.g. when
 * the current one is retired) is a one-line change here instead of editing
 * every route that talks to the API.
 */
export const AI_MODEL = "gpt-5.2";

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

/**
 * Optional tuning knobs we're willing to DROP and retry without when a
 * model rejects them. Every entry must be a parameter whose absence simply
 * falls back to a model default WITHOUT changing the shape of the response
 * we parse — e.g. `response_format` is intentionally NOT here, because
 * losing it could turn structured output into prose we can't parse.
 *
 * Why: model upgrades periodically change which values a parameter accepts
 * (e.g. `reasoning_effort` dropped "minimal"). Rather than throwing a 502
 * in a coach's face mid-game, we peel the offending knob off and retry so
 * the feature keeps working on the model's default.
 */
const DROPPABLE_PARAMS = new Set<keyof ChatParams>([
  "reasoning_effort",
  "verbosity",
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "service_tier",
]);

function unsupportedParam(err: unknown): string | null {
  if (
    err instanceof APIError &&
    (err.code === "unsupported_value" || err.code === "unsupported_parameter") &&
    typeof err.param === "string"
  ) {
    return err.param;
  }
  return null;
}

/**
 * Drop-in replacement for `openai.chat.completions.create` that:
 *   1. defaults `model` to {@link AI_MODEL} so callers don't hardcode it, and
 *   2. gracefully retries without any single tuning parameter a future
 *      model rejects (see {@link DROPPABLE_PARAMS}).
 *
 * Any error that isn't a droppable-parameter rejection is rethrown
 * unchanged, so each caller's existing error handling still applies.
 */
export async function createChatCompletion(
  params: Omit<ChatParams, "model"> & { model?: string },
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  let attempt: ChatParams = { model: AI_MODEL, ...params } as ChatParams;

  // Bounded so we can peel off several independently-rejected knobs but
  // never loop forever.
  for (let i = 0; i <= DROPPABLE_PARAMS.size; i++) {
    try {
      return await openai.chat.completions.create(attempt);
    } catch (err) {
      const param = unsupportedParam(err);
      if (
        param &&
        param in attempt &&
        DROPPABLE_PARAMS.has(param as keyof ChatParams)
      ) {
        const { [param as keyof ChatParams]: _dropped, ...rest } = attempt;
        attempt = rest as ChatParams;
        logger.warn(
          { param, model: attempt.model },
          "AI parameter rejected by model; retrying without it",
        );
        continue;
      }
      throw err;
    }
  }

  // Retry budget exhausted (every droppable knob peeled). Make one final
  // attempt so the genuine error — if any — surfaces to the caller.
  return openai.chat.completions.create(attempt);
}
