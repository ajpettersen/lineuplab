import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  playersTable,
  lineupEntriesTable,
  lineupConstraintsTable,
  lineupLocksTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  generateFairLineup,
  FIELD_POSITIONS,
  type PinnedAssignment,
} from "../lib/lineup-generator";
import { getOwnedGame } from "../lib/ownership";

const router: IRouter = Router();

const ParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const BodySchema = z.object({ message: z.string().trim().min(1).max(1000) });

const VALID_POSITIONS = new Set<string>([...FIELD_POSITIONS, "Bench"]);

const SYSTEM_PROMPT = `You are an assistant for a youth baseball coach using a defensive-lineup app.

You have access to the current saved lineup, the active roster, and the fairness rules of the auto-generator.

Your job is to look at the coach's message and decide between two intents:

INTENT "answer" — the coach is asking a question (e.g. "why did you put Henry at catcher in inning 1?", "who has the most bench time?", "is anyone playing the same position twice?"). Answer in 1-3 short sentences. Be concrete and reference players by their first name.

INTENT "regenerate" — the coach is giving an instruction that requires changing the lineup (e.g. "I want Henry to catch the first 3 innings", "put Walter at pitcher in inning 4", "bench Charlie for innings 1-2"). Translate the instruction into a list of pinned assignments and provide a one-sentence explanation of what you're doing. The auto-generator will fill in every other slot.

Rules for pinned assignments:
- Each pin is {"playerId": <number>, "inning": <number>, "position": <string>}.
- "position" must be one of: "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", or "Bench".
- Use ONLY playerIds from the provided roster.
- Use ONLY innings that exist (1..innings).
- A pin assigning a player to "Bench" forces them to sit that inning.
- Do not pin two players to the same (inning, position).
- Do not pin the same player twice in one inning.
- Only pin the slots the coach explicitly asked for; let the generator fill the rest.

Return ONLY a JSON object — no markdown fences, no extra prose. Schema:
{
  "intent": "answer" | "regenerate",
  "answer": string | null,           // required when intent=answer
  "explanation": string | null,      // required when intent=regenerate
  "pinned": Array<{playerId:number, inning:number, position:string}> | null  // required when intent=regenerate
}`;

interface AiResponse {
  intent: "answer" | "regenerate";
  answer: string | null;
  explanation: string | null;
  pinned: PinnedAssignment[] | null;
}

function parseAiJson(raw: string): AiResponse | null {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const r = obj as Record<string, unknown>;
  const intent = r.intent === "answer" || r.intent === "regenerate" ? r.intent : null;
  if (!intent) return null;
  const pinnedRaw = Array.isArray(r.pinned) ? r.pinned : null;
  const pinned: PinnedAssignment[] | null = pinnedRaw
    ? pinnedRaw
        .filter(
          (p): p is PinnedAssignment =>
            !!p &&
            typeof p === "object" &&
            typeof (p as Record<string, unknown>).playerId === "number" &&
            typeof (p as Record<string, unknown>).inning === "number" &&
            typeof (p as Record<string, unknown>).position === "string",
        )
        .map((p) => ({ playerId: p.playerId, inning: p.inning, position: p.position }))
    : null;
  return {
    intent,
    answer: typeof r.answer === "string" ? r.answer : null,
    explanation: typeof r.explanation === "string" ? r.explanation : null,
    pinned,
  };
}

