import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import { and, eq, isNull } from "drizzle-orm";
import multer from "multer";
import { z } from "zod";
import { db, playersTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { chargeAiCall } from "../lib/ai-usage";
import {
  CreatePlayerBody,
  GetPlayerParams,
  UpdatePlayerParams,
  UpdatePlayerBody,
  DeletePlayerParams,
} from "@workspace/api-zod";

const router: IRouter = Router();
// Scope to /players so the middleware doesn't 403 unrelated routes
// like PUT /coach-profile that just happen to flow through this
// router on their way to the next mounted feature router.
router.use("/players", gateWrites("full"));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Includes LCF/RCF — a player whose team runs a 10-player field can have
// either left-center or right-center marked as a preferred position.
const ALL_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "CF", "RCF", "RF"] as const;

/**
 * Eligibility is no longer a coach-managed concept — every player can play
 * every position. The only hard exclusion left is pitching: kids who don't
 * pitch never get auto-assigned to "P" (a safety/parental concern). We still
 * persist `eligiblePositions` because legacy data + lineup-generator code
 * read from it; we just always recompute it from `canPitch` on every write,
 * so existing rows self-heal as soon as the coach edits them.
 */
function deriveEligible(canPitch: boolean): string[] {
  return canPitch
    ? [...ALL_POSITIONS]
    : ALL_POSITIONS.filter((p) => p !== "P");
}

const ExtractTextBodySchema = z.object({
  text: z.string().min(1).max(10000),
});

// Bulk import accepts firstName/lastName from the new AI extractor and also
// falls back to a single `name` field for backward compatibility with older
// clients (and for the rare roster source that doesn't separate the two —
// the helper splits it on the last whitespace).
const BulkPlayerSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    number: z.number().int().min(0).max(999).nullable().optional(),
    // Accept any string array; we filter to known positions below so one bad code
    // from the AI doesn't reject the whole batch.
    eligiblePositions: z.array(z.string()).default([]),
    preferredPositions: z.array(z.string()).default([]),
    canPitch: z.boolean().default(false),
    notes: z.string().nullable().optional(),
  })
  .transform((p) => {
    let firstName = (p.firstName ?? "").trim();
    let lastName = (p.lastName ?? "").trim();
    if (!firstName && !lastName && p.name) {
      const tokens = p.name.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 1) {
        firstName = tokens[0]!;
      } else if (tokens.length > 1) {
        firstName = tokens.slice(0, -1).join(" ");
        lastName = tokens[tokens.length - 1]!;
      }
    }
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    return { ...p, firstName, lastName, name: fullName };
  })
  .refine((p) => p.firstName.length > 0, {
    message: "Each player needs a first name",
  });
const BulkBodySchema = z.object({ players: z.array(BulkPlayerSchema).min(1).max(100) });
const KNOWN_POSITIONS = new Set<string>(ALL_POSITIONS);

