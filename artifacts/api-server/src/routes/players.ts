import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import multer from "multer";
import { z } from "zod";
import { db, playersTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  CreatePlayerBody,
  GetPlayerParams,
  UpdatePlayerParams,
  UpdatePlayerBody,
  DeletePlayerParams,
} from "@workspace/api-zod";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const ALL_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;

const ExtractTextBodySchema = z.object({
  text: z.string().min(1).max(10000),
});

const BulkPlayerSchema = z.object({
  name: z.string().trim().min(1),
  number: z.number().int().min(0).max(999).nullable().optional(),
  // Accept any string array; we filter to known positions below so one bad code
  // from the AI doesn't reject the whole batch.
  eligiblePositions: z.array(z.string()).default([]),
  preferredPositions: z.array(z.string()).default([]),
  canPitch: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});
const BulkBodySchema = z.object({ players: z.array(BulkPlayerSchema).min(1).max(100) });
const KNOWN_POSITIONS = new Set<string>(ALL_POSITIONS);

const EXTRACT_INSTRUCTIONS = `You are extracting a youth baseball roster.
Return a JSON array ONLY (no markdown, no explanation). For each player return:
{
  "name": string,                 // full name as written, trimmed
  "number": number | null,        // jersey number if visible, else null
  "eligiblePositions": string[],  // pick from ${ALL_POSITIONS.join(", ")}
  "canPitch": boolean,            // true if "P" appears in their positions or roster says pitcher
  "notes": string | null          // anything notable (left-handed, captain, etc.) or null
}
Position normalization rules:
- "Pitcher" -> "P", "Catcher" -> "C"
- "First base"/"1st" -> "1B", "Second"/"2nd" -> "2B", "Third"/"3rd" -> "3B"
- "Shortstop"/"SS" -> "SS"
- "Left field"/"LF" -> "LF", "Center"/"CF" -> "CF", "Right"/"RF" -> "RF"
- "Outfield"/"OF" -> ["LF","CF","RF"]
- "Infield"/"IF" -> ["1B","2B","3B","SS"]
- If no positions listed, return empty array []
If canPitch is true, make sure "P" is in eligiblePositions.
Output only the raw JSON array.`;

async function callExtractor(content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>) {
  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 4096,
    messages: [{ role: "user", content }],
  });
  const raw = response.choices[0]?.message?.content ?? "[]";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let extracted: unknown;
  try {
    extracted = JSON.parse(cleaned);
  } catch {
    return { error: "Could not parse AI response", raw };
  }
  if (!Array.isArray(extracted)) return { error: "AI did not return an array", raw };
  return { players: extracted };
}

router.post("/players/extract", upload.single("file"), async (req, res): Promise<void> => {
  // Two modes: file upload (multipart) OR { text } JSON
  if (req.file) {
    const base64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/png";
    const result = await callExtractor([
      { type: "text", text: EXTRACT_INSTRUCTIONS },
      { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
    ]);
    if ("error" in result) { res.status(422).json(result); return; }
    res.json({ extracted: result.players });
    return;
  }
  const parsed = ExtractTextBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide either a text body or an uploaded file" });
    return;
  }
  const result = await callExtractor([
    { type: "text", text: `${EXTRACT_INSTRUCTIONS}\n\nRoster text to parse:\n${parsed.data.text}` },
  ]);
  if ("error" in result) { res.status(422).json(result); return; }
  res.json({ extracted: result.players });
});

router.post("/players/bulk", async (req, res): Promise<void> => {
  const parsed = BulkBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  // Skip duplicates by case-insensitive name + (number if given) match against existing roster.
  const existing = await db.select({ name: playersTable.name, number: playersTable.number }).from(playersTable);
  const existingKeys = new Set(
    existing.map((e) => `${e.name.trim().toLowerCase()}|${e.number ?? ""}`)
  );

  const rows: typeof playersTable.$inferInsert[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const p of parsed.data.players) {
    const key = `${p.name.trim().toLowerCase()}|${p.number ?? ""}`;
    if (existingKeys.has(key)) {
      skipped.push({ name: p.name, reason: "already on roster" });
      continue;
    }
    existingKeys.add(key); // also dedupe within the batch itself
    // Filter out any unknown position codes the AI may have produced.
    const eligible = new Set(p.eligiblePositions.filter((pp) => KNOWN_POSITIONS.has(pp)));
    if (p.canPitch) eligible.add("P");
    const preferred = (p.preferredPositions ?? []).filter((pp) => KNOWN_POSITIONS.has(pp) && eligible.has(pp));
    rows.push({
      name: p.name,
      number: p.number ?? null,
      eligiblePositions: Array.from(eligible),
      preferredPositions: preferred,
      canPitch: p.canPitch,
      active: true,
      notes: p.notes ?? null,
    });
  }

  const created = rows.length > 0 ? await db.insert(playersTable).values(rows).returning() : [];
  res.status(201).json({ created, skipped });
});

router.get("/players", async (_req, res): Promise<void> => {
  const players = await db.select().from(playersTable).orderBy(playersTable.name);
  res.json(players);
});

router.post("/players", async (req, res): Promise<void> => {
  const parsed = CreatePlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const [player] = await db
    .insert(playersTable)
    .values({
      name: data.name,
      number: data.number ?? null,
      eligiblePositions: data.eligiblePositions,
      preferredPositions: data.preferredPositions,
      canPitch: data.canPitch,
      active: data.active ?? true,
      notes: data.notes ?? null,
    })
    .returning();
  res.status(201).json(player);
});

router.get("/players/:id", async (req, res): Promise<void> => {
  const params = GetPlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [player] = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.id, params.data.id));
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(player);
});

router.patch("/players/:id", async (req, res): Promise<void> => {
  const params = UpdatePlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.name !== undefined) updates.name = d.name;
  if (d.number !== undefined) updates.number = d.number;
  if (d.eligiblePositions !== undefined) updates.eligiblePositions = d.eligiblePositions;
  if (d.preferredPositions !== undefined) updates.preferredPositions = d.preferredPositions;
  if (d.canPitch !== undefined) updates.canPitch = d.canPitch;
  if (d.active !== undefined) updates.active = d.active;
  if (d.notes !== undefined) updates.notes = d.notes;

  const [player] = await db
    .update(playersTable)
    .set(updates)
    .where(eq(playersTable.id, params.data.id))
    .returning();
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(player);
});

router.delete("/players/:id", async (req, res): Promise<void> => {
  const params = DeletePlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [player] = await db
    .delete(playersTable)
    .where(eq(playersTable.id, params.data.id))
    .returning();
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
