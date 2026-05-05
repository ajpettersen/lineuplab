import { Router, type IRouter, json as expressJson } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, playersTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { FIELD_POSITIONS } from "../lib/lineup-generator";
import { getOwnedGame } from "../lib/ownership";
import { gateWrites } from "../lib/permissions";

const router: IRouter = Router();
router.use("/games", gateWrites("partial"));

const ParamsSchema = z.object({ id: z.coerce.number().int().positive() });

// Base64 string length cap is ~8.4MB, which decodes to ~6.3MB. We re-check
// the *decoded* byte length below to enforce the real ceiling.
const MAX_BASE64_LEN = 8_500_000;
const MIN_DECODED_BYTES = 1024; // 1KB — anything smaller can't be a real photo
const MAX_DECODED_BYTES = 6 * 1024 * 1024; // 6MB raw

const BodySchema = z.object({
  imageBase64: z
    .string()
    .min(64, "Image too small")
    .max(MAX_BASE64_LEN, "Image too large (max ~6MB)")
    .regex(/^[A-Za-z0-9+/=\s]+$/, "Image data is not valid base64"),
  mimeType: z.enum(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
});

// Detect file type from the first few bytes so we reject non-images
// (e.g. a PDF or executable mislabeled as image/png) before paying for vision.
function sniffImageMime(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: "RIFF"...."WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

// Normalize a name for comparison: lowercase, strip punctuation, collapse spaces.
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Check if the model's chosen player id plausibly matches the name it read
// from the image. Either the full normalized name equals or one is a substring
// of the other (covers "Henry" vs "Henry Smith", "H. Smith" vs "Henry Smith").
function namesPlausiblyMatch(rosterName: string, nameInImage: string): boolean {
  const a = normalizeName(rosterName);
  const b = normalizeName(nameInImage);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Last/first word overlap: "smith henry" vs "henry smith".
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  for (const t of aTokens) if (t.length >= 3 && bTokens.has(t)) return true;
  return false;
}

// Accept the optional LCF/RCF too; some teams use a 10-player outfield and
// a screenshot might list those even if the active team uses CF.
const VALID_POSITIONS = new Set<string>([...FIELD_POSITIONS, "LCF", "RCF", "Bench"]);

const SYSTEM_PROMPT = `You are extracting a baseball defensive lineup from an image (a screenshot from a lineup app, a photo of a lineup card, or a hand-drawn grid).

You will be given:
1. The active roster, listing each player's id and full name.
2. The number of innings the lineup should cover.
3. The image itself.

Your job is to read the image and produce a structured lineup.

Output ONLY a JSON object — no markdown fences, no extra prose. Schema:
{
  "innings": number,                       // how many innings you detected in the image (1..15)
  "entries": Array<{
    "inning": number,                      // 1-based
    "position": string,                    // one of "P","C","1B","2B","3B","SS","LF","CF","RF","Bench" (or "LCF","RCF" for 10-player fields)
    "playerId": number | null,             // matched roster id, or null if no confident match
    "playerNameInImage": string            // the exact name as you read it from the image
  }>,
  "notes": string                          // 1 short sentence about anything ambiguous (or "")
}

Rules:
- Match player names from the image to the roster by full name, last name, or first name. Use playerId for the match. If no roster player plausibly matches, set playerId to null and still include the entry with playerNameInImage.
- Use ONLY positions from the allowed list. Map common variants: "Pitcher"->P, "Catcher"->C, "First"->1B, "Second"->2B, "Third"->3B, "Shortstop"/"SS"->SS, "Left"->LF, "Center"->CF, "Right"->RF, "Left-center"/"LCF"->LCF, "Right-center"/"RCF"->RCF, "Sit"/"Out"->Bench.
- Each (inning, position) should appear at most once for a field position. "Bench" can appear multiple times per inning (one per benched player).
- Do NOT invent players who are not visible in the image.
- If the image is not a lineup at all, return {"innings":0,"entries":[],"notes":"Image does not appear to contain a lineup."}.`;

interface AiEntry {
  inning: number;
  position: string;
  playerId: number | null;
  playerNameInImage: string;
}

interface AiResult {
  innings: number;
  entries: AiEntry[];
  notes: string;
}

function parseAiJson(raw: string): AiResult | null {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const r = obj as Record<string, unknown>;
  const innings = typeof r.innings === "number" ? Math.trunc(r.innings) : 0;
  const entriesRaw = Array.isArray(r.entries) ? r.entries : [];
  const entries: AiEntry[] = entriesRaw
    .filter(
      (e): e is Record<string, unknown> =>
        !!e && typeof e === "object",
    )
    .map((e) => ({
      inning: typeof e.inning === "number" ? Math.trunc(e.inning) : 0,
      position: typeof e.position === "string" ? e.position : "",
      playerId: typeof e.playerId === "number" ? e.playerId : null,
      playerNameInImage:
        typeof e.playerNameInImage === "string"
          ? e.playerNameInImage
          : "",
    }));
  const notes = typeof r.notes === "string" ? r.notes : "";
  return { innings, entries, notes };
}

// Route-scoped JSON parser large enough for a base64-encoded ~6MB image.
// Other endpoints keep the global default (~100KB) so this widened limit
// is not a DoS surface for the rest of the API.
const imageJsonParser = expressJson({ limit: "8mb" });

router.post("/games/:id/lineup/from-image", imageJsonParser, async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = ParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }
  const body = BodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.errors[0]?.message ?? "Invalid body" });
    return;
  }

  // Decode base64 ourselves so we can enforce real byte bounds and verify the
  // file is actually an image of the claimed type before paying for vision.
  let imageBuf: Buffer;
  try {
    imageBuf = Buffer.from(body.data.imageBase64.replace(/\s+/g, ""), "base64");
  } catch {
    res.status(400).json({ error: "Image data is not valid base64" });
    return;
  }
  if (imageBuf.length < MIN_DECODED_BYTES) {
    res.status(400).json({ error: "Image is too small to be a real photo" });
    return;
  }
  if (imageBuf.length > MAX_DECODED_BYTES) {
    res.status(400).json({ error: "Image is too large (max 6MB after decode)" });
    return;
  }
  const sniffed = sniffImageMime(imageBuf);
  if (!sniffed) {
    res.status(400).json({ error: "File does not look like a PNG, JPEG, or WebP image" });
    return;
  }
  const claimedMime = body.data.mimeType === "image/jpg" ? "image/jpeg" : body.data.mimeType;
  if (sniffed !== claimedMime) {
    res
      .status(400)
      .json({ error: `Image content (${sniffed}) does not match declared type (${claimedMime})` });
    return;
  }

  const game = await getOwnedGame(userId, params.data.id);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  // Only consider this coach's players — a roster id from another tenant must
  // never appear in the matched lineup.
  const allPlayers = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.userId, userId));
  const activePlayers = allPlayers.filter((p) => p.active);
  if (activePlayers.length === 0) {
    res.status(400).json({ error: "No active players on the roster" });
    return;
  }

  const rosterText = activePlayers
    .map((p) => `id=${p.id} name="${p.name}"`)
    .join("\n");

  const userText = `Active roster (use only these playerIds):
${rosterText}

Game length: ${game.innings} innings.`;

  // OpenAI vision: pass the image as a base64 data URL on a content part.
  const dataUrl = `data:${body.data.mimeType};base64,${body.data.imageBase64}`;

  let aiResult: AiResult | null = null;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      // Lineups are short structured JSON; 1500 tokens fits ~80 entries with
      // notes and a margin. Keeping this tight cuts model latency noticeably
      // vs. the previous 4000-token budget.
      max_completion_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            // detail:"low" tells the vision model to use the ~85-token
            // low-res tile instead of high-detail tiling. Lineup grids and
            // app screenshots are easily readable at low and this is the
            // single biggest latency win on the import path.
            { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
          ],
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    aiResult = parseAiJson(raw);
  } catch (err) {
    req.log.error({ err }, "Vision lineup extraction failed");
    res.status(502).json({ error: "AI service unavailable" });
    return;
  }

  if (!aiResult) {
    res.status(502).json({ error: "Could not parse AI response" });
    return;
  }

  if (aiResult.entries.length === 0) {
    res.json({
      lineup: [],
      unmatched: [],
      warnings: [
        aiResult.notes ||
          "No lineup detected in the image. Try a clearer photo or a screenshot of the lineup grid.",
      ],
      detectedInnings: aiResult.innings,
      notes: aiResult.notes,
    });
    return;
  }

  // Validate each entry against current roster + game shape.
  const activeIds = new Set(activePlayers.map((p) => p.id));
  const playerNameById = new Map(allPlayers.map((p) => [p.id, p.name]));

  const warnings: string[] = [];
  const unmatched: Array<{ inning: number; position: string; playerNameInImage: string }> = [];
  // Defend against the model assigning the same field slot twice. Field slots
  // are unique per (inning, position); Bench slots are not.
  const usedFieldSlots = new Set<string>();
  // Defend against the same player getting two positions in one inning.
  const usedPlayerInning = new Set<string>();

  const valid: Array<{
    playerId: number;
    inning: number;
    position: string;
  }> = [];

  for (const e of aiResult.entries) {
    if (!VALID_POSITIONS.has(e.position)) continue;
    if (e.inning < 1 || e.inning > game.innings) continue;
    if (e.playerId == null || !activeIds.has(e.playerId)) {
      unmatched.push({
        inning: e.inning,
        position: e.position,
        playerNameInImage: e.playerNameInImage,
      });
      continue;
    }
    // Reconcile: if the model gave us a player id but the name it claims to
    // have read from the image doesn't plausibly match that player's roster
    // name, treat the entry as unmatched rather than silently mis-assigning.
    // Skip the check when the model didn't echo a name back.
    if (e.playerNameInImage) {
      const rosterName = playerNameById.get(e.playerId) ?? "";
      if (!namesPlausiblyMatch(rosterName, e.playerNameInImage)) {
        unmatched.push({
          inning: e.inning,
          position: e.position,
          playerNameInImage: e.playerNameInImage,
        });
        continue;
      }
    }
    if (e.position !== "Bench") {
      const slot = `${e.inning}|${e.position}`;
      if (usedFieldSlots.has(slot)) {
        warnings.push(
          `Inning ${e.inning} ${e.position} appeared twice — kept the first.`,
        );
        continue;
      }
      usedFieldSlots.add(slot);
    }
    const playerInningKey = `${e.inning}|${e.playerId}`;
    if (usedPlayerInning.has(playerInningKey)) {
      warnings.push(
        `${playerNameById.get(e.playerId) ?? "A player"} was assigned two positions in inning ${e.inning} — kept the first.`,
      );
      continue;
    }
    usedPlayerInning.add(playerInningKey);
    valid.push({ playerId: e.playerId, inning: e.inning, position: e.position });
  }

  if (unmatched.length > 0) {
    const names = Array.from(new Set(unmatched.map((u) => u.playerNameInImage).filter(Boolean))).slice(0, 5);
    warnings.push(
      `Couldn't match ${unmatched.length} entr${unmatched.length === 1 ? "y" : "ies"} to your roster${names.length ? ` (${names.join(", ")})` : ""}. Those slots are blank — fill them in by tapping the cell.`,
    );
  }

  if (aiResult.innings > 0 && aiResult.innings !== game.innings) {
    warnings.push(
      `Image showed ${aiResult.innings} innings but this game is ${game.innings}. Extra innings were ignored; missing innings are blank.`,
    );
  }

  const lineup = valid.map((e, idx) => ({
    id: -(idx + 1), // negative ids = unsaved preview, matches /generate
    gameId: params.data.id,
    playerId: e.playerId,
    playerName: playerNameById.get(e.playerId) ?? "Unknown",
    inning: e.inning,
    position: e.position,
    battingOrder: null,
  }));

  res.json({
    lineup,
    unmatched,
    warnings,
    detectedInnings: aiResult.innings,
    notes: aiResult.notes,
  });
});

export default router;
