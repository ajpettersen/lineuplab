import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  playersTable,
  lineupEntriesTable,
  lineupConstraintsTable,
  lineupLocksTable,
  aiPinnedAssignmentsTable,
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

Your job is to look at the coach's message and decide between three intents:

INTENT "answer" — the coach is asking a question (e.g. "why did you put Henry at catcher in inning 1?", "who has the most bench time?", "is anyone playing the same position twice?"). Answer in 1-3 short sentences. Be concrete and reference players by their first name.

INTENT "regenerate" — the coach is giving an instruction that requires changing where players are placed (e.g. "I want Henry to catch the first 3 innings", "put Walter at pitcher in inning 4", "bench Charlie for innings 1-2"). Translate the instruction into a list of pinned assignments and provide a one-sentence explanation of what you're doing. The auto-generator will fill in every other slot.

INTENT "remove" — the coach is saying one or more players need to be PULLED OUT of the lineup entirely (e.g. "Henry got hurt, take him out", "remove Walter — he had to leave", "drop Charlie, he's injured", "Brayden went home early"). Return the players' ids in removePlayerIds and a one-sentence explanation. The app will clear every entry for those players from every inning of the current lineup; the slots they were holding become empty cells the coach can refill. This is DIFFERENT from "bench Charlie" (which is a regenerate intent that pins them to the Bench slot but they still occupy a roster spot in that inning's bench). Only use "remove" when the player is actually leaving the game (injury, sent home, ejected). Disambiguating examples:
- "take Charlie out for inning 3" → INTENT regenerate, pin Charlie to Bench in inning 3 (he's only sitting that one inning, still in the game).
- "sit Charlie the next two innings" → INTENT regenerate, pin Charlie to Bench in those innings.
- "take Charlie out, he's hurt" → INTENT remove (he's leaving the game).
- "Charlie's done for the day" → INTENT remove.

Rules for pinned assignments (intent=regenerate):
- Each pin is {"playerId": <number>, "inning": <number>, "position": <string>}.
- "position" must be one of: "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", or "Bench".
- Use ONLY playerIds from the provided roster.
- Use ONLY innings that exist (1..innings).
- A pin assigning a player to "Bench" forces them to sit that inning.
- Do not pin two players to the same (inning, position).
- Do not pin the same player twice in one inning.
- Only pin the slots the coach explicitly asked for; let the generator fill the rest.

Rules for removePlayerIds (intent=remove):
- Each id MUST be a playerId from the provided roster.
- If the coach names a player not on the roster, fall back to intent="answer" and tell them you couldn't find that player.

Return ONLY a JSON object — no markdown fences, no extra prose. Schema:
{
  "intent": "answer" | "regenerate" | "remove",
  "answer": string | null,                // required when intent=answer
  "explanation": string | null,           // required when intent=regenerate or intent=remove
  "pinned": Array<{playerId:number, inning:number, position:string}> | null,  // required when intent=regenerate
  "removePlayerIds": Array<number> | null // required when intent=remove
}`;

interface AiResponse {
  intent: "answer" | "regenerate" | "remove";
  answer: string | null;
  explanation: string | null;
  pinned: PinnedAssignment[] | null;
  removePlayerIds: number[] | null;
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
  const intent =
    r.intent === "answer" || r.intent === "regenerate" || r.intent === "remove"
      ? r.intent
      : null;
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
  const removeRaw = Array.isArray(r.removePlayerIds) ? r.removePlayerIds : null;
  const removePlayerIds: number[] | null = removeRaw
    ? removeRaw.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    : null;
  return {
    intent,
    answer: typeof r.answer === "string" ? r.answer : null,
    explanation: typeof r.explanation === "string" ? r.explanation : null,
    pinned,
    removePlayerIds,
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

  if (aiResponse.intent === "remove") {
    // Pull listed players out of the displayed lineup entirely (injury / early
    // departure). Validate ids against the active roster, dedupe, and also
    // clear those players from AI pin memory so a subsequent regenerate
    // doesn't resurrect them. Position locks are intentionally LEFT INTACT —
    // they're explicit, persistent coach intent and have their own UI for
    // removal; the explanation surfaces a hint when locks would resurrect a
    // removed player.
    const validPlayerIds = new Set(activePlayers.map((p) => p.id));
    const removeIds = Array.from(
      new Set((aiResponse.removePlayerIds ?? []).filter((pid) => validPlayerIds.has(pid))),
    );
    const explanationText =
      aiResponse.explanation?.trim() || "Removing the requested player(s) from this lineup.";
    if (removeIds.length === 0) {
      res.json({
        kind: "answer",
        text:
          explanationText +
          " (I couldn't match a roster player to that name — try the player's full or first name.)",
      });
      return;
    }
    const removedNames = removeIds
      .map((pid) => allPlayers.find((p) => p.id === pid)?.name)
      .filter((n): n is string => !!n);

    // Drop their AI memory pins so the next regenerate doesn't bring them
    // back. If this fails we MUST tell the client — silently succeeding
    // would mean the next regenerate quietly resurrects the removed player,
    // directly violating the coach's stated intent.
    let memoryCleared = true;
    let memoryWarning = "";
    try {
      await db.transaction(async (tx) => {
        for (const pid of removeIds) {
          await tx
            .delete(aiPinnedAssignmentsTable)
            .where(
              and(
                eq(aiPinnedAssignmentsTable.gameId, params.data.id),
                eq(aiPinnedAssignmentsTable.playerId, pid),
              ),
            );
        }
      });
    } catch (err) {
      req.log.error({ err }, "Failed to clear AI pin memory for removed players");
      memoryCleared = false;
      memoryWarning =
        " (Couldn't clear my memory of prior pins for them — they may come back on the next regenerate; tap Reset on the AI memory chip to be safe.)";
    }

    // Surface a hint if any of the removed players still have position locks
    // — those will resurrect the player on the next Generate.
    const lockedRemoved = (await db
      .select()
      .from(lineupLocksTable)
      .where(eq(lineupLocksTable.gameId, params.data.id)))
      .filter((l) => removeIds.includes(l.playerId))
      .map((l) => allPlayers.find((p) => p.id === l.playerId)?.name)
      .filter((n): n is string => !!n);
    const lockHint =
      lockedRemoved.length > 0
        ? ` (Heads up — ${Array.from(new Set(lockedRemoved)).join(", ")} still has position locks; clear them if you don't want them resurrected on the next regenerate.)`
        : "";

    // Refresh memory count for the client indicator. If the clear failed,
    // we still want a fresh count so the indicator shows the truth.
    let memoryCount = 0;
    try {
      const remainingMemory = await db
        .select({ id: aiPinnedAssignmentsTable.id })
        .from(aiPinnedAssignmentsTable)
        .where(eq(aiPinnedAssignmentsTable.gameId, params.data.id));
      memoryCount = remainingMemory.length;
    } catch (err) {
      req.log.error({ err }, "Failed to read AI pin memory count after remove");
    }

    res.json({
      kind: "remove",
      explanation: explanationText + lockHint + memoryWarning,
      removePlayerIds: removeIds,
      removedPlayerNames: removedNames,
      memoryCount,
      memoryCleared,
    });
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

  // Helper: drop a pin if it conflicts with a lock. Returns null if dropped.
  // When `recordDrop` is true, also pushes a friendly message to droppedAiPins
  // so we can surface it to the coach in the explanation.
  const droppedAiPins: string[] = [];
  const filterAgainstLocks = (
    p: PinnedAssignment,
    recordDrop: boolean,
  ): PinnedAssignment | null => {
    if (lockPlayerInning.has(`${p.playerId}|${p.inning}`)) {
      const lockedHere = lockRows.find(
        (l) => l.playerId === p.playerId && l.inning === p.inning,
      );
      if (lockedHere && lockedHere.position !== p.position) {
        if (recordDrop) {
          droppedAiPins.push(
            `${playerNameByIdForExplain.get(p.playerId) ?? `Player ${p.playerId}`} is locked at ${lockedHere.position} in inning ${p.inning}`,
          );
        }
        return null;
      }
    }
    if (p.position !== "Bench") {
      const owner = lockFieldPosByInning.get(p.inning)?.get(p.position);
      if (owner != null && owner !== p.playerId) {
        if (recordDrop) {
          droppedAiPins.push(
            `${playerNameByIdForExplain.get(owner) ?? `Player ${owner}`} is locked at ${p.position} in inning ${p.inning}`,
          );
        }
        return null;
      }
    }
    return p;
  };

  // Step 1: filter the *new* AI pins against locks (record drops so the coach
  // is told why their just-issued instruction wasn't honored).
  const honoredNewAiPins: PinnedAssignment[] = [];
  for (const p of pinned) {
    const kept = filterAgainstLocks(p, true);
    if (kept) honoredNewAiPins.push(kept);
  }

  // Step 2: load remembered AI pins from prior turns. The coach expects "tell
  // the AI to change X → it stays changed when I ask about Y later." We layer
  // memory pins on top of new pins (new pins win on conflict by player+inning
  // OR by inning+position). Memory pins that conflict with existing locks are
  // silently dropped (the coach already saw the lock-conflict warning when
  // they were first issued).
  const memoryRows = (await db
    .select()
    .from(aiPinnedAssignmentsTable)
    .where(eq(aiPinnedAssignmentsTable.gameId, params.data.id))).filter(
    (m) => m.inning >= 1 && m.inning <= game.innings && validPlayerIds.has(m.playerId),
  );
  const newPinPlayerInning = new Set(
    honoredNewAiPins.map((p) => `${p.playerId}|${p.inning}`),
  );
  const newPinFieldPosByInning = new Map<number, Set<string>>();
  for (const p of honoredNewAiPins) {
    if (p.position === "Bench") continue;
    if (!newPinFieldPosByInning.has(p.inning)) newPinFieldPosByInning.set(p.inning, new Set());
    newPinFieldPosByInning.get(p.inning)!.add(p.position);
  }
  const honoredMemoryPins: PinnedAssignment[] = [];
  for (const m of memoryRows) {
    if (newPinPlayerInning.has(`${m.playerId}|${m.inning}`)) continue;
    if (m.position !== "Bench" && newPinFieldPosByInning.get(m.inning)?.has(m.position)) continue;
    const kept = filterAgainstLocks(
      { playerId: m.playerId, inning: m.inning, position: m.position },
      false,
    );
    if (kept) honoredMemoryPins.push(kept);
  }

  // Final AI-derived pin set we'll persist as the new memory state. Dedupe
  // defensively so the unique-index inserts can never fail mid-transaction:
  // the AI can produce two pins for the same (player, inning) or two players
  // at the same (inning, position), and even though the generator tolerates
  // it (later wins), the ai_pinned_assignments unique indexes do not. NEW
  // pins always beat MEMORY pins (memory is appended after new), and we
  // resolve same-slot collisions in append order — first wins.
  const aiPinsToRemember: PinnedAssignment[] = [];
  const seenPlayerInning = new Set<string>();
  const seenFieldSlot = new Set<string>();
  for (const p of [...honoredNewAiPins, ...honoredMemoryPins]) {
    const piKey = `${p.playerId}|${p.inning}`;
    if (seenPlayerInning.has(piKey)) continue;
    if (p.position !== "Bench") {
      const slotKey = `${p.inning}|${p.position}`;
      if (seenFieldSlot.has(slotKey)) continue;
      seenFieldSlot.add(slotKey);
    }
    seenPlayerInning.add(piKey);
    aiPinsToRemember.push(p);
  }

  // Combine AI pins + locks for the generator.
  pinned.length = 0;
  pinned.push(...aiPinsToRemember);
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

  // Persist the AI pin memory so the next AI call honors prior decisions.
  // Replace the entire memory set in one transaction (delete-then-insert) —
  // simpler than per-row upsert and keeps memory aligned with what we just
  // generated. If persistence fails we still return the generated preview;
  // memory just won't survive (logged for diagnostics).
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(aiPinnedAssignmentsTable)
        .where(eq(aiPinnedAssignmentsTable.gameId, params.data.id));
      if (aiPinsToRemember.length > 0) {
        await tx.insert(aiPinnedAssignmentsTable).values(
          aiPinsToRemember.map((p) => ({
            gameId: params.data.id,
            playerId: p.playerId,
            inning: p.inning,
            position: p.position,
          })),
        );
      }
    });
  } catch (err) {
    req.log.error({ err }, "Failed to persist AI pin memory");
  }

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
    memoryCount: aiPinsToRemember.length,
  });
});