const EXTRACT_INSTRUCTIONS = `You are extracting a youth baseball roster.
Return a JSON array ONLY (no markdown, no explanation). For each player return:
{
  "firstName": string,            // given name, trimmed (REQUIRED, never empty)
  "lastName": string,             // family name, trimmed ("" only if the source truly has no last name)
  "number": number | null,        // jersey number if visible, else null
  "preferredPositions": string[], // positions the roster lists for them, from ${ALL_POSITIONS.join(", ")}
  "canPitch": boolean,            // true if "P" appears in their positions or roster says pitcher
  "notes": string | null          // anything notable (left-handed, captain, etc.) or null
}
Name handling:
- If the source shows "Parker Handahl", emit firstName="Parker", lastName="Handahl".
- If the source shows "P. Handahl" (initial + surname), emit firstName="P", lastName="Handahl".
- If the source shows only "Brody" with no surname, emit firstName="Brody", lastName="".
- For multi-word first names like "Mary Beth Smith", treat the LAST token as the lastName.
Position normalization rules:
- "Pitcher" -> "P", "Catcher" -> "C"
- "First base"/"1st" -> "1B", "Second"/"2nd" -> "2B", "Third"/"3rd" -> "3B"
- "Shortstop"/"SS" -> "SS"
- "Left field"/"LF" -> "LF", "Center"/"CF" -> "CF", "Right"/"RF" -> "RF"
- "Left-center"/"LCF" -> "LCF", "Right-center"/"RCF" -> "RCF"
- "Outfield"/"OF" -> ["LF","CF","RF"]
- "Infield"/"IF" -> ["1B","2B","3B","SS"]
- If no positions listed, return empty array [] for preferredPositions.
Players are not gated by "eligible" positions anymore — only canPitch matters
for whether they'll be auto-assigned to pitch. Output only the raw JSON array.`;

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
  // Per-team daily AI budget — single call regardless of mode.
  const charge = await chargeAiCall(req, "roster-import");
  if (!charge.ok) { res.status(charge.status).json({ error: charge.error }); return; }
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
  const userId = req.ownerUserId!;
  const parsed = BulkBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  // Match against THIS coach's existing roster (other coaches' rosters are
  // invisible) by case-insensitive name + (number if given). Existing players
  // are UPDATED with the new screenshot's positions/canPitch (merged, not
  // overwritten — see merge semantics below) so re-importing an updated
  // roster picks up new preferred positions instead of silently dropping
  // them. New players are inserted as before. The whole batch runs in one
  // transaction so a partial failure doesn't leave the roster half-updated.
  const { created, updated } = await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(playersTable)
      .where(
        and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt)),
      );
    type ExistingPlayer = (typeof existing)[number];
    // Match against existing roster by case-insensitive full display name +
    // optional jersey number. We key on the joined "first last" rather than
    // the structured columns so legacy rows (where only `name` was set, e.g.
    // "Brody" with empty firstName/lastName) still de-dupe correctly when
    // re-imported with the new structured payload.
    const keyOf = (firstName: string, lastName: string, name: string, number: number | null | undefined) => {
      const display = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ").trim() || name.trim();
      return `${display.toLowerCase()}|${number ?? ""}`;
    };
    const existingByKey = new Map<string, ExistingPlayer>(
      existing.map((e) => [keyOf(e.firstName, e.lastName, e.name, e.number), e]),
    );

    const insertRows: typeof playersTable.$inferInsert[] = [];
    const updatedRows: ExistingPlayer[] = [];
    const seenKeysInBatch = new Set<string>();
    for (const p of parsed.data.players) {
      const key = keyOf(p.firstName, p.lastName, p.name, p.number);
      if (seenKeysInBatch.has(key)) continue; // dedupe within the batch itself
      seenKeysInBatch.add(key);

      // Eligibility is auto-derived from canPitch (see deriveEligible). The AI
      // extractor sometimes still sends `eligiblePositions` in legacy payloads,
      // and the bulk schema also accepts it for back-compat — both are merged
      // into preferredPositions so the coach's intent isn't lost.
      const incomingPositionsRaw = [
        ...(p.preferredPositions ?? []),
        ...(p.eligiblePositions ?? []),
      ];
      const incomingPositions = Array.from(
        new Set(incomingPositionsRaw.filter((pp) => KNOWN_POSITIONS.has(pp))),
      );

      const existingPlayer = existingByKey.get(key);
      if (existingPlayer) {
        // Merge semantics for an updated roster screenshot:
        // - preferredPositions: UNION of existing + incoming (additive — the
        //   coach has likely refined positions in-app between screenshots, so
        //   we never silently remove a position; explicit per-player edits
        //   still happen on the player detail page).
        // - canPitch: OR (a new screenshot listing them as a pitcher promotes
        //   them; demotion stays an explicit edit).
        // - notes: NEVER touched on update. The notes field is for coach
        //   commentary edited in the UI; re-importing a roster shouldn't
        //   overwrite it (and historically the client even leaked UI status
        //   strings here, so we hard-ignore incoming notes for existing
        //   players as defense-in-depth).
        const mergedPositions = Array.from(
          new Set([...existingPlayer.preferredPositions, ...incomingPositions]),
        );
        const mergedCanPitch = existingPlayer.canPitch || p.canPitch;

        // Skip the round-trip if nothing actually changed — keeps the
        // `updated` count meaningful for the UI ("we updated 3 players, the
        // other 8 already had everything").
        const positionsChanged =
          mergedPositions.length !== existingPlayer.preferredPositions.length ||
          mergedPositions.some(
            (pos) => !existingPlayer.preferredPositions.includes(pos),
          );
        const canPitchChanged = mergedCanPitch !== existingPlayer.canPitch;
        if (!positionsChanged && !canPitchChanged) continue;

        const [row] = await tx
          .update(playersTable)
          .set({
            preferredPositions: mergedPositions,
            canPitch: mergedCanPitch,
            eligiblePositions: deriveEligible(mergedCanPitch),
          })
          .where(
            and(
              eq(playersTable.id, existingPlayer.id),
              eq(playersTable.userId, userId),
            ),
          )
          .returning();
        if (row) updatedRows.push(row);
        continue;
      }

      insertRows.push({
        userId,
        name: p.name,
        firstName: p.firstName,
        lastName: p.lastName,
        number: p.number ?? null,
        eligiblePositions: deriveEligible(p.canPitch),
        preferredPositions: incomingPositions,
        canPitch: p.canPitch,
        active: true,
        notes: p.notes ?? null,
      });
    }

    const createdRows =
      insertRows.length > 0
        ? await tx.insert(playersTable).values(insertRows).returning()
        : [];
    return { created: createdRows, updated: updatedRows };
  });

  // `skipped` is kept in the response for backwards compat with any older
  // clients (always empty now — duplicates are merged, not skipped).
  res.status(201).json({ created, updated, skipped: [] });
});

