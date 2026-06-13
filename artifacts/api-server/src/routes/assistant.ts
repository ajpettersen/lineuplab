import { Router, type IRouter } from "express";
import { z } from "zod";
import { chargeAiCall } from "../lib/ai-usage";
import { runTeamAssistant } from "../lib/team-assistant";

/**
 * Season-wide "Ask Lineup Lab" assistant endpoint. READ-ONLY: it answers
 * general + team-data questions via the tool-calling loop in
 * `lib/team-assistant.ts`. No write gate — any authenticated coach (even the
 * lowest `view` tier) may ask questions; the tools only read this coach's
 * team data (scoped to `req.ownerUserId`). Mounted under the global
 * `requireAuth` + `resolveTeamContext` so `ownerUserId` is populated.
 */
const router: IRouter = Router();

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2000),
});

const BodySchema = z.object({
  // Full conversation so far (multi-turn chat). The last message must be
  // from the user. Capped to keep the prompt — and cost — bounded.
  messages: z.array(MessageSchema).min(1).max(24),
});

router.post("/assistant", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const body = BodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A non-empty messages array is required" });
    return;
  }
  const messages = body.data.messages;
  if (messages[messages.length - 1]!.role !== "user") {
    res.status(400).json({ error: "The last message must be from the user" });
    return;
  }

  const charge = await chargeAiCall(req, "assistant");
  if (!charge.ok) {
    res.status(charge.status).json({ error: charge.error });
    return;
  }

  try {
    const result = await runTeamAssistant({ userId, messages, log: req.log });
    res.json({ text: result.text, toolsUsed: result.toolsUsed });
  } catch (err) {
    req.log.error({ err }, "Team assistant call failed");
    res.status(502).json({ error: "AI service unavailable" });
  }
});

export default router;