// List the AI memory pins for a game (count + details for the "AI memory"
// indicator in the UI).
router.get("/games/:id/ai-pins", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = ParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }
  if (!(await getOwnedGame(userId, params.data.id))) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const rows = await db
    .select({
      id: aiPinnedAssignmentsTable.id,
      playerId: aiPinnedAssignmentsTable.playerId,
      playerName: playersTable.name,
      inning: aiPinnedAssignmentsTable.inning,
      position: aiPinnedAssignmentsTable.position,
    })
    .from(aiPinnedAssignmentsTable)
    .innerJoin(playersTable, eq(aiPinnedAssignmentsTable.playerId, playersTable.id))
    .where(eq(aiPinnedAssignmentsTable.gameId, params.data.id))
    .orderBy(aiPinnedAssignmentsTable.inning, aiPinnedAssignmentsTable.id);
  res.json({ pins: rows, count: rows.length });
});

// Clear all remembered AI pins for a game ("Reset AI memory" button).
router.delete("/games/:id/ai-pins", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = ParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }
  if (!(await getOwnedGame(userId, params.data.id))) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const result = await db
    .delete(aiPinnedAssignmentsTable)
    .where(eq(aiPinnedAssignmentsTable.gameId, params.data.id))
    .returning();
  res.json({ deleted: result.length });
});

export default router;
