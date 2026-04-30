import { Router, type IRouter } from "express";
import { db, lineupConstraintsTable, playersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

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

router.get("/constraints", async (_req, res): Promise<void> => {
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
    .orderBy(lineupConstraintsTable.createdAt);
  res.json(constraints);
});

router.post("/constraints", async (req, res): Promise<void> => {
  const parsed = CreateConstraintSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid constraint", details: parsed.error.flatten() });
    return;
  }
  const [constraint] = await db.insert(lineupConstraintsTable).values(parsed.data).returning();
  res.status(201).json(constraint);
});

router.patch("/constraints/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const { active } = req.body;
  const [updated] = await db
    .update(lineupConstraintsTable)
    .set({ active })
    .where(eq(lineupConstraintsTable.id, id))
    .returning();
  res.json(updated);
});

router.delete("/constraints/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  await db.delete(lineupConstraintsTable).where(eq(lineupConstraintsTable.id, id));
  res.status(204).send();
});

// AI parse natural language constraint
router.post("/constraints/parse", async (req, res): Promise<void> => {
  const { input } = req.body;
  if (!input || typeof input !== "string") {
    res.status(400).json({ error: "input required" });
    return;
  }

  const players = await db.select().from(playersTable).where(eq(playersTable.active, true));
  const playerList = players.map((p) => `${p.id}: ${p.name}`).join("\n");
  const positions = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

  const systemPrompt = `You are a baseball lineup rules assistant. Parse the user's natural language constraint into a structured JSON object.

Roster:
${playerList}

Available positions: ${positions.join(", ")}

Return a JSON object (no markdown) with these fields:
{
  "type": one of ["player_must_play", "player_cannot_play", "player_min_field", "player_bench_first", "player_bench_last", "global_max_bench", "global_max_position", "global_min_field", "global_rotate_pitcher", "global_ensure_positions", "global_no_bench_two_of_three"],
  "playerId": number or null (match player by name from roster, null for global rules),
  "position": string or null (one of the positions above, null if not position-specific),
  "rule": "must" | "must_not" | "min" | "max" | "on" | "off" | "first" | "last",
  "value": number or null (for min/max rules),
  "description": "clear human-readable description of this rule"
}

Examples:
- "Jake can't pitch" → type: player_cannot_play, playerId: <jake's id>, position: "P", rule: "must_not"
- "Make sure everyone plays infield at least once" → type: global_min_field, rule: "min", value: 1
- "Max 2 innings on bench" → type: global_max_bench, rule: "max", value: 2
- "Tyler must play shortstop" → type: player_must_play, playerId: <tyler's id>, position: "SS", rule: "must"
- "Rotate the pitcher every inning" → type: global_rotate_pitcher, rule: "on"
- "No one sits more than once every 3 innings" → type: global_no_bench_two_of_three, rule: "on"

Return only the JSON object.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 512,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: input },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    res.json({ ...parsed, aiInput: input });
  } catch {
    res.status(422).json({ error: "Could not parse AI response", raw });
  }
});

export default router;