router.post("/games/:id/ai-assistant", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = ParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }
  const body = BodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  const game = await getOwnedGame(userId, params.data.id);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  // Active roster scoped to this coach (the pool the auto-generator uses).
  const allPlayers = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.userId, userId));
  const activePlayers = allPlayers.filter((p) => p.active);
  if (activePlayers.length === 0) {
    res.status(400).json({ error: "No active players on the roster" });
    return;
  }

  const lineupRows = await db
    .select({
      id: lineupEntriesTable.id,
      playerId: lineupEntriesTable.playerId,
      playerName: playersTable.name,
      inning: lineupEntriesTable.inning,
      position: lineupEntriesTable.position,
    })
    .from(lineupEntriesTable)
    .innerJoin(playersTable, eq(lineupEntriesTable.playerId, playersTable.id))
    .where(eq(lineupEntriesTable.gameId, params.data.id))
    .orderBy(lineupEntriesTable.inning, lineupEntriesTable.position, lineupEntriesTable.id);

  // Build a compact text grid of the current lineup so the model can reason about it.
  const lineupGridLines: string[] = [];
  for (let inn = 1; inn <= game.innings; inn++) {
    const inEntries = lineupRows.filter((e) => e.inning === inn);
    const fieldParts: string[] = [];
    for (const pos of FIELD_POSITIONS) {
      const e = inEntries.find((x) => x.position === pos);
      fieldParts.push(`${pos}=${e ? e.playerName : "—"}`);
    }
    const benchNames = inEntries.filter((e) => e.position === "Bench").map((e) => e.playerName);
    const benchStr = benchNames.length ? benchNames.join(", ") : "—";
    lineupGridLines.push(`Inning ${inn}: ${fieldParts.join(", ")}; Bench: ${benchStr}`);
  }
  const lineupGrid = lineupRows.length > 0 ? lineupGridLines.join("\n") : "(no lineup saved yet)";

  const rosterLines = activePlayers
    .map(
      (p) =>
        `id=${p.id} name="${p.name}" eligible=[${p.eligiblePositions.join(",") || "—"}] preferred=[${(p.preferredPositions ?? []).join(",") || "—"}]${p.canPitch ? " canPitch" : ""}`,
    )
    .join("\n");

  // Active stored constraints (this coach only) — model uses them when
  // explaining "why".
  const constraints = await db
    .select()
    .from(lineupConstraintsTable)
    .where(and(eq(lineupConstraintsTable.active, true), eq(lineupConstraintsTable.userId, userId)));
  const constraintLines = constraints
    .map((c) => {
      const who = c.playerId
        ? `player#${c.playerId}`
        : "global";
      const parts = [`${who} ${c.type}`];
      if (c.position) parts.push(`pos=${c.position}`);
      if (c.value != null) parts.push(`value=${c.value}`);
      if (c.rule) parts.push(`rule=${c.rule}`);
      return `- ${parts.join(" ")}`;
    })
    .join("\n");

  const userPrompt = `Game: vs. ${game.opponent} on ${game.gameDate.toISOString().slice(0, 10)} (${game.innings} innings)

Active roster (only these playerIds may be used):
${rosterLines}

Current saved lineup:
${lineupGrid}

Active constraints (informational, used by the auto-generator):
${constraintLines || "(none)"}

Coach's message:
${body.data.message}`;

  let aiResponse: AiResponse | null = null;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 1200,
      // Enforce a JSON response so we don't have to repair prose-wrapped output.
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    aiResponse = parseAiJson(raw);
  } catch (err) {
    req.log.error({ err }, "AI assistant call failed");
    res.status(502).json({ error: "AI service unavailable" });
    return;
  }

  if (!aiResponse) {
    res.status(502).json({ error: "Could not parse AI response" });
    return;
  }

  if (aiResponse.intent === "answer") {
    const text = aiResponse.answer?.trim() || "I'm not sure how to answer that.";
    res.json({ kind: "answer", text });
    return;
  }

  // intent === "regenerate"
  const explanation = aiResponse.explanation?.trim() || "Updating the lineup with your request.";
  const validPlayerIds = new Set(activePlayers.map((p) => p.id));
  const pinned: PinnedAssignment[] = (aiResponse.pinned ?? []).filter(
    (p) =>
      validPlayerIds.has(p.playerId) &&
      p.inning >= 1 &&
      p.inning <= game.innings &&
      VALID_POSITIONS.has(p.position),
  );

  if (pinned.length === 0) {
    // The model said "regenerate" but produced no usable pins — fall back to a
    // plain answer so the user isn't shown a confusing no-op preview.
    res.json({
      kind: "answer",
      text:
        explanation +
        " (I couldn't translate that into a specific position pin — try naming a player and a position, e.g. \"Henry at C in inning 1\".)",
    });
    return;
  }

  // Merge persistent per-game locks. **Locks win on conflict** — they're
  // explicit, persistent coach decisions made via the Position Locks UI,
  // and silently overriding them would break the coach's mental model of
  // "what I pinned stays pinned". If the AI's just-issued pin conflicts
  // with a lock we drop the AI pin and tell the coach about it in the
  // explanation so they can remove the lock if that's what they meant.
  const lockRows = (await db
    .select()
    .from(lineupLocksTable)
    .where(eq(lineupLocksTable.gameId, params.data.id))).filter(
    (l) => l.inning >= 1 && l.inning <= game.innings && validPlayerIds.has(l.playerId),
  );
  const playerNameByIdForExplain = new Map(allPlayers.map((p) => [p.id, p.name]));
  const lockPlayerInning = new Set(lockRows.map((l) => `${l.playerId}|${l.inning}`));
  const lockFieldPosByInning = new Map<number, Map<string, number>>(); // inning -> position -> playerId
  for (const l of lockRows) {
    if (l.position === "Bench") continue;
    if (!lockFieldPosByInning.has(l.inning)) lockFieldPosByInning.set(l.inning, new Map());
    lockFieldPosByInning.get(l.inning)!.set(l.position, l.playerId);
  }
  const droppedAiPins: string[] = [];
  const honoredPinned: PinnedAssignment[] = [];
  for (const p of pinned) {
    // Same player+inning as a lock: lock wins; only drop if the lock's
    // position differs from what the AI tried to pin.
    if (lockPlayerInning.has(`${p.playerId}|${p.inning}`)) {
      const lockedHere = lockRows.find((l) => l.playerId === p.playerId && l.inning === p.inning);
      if (lockedHere && lockedHere.position !== p.position) {
        droppedAiPins.push(
          `${playerNameByIdForExplain.get(p.playerId) ?? `Player ${p.playerId}`} is locked at ${lockedHere.position} in inning ${p.inning}`,
        );
        continue;
      }
    }
    // Same field position taken by a different locked player.
    if (p.position !== "Bench") {
      const owner = lockFieldPosByInning.get(p.inning)?.get(p.position);
      if (owner != null && owner !== p.playerId) {
        droppedAiPins.push(
          `${playerNameByIdForExplain.get(owner) ?? `Player ${owner}`} is locked at ${p.position} in inning ${p.inning}`,
        );
        continue;
      }
    }
    honoredPinned.push(p);
  }
  pinned.length = 0;
  pinned.push(...honoredPinned);
  // Add the locks themselves (skip ones already represented by AI pins).
  const pinnedKeys = new Set(pinned.map((p) => `${p.playerId}|${p.inning}|${p.position}`));
  for (const l of lockRows) {
    const k = `${l.playerId}|${l.inning}|${l.position}`;
    if (pinnedKeys.has(k)) continue;
    pinned.push({ playerId: l.playerId, inning: l.inning, position: l.position });
  }

  const generated = generateFairLineup(activePlayers, game.innings, {}, constraints, pinned);

  // Feasibility check: every inning must have all 9 field positions filled.
  // If pins made staffing impossible, the greedy pass will leave gaps — in that
  // case, refuse to return a half-broken lineup and explain the issue instead.
  const filledByInning = new Map<number, Set<string>>();
  for (const e of generated) {
    if (e.position === "Bench") continue;
    if (!filledByInning.has(e.inning)) filledByInning.set(e.inning, new Set());
    filledByInning.get(e.inning)!.add(e.position);
  }
  const understaffed: number[] = [];
  for (let i = 1; i <= game.innings; i++) {
    const filled = filledByInning.get(i) ?? new Set();
    if (filled.size < FIELD_POSITIONS.length) understaffed.push(i);
  }
  if (understaffed.length > 0) {
    res.json({
      kind: "answer",
      text: `I tried to honor those instructions but ended up with empty defensive positions in inning ${understaffed.join(", ")}. The pins probably conflict with player eligibility or constraints — try simpler or fewer pins.`,
    });
    return;
  }

  const playerNameById = new Map(allPlayers.map((p) => [p.id, p.name]));
  const lineup = generated.map((e, idx) => ({
    id: -(idx + 1), // negative ids = unsaved preview, matches /generate
    gameId: params.data.id,
    playerId: e.playerId,
    playerName: playerNameById.get(e.playerId) ?? "Unknown",
    inning: e.inning,
    position: e.position,
    battingOrder: e.battingOrder,
  }));

  // If we dropped any AI pins to honor existing locks, tell the coach so
  // they can remove the lock if that's what they actually meant.
  const finalExplanation = droppedAiPins.length > 0
    ? `${explanation} (Kept your existing lock${droppedAiPins.length === 1 ? "" : "s"}: ${Array.from(new Set(droppedAiPins)).join("; ")}. Remove the lock if you want me to override.)`
    : explanation;

  res.json({
    kind: "regenerate",
    explanation: finalExplanation,
    pinned,
    lineup,
  });
});

export default router;
