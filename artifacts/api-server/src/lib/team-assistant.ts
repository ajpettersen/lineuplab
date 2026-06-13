import type OpenAI from "openai";
import type { Logger } from "pino";
import { AI_MODEL, createChatCompletion } from "./ai";
import { ASSISTANT_TOOL_DEFS, executeAssistantTool } from "./assistant-tools";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Season-wide "Ask Lineup Lab" assistant. A bounded tool-calling loop: the
 * model answers general questions directly and, for anything team-specific
 * (roster, schedule, results, season stats, rotation/fairness, per-inning
 * history), calls the READ-ONLY data tools in `assistant-tools.ts`. All tools
 * are executed server-side with the coach's resolved `ownerUserId` injected —
 * the model never sees or supplies a userId, so data stays team-scoped.
 *
 * Read-only by design today; the loop is structured so write tools (lineup
 * generation/edits) can be added later behind a permission gate.
 */
const SYSTEM_PROMPT = `You are "Ask Lineup Lab", the AI assistant inside a youth baseball/softball coaching app.

You help the coach in two ways:
1. General help — answer coaching, baseball/softball, and app-usage questions directly and concisely.
2. Team data — answer questions about THIS coach's specific team using the provided tools.

When a question is about the coach's own roster, schedule, results, stats, playing time, or rotation/fairness, you MUST call the relevant tool(s) to get real data before answering — never guess or invent names, numbers, or results. You may call multiple tools and combine their results.

Tool guidance:
- get_roster — who's on the team, jersey numbers, preferred positions, who can pitch.
- get_games — schedule and results (scores, W/L/T).
- get_season_batting / get_season_pitching — season stat lines.
- get_rotation_report — playing-time fairness: bench rate and innings by position group across completed games.
- get_position_by_inning — per-player, per-inning position history. Use this for questions like "how many times has Dan been on the bench in the 1st inning?" (position "Bench" means they sat that inning).

Style: warm, concrete, and brief — a few sentences or a short list. Refer to players by name. Round rates to whole percents. If the data shows nothing (e.g. no completed games yet), say so plainly. If a named player can't be found on the roster, say you couldn't find them rather than guessing.

You currently cannot change any data (generate or edit lineups, edit rosters, etc.) — you are read-only. If asked to make a change, explain what you found and tell the coach where in the app to do it.`;

export interface TeamAssistantResult {
  text: string;
  toolsUsed: string[];
}

export async function runTeamAssistant(opts: {
  userId: string;
  messages: { role: "user" | "assistant"; content: string }[];
  log?: Logger;
  today?: string;
}): Promise<TeamAssistantResult> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const convo: ChatMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\nToday's date is ${today}.` },
    ...opts.messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];
  const toolsUsed: string[] = [];

  // Bounded so a misbehaving model can't loop forever calling tools.
  const MAX_TURNS = 6;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const completion = await createChatCompletion({
      model: AI_MODEL,
      max_completion_tokens: 1500,
      tools: ASSISTANT_TOOL_DEFS,
      messages: convo,
    });
    const msg = completion.choices[0]?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length > 0) {
      convo.push(msg);
      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = {};
        }
        toolsUsed.push(tc.function.name);
        let result: unknown;
        try {
          result = await executeAssistantTool(opts.userId, tc.function.name, args);
        } catch (err) {
          opts.log?.warn({ err, tool: tc.function.name }, "Assistant tool failed");
          result = { error: "That data lookup failed. Tell the coach you couldn't retrieve it." };
        }
        // Cap each tool payload so a huge roster/stat dump can't blow the
        // context window; tools already return compact shapes.
        convo.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }
      continue;
    }

    const text = msg.content?.trim();
    if (text) return { text, toolsUsed };
    break;
  }

  return {
    text: "I wasn't able to finish answering that — try rephrasing or asking something more specific.",
    toolsUsed,
  };
}
