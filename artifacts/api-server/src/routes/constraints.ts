import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import { db, lineupConstraintsTable, playersTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { AI_MODEL, createChatCompletion } from "../lib/ai";
import { getOwnedPlayer } from "../lib/ownership";
import { chargeAiCall } from "../lib/ai-usage";

const router: IRouter = Router();
router.use("/constraints", gateWrites("full"));

const CreateConstraintSchema = z.object({
  type: z.string(),
  playerId: z.number().int().nullable().optional(),
  position: z.string().nullable().optional(),
  rule: z.string(),
  value: z.number().int().nullable().optional(),
  description: z.string(),
  aiInput: z.string().nullable().optional(),
  active: z.boolean().optional().default(true),
});

router.get("/constraints", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const constraints = await db
    .select({
      id: lineupConstraintsTable.id,
      type: lineupConstraintsTable.type,
      playerId: lineupConstraintsTable.playerId,
      position: lineupConstraintsTable.position,
      rule: lineupConstraintsTable.rule,
      value: lineupConstraintsTable.value,
      description: lineupConstraintsTable.description,
      aiInput: lineupConstraintsTable.aiInput,
      active: lineupConstraintsTable.active,
      createdAt: lineupConstraintsTable.createdAt,
      playerName: playersTable.name,
    })
    .from(lineupConstraintsTable)
    .leftJoin(playersTable, eq(lineupConstraintsTable.playerId, playersTable.id))
    .where(eq(lineupConstraintsTable.userId, userId))
    .orderBy(lineupConstraintsTable.createdAt);
  res.json(constraints);
});

router.post("/constraints", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = CreateConstraintSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid constraint", details: parsed.error.flatten() });
    return;
  }
  // If a playerId was provided, it must belong to this coach.
  if (parsed.data.playerId != null) {
    const owned = await getOwnedPlayer(userId, parsed.data.playerId);
    if (!owned) {
      res.status(400).json({ error: "Unknown player." });
      return;
    }
  }
  const [constraint] = await db
    .insert(lineupConstraintsTable)
    .values({ ...parsed.data, userId })
    .returning();
  res.status(201).json(constraint);
});

router.patch("/constraints/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const id = parseInt(req.params.id);
  const { active } = req.body;
  const [updated] = await db
    .update(lineupConstraintsTable)
    .set({ active })
    .where(and(eq(lineupConstraintsTable.id, id), eq(lineupConstraintsTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Constraint not found" });
    return;
  }
  res.json(updated);
});

router.delete("/constraints/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const id = parseInt(req.params.id);
  const result = await db
    .delete(lineupConstraintsTable)
    .where(and(eq(lineupConstraintsTable.id, id), eq(lineupConstraintsTable.userId, userId)))
    .returning();
  if (result.length === 0) {
    res.status(404).json({ error: "Constraint not found" });
    return;
  }
  res.status(204).send();
});

// AI parse natural language constraint
router.post("/constraints/parse", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const { input } = req.body;
  if (!input || typeof input !== "string") {
    res.status(400).json({ error: "input required" });
    return;
  }

  // Only show the LLM this coach's roster so it can never resolve names to
  // another coach's player ids.
  const players = await db
    .select()
    .from(playersTable)
    .where(
      and(
        eq(playersTable.userId, userId),
        eq(playersTable.active, true),
        isNull(playersTable.deletedAt),
      ),
    );
  const charge = await chargeAiCall(req, "lineup-constraints");
  if (!charge.ok) { res.status(charge.status).json({ error: charge.error }); return; }

  const playerList = players.map((p) => `${p.id}: ${p.name}`).join("\n");
  // Include the optional LCF/RCF; coaches running a 10-player field may
  // express constraints against those slots.
  const positions = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "CF", "RCF", "RF"];

  const systemPrompt = `You are a baseball lineup rules assistant. Parse the user's natural language input into one OR MORE structured rules.

The user may describe several distinct rules in a single message — separated by periods, newlines, commas, "and", "also", semicolons, or bullets. Treat each distinct rule as its own object. Combine clauses that describe the same single rule (e.g. "Jake can pitch but only in late innings" is one rule).

Roster:
${playerList}

Available positions: ${positions.join(", ")}

Return ONLY a JSON object (no markdown) of the form:
{ "constraints": [ <rule>, <rule>, ... ] }

Each <rule> has these fields:
{
  "type": one of ["player_must_play", "player_cannot_play", "player_min_field", "player_bench_first", "player_bench_last", "global_max_bench", "global_max_position", "global_min_field", "global_rotate_pitcher", "global_ensure_positions", "global_no_bench_two_of_three"],
  "playerId": number or null (match player by name from roster, null for global rules),
  "position": string or null (one of the positions above, null if not position-specific),
  "rule": "must" | "must_not" | "min" | "max" | "on" | "off" | "first" | "last",
  "value": number or null (for min/max rules),
  "description": "clear human-readable description of this rule"
}

Examples:
- Input: "Jake can't pitch"
  → { "constraints": [ { "type": "player_cannot_play", "playerId": <jake's id>, "position": "P", "rule": "must_not", "value": null, "description": "Jake cannot pitch" } ] }
- Input: "Jake can't pitch. Tyler must play shortstop. Max 2 bench innings."
  → { "constraints": [
       { "type": "player_cannot_play", "playerId": <jake's id>, "position": "P", "rule": "must_not", "value": null, "description": "Jake cannot pitch" },
       { "type": "player_must_play", "playerId": <tyler's id>, "position": "SS", "rule": "must", "value": null, "description": "Tyler must play shortstop" },
       { "type": "global_max_bench", "playerId": null, "position": null, "rule": "max", "value": 2, "description": "Max 2 innings on bench" }
     ] }

Return only the JSON object. Always include the "constraints" array, even for a single rule.`;

  const response = await createChatCompletion({
    model: AI_MODEL,
    max_completion_tokens: 1500,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: input },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    let list: unknown[] = [];
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.constraints)) {
        list = obj.constraints;
      } else if (typeof obj.type === "string") {
        list = [obj];
      }
    }
    if (list.length === 0) {
      res.status(422).json({ error: "Could not parse any rules from input", raw });
      return;
    }
    const constraints = list.map((c) => ({ ...(c as Record<string, unknown>), aiInput: input }));
    res.json({ constraints });
  } catch {
    res.status(422).json({ error: "Could not parse AI response", raw });
  }
});

export default router;