router.get("/players", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const players = await db
    .select()
    .from(playersTable)
    .where(
      and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt)),
    )
    .orderBy(playersTable.name);
  res.json(players);
});

router.post("/players", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = CreatePlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const firstName = data.firstName.trim();
  const lastName = data.lastName.trim();
  if (!firstName) {
    res.status(400).json({ error: "First name is required" });
    return;
  }
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const [player] = await db
    .insert(playersTable)
    .values({
      userId,
      name: fullName,
      firstName,
      lastName,
      number: data.number ?? null,
      // eligiblePositions is now server-derived from canPitch; client values
      // are accepted by the schema for back-compat but always overridden.
      eligiblePositions: deriveEligible(data.canPitch),
      preferredPositions: data.preferredPositions,
      canPitch: data.canPitch,
      active: data.active ?? true,
      notes: data.notes ?? null,
    })
    .returning();
  res.status(201).json(player);
});

router.get("/players/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = GetPlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [player] = await db
    .select()
    .from(playersTable)
    .where(
      and(
        eq(playersTable.id, params.data.id),
        eq(playersTable.userId, userId),
        isNull(playersTable.deletedAt),
      ),
    );
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(player);
});

router.patch("/players/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
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
  if (d.firstName !== undefined || d.lastName !== undefined) {
    const firstName = (d.firstName ?? "").trim();
    const lastName = (d.lastName ?? "").trim();
    if (!firstName) {
      res.status(400).json({ error: "First name is required" });
      return;
    }
    updates.firstName = firstName;
    updates.lastName = lastName;
    updates.name = [firstName, lastName].filter(Boolean).join(" ");
  }
  if (d.number !== undefined) updates.number = d.number;
  if (d.preferredPositions !== undefined) updates.preferredPositions = d.preferredPositions;
  if (d.canPitch !== undefined) updates.canPitch = d.canPitch;
  if (d.active !== undefined) updates.active = d.active;
  if (d.notes !== undefined) updates.notes = d.notes;
  // Always recompute eligiblePositions from the resulting canPitch so legacy
  // rows self-heal on any edit, not just canPitch toggles. We need the
  // existing row to know canPitch when it isn't part of this PATCH.
  const [existing] = await db
    .select()
    .from(playersTable)
    .where(
      and(
        eq(playersTable.id, params.data.id),
        eq(playersTable.userId, userId),
        isNull(playersTable.deletedAt),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  const effectiveCanPitch = d.canPitch ?? existing.canPitch;
  updates.eligiblePositions = deriveEligible(effectiveCanPitch);

  const [player] = await db
    .update(playersTable)
    .set(updates)
    .where(and(eq(playersTable.id, params.data.id), eq(playersTable.userId, userId)))
    .returning();
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(player);
});

// Soft delete — sets `deletedAt` so the trashed player can be restored
// from the toast Undo button. Reads filter `deletedAt IS NULL` (see
// ownership helpers + read sites) so the player vanishes from the UI
// immediately. The 204 response shape is preserved for backwards
// compat with existing clients.
router.delete("/players/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = DeletePlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [player] = await db
    .update(playersTable)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(playersTable.id, params.data.id),
        eq(playersTable.userId, userId),
        isNull(playersTable.deletedAt),
      ),
    )
    .returning();
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.sendStatus(204);
});

// Restore — clears `deletedAt`. Backs the toast Undo button. Looks up
// the row WITHOUT the deletedAt-IS-NULL filter (otherwise we couldn't
// find the row we just trashed). 404s for unknown ids and for rows
// that aren't currently soft-deleted (no-op, return the live row).
router.post("/players/:id/restore", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = DeletePlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [player] = await db
    .update(playersTable)
    .set({ deletedAt: null })
    .where(
      and(eq(playersTable.id, params.data.id), eq(playersTable.userId, userId)),
    )
    .returning();
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(player);
});

export default router;
