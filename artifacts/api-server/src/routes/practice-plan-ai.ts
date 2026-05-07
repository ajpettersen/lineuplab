import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  practicesTable,
  practiceAttendanceTable,
  playersTable,
  type PracticeBlockJson,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { chargeAiCall } from "../lib/ai-usage";
import {
  GeneratePracticePlanParams,
  GeneratePracticePlanBody,
} from "@workspace/api-zod";

const router: IRouter = Router();
router.use("/practices", gateWrites("partial"));

/**
 * Valid drill type and focus area keys the model is allowed to emit.
 * Mirrored from `artifacts/baseball-lineup/src/lib/practice-focus-areas.ts`.
 * Anything outside these sets is coerced to a safe default before being
 * persisted so a hallucinated category doesn't break the UI's color map.
 */
const VALID_DRILL_TYPES = new Set([
  "warmup",
  "drill",
  "scrimmage",
  "conditioning",
  "meeting",
]);
const VALID_FOCUS_AREAS = new Set([
  "hitting",
  "bunting",
  "baserunning",
  "infield",
  "outfield",
  "pitching",
  "catching",
  "situational",
  "conditioning",
  "team",
]);

const SYSTEM_PROMPT = `You are an assistant for a youth baseball coach designing a practice plan.

Your job: given the practice DURATION (minutes), the FOCUS AREAS the coach wants to work on, the team ROSTER (with each player's preferred positions and pitcher status), optional ATTENDANCE for today's practice, any REQUIRED DRILLS the coach wants guaranteed, free-text COACH NOTES, and (when available) a digest of the COACH'S RECENT STYLE based on past practices they ran, return a time-blocked plan as a JSON object.

Rules for the plan:
- The blocks array must cover the full duration. Sum of block durationMinutes must equal the requested duration (±2 minutes is acceptable).
- Always start with a "warmup" block (10–15 min) and end with either a brief team meeting (5 min) OR a conditioning block (5–10 min).
- For each FOCUS AREA the coach picked, include AT LEAST one drill block that targets it. Distribute time roughly proportional to the count of focus areas.
- REQUIRED DRILLS: every entry in the REQUIRED DRILLS list MUST appear as its own block in the plan. Use the coach's wording for the title (lightly cleaned up if needed) and write a fresh description for it. Tag the block's focusAreas appropriately — if you can't tell which focus area it belongs to, pick the closest match from the picked focus areas. Required drills count toward the duration budget, so shorten or merge other blocks to make room.
- Drills must be age-appropriate for youth baseball (ages 8–14). Be specific — name the drill (e.g. "4-corners infield", "tee work + soft toss combo", "pitchers' fielding practice (PFP)") and describe how to run it in 1–3 sentences with concrete coaching cues.
- If the coach mentioned specific players in COACH NOTES, weave them into the relevant blocks (e.g. "Sarah works at catcher with Coach during this block").
- If a COACH'S RECENT STYLE digest is provided, prefer drill names, naming conventions, and block durations the coach has used before WHEN they fit today's focus areas. Reuse 1–3 of their go-to drills where appropriate, and keep block lengths in the same ballpark as their typical pattern. Don't force drills that don't match today's focus — variety matters too. Do NOT reproduce any prior practice verbatim end-to-end; adapt the structure to today's focus areas and duration, and mix in at least one fresh drill or variation. Briefly mention in the rationale which past patterns you leaned on.

PLAYER GROUPS (defensive drills only):
- For blocks whose focusAreas include "infield", "outfield", "catching", or "pitching", you MAY include a "groups" array that splits players into stations based on their preferred positions. Use this when the drill genuinely benefits from grouping (e.g. infield reps split by position, outfield rotations, catcher progression with bullpens running parallel). Skip groups for blocks where the whole team works as one unit.
- When you emit groups, only include players from the ROSTER below. If ATTENDANCE is provided and at least one player is marked present, ONLY use players marked present (skip absent and unmarked). If no attendance is marked yet, use the full active roster.
- Match each player to a group whose label fits their preferredPositions when possible. A player with no preferred positions can be slotted anywhere needed to balance group sizes. Keep groups roughly equal in size (±1 player). Use plain player names exactly as they appear in the roster (no jersey numbers).
- Group labels should be short and concrete (e.g. "Infielders", "Outfielders", "Catchers w/ Coach", "Pitchers — bullpen", "Group A — corners", "Group B — middle infield"). Do NOT emit groups for warmups, hitting stations, scrimmages, conditioning, or meetings.
- Each block has these fields exactly: title (short), durationMinutes (positive int), description (1–3 sentences), drillType (one of "warmup" | "drill" | "scrimmage" | "conditioning" | "meeting"), focusAreas (array of focus-area keys this block targets — subset of the picked focus areas), and OPTIONALLY groups (array of {label: string, playerNames: string[]}). Omit "groups" entirely for blocks that don't need it.

Return ONLY a JSON object — no markdown fences, no extra prose. Schema:
{
  "blocks": [
    { "title": string, "durationMinutes": integer, "description": string, "drillType": string, "focusAreas": string[], "groups"?: [{"label": string, "playerNames": string[]}] }
  ],
  "rationale": string
}`;

/**
 * Build a compact natural-language digest of the coach's past practice style
 * to feed back into the AI generator. We summarize up to the 8 most recent
 * past practices that actually have planned blocks (skipping empty drafts),
 * so the model can pick up on recurring drills, naming conventions, and
 * typical block durations.
 *
 * Two complementary signals:
 *  1. Aggregate "favorites" — top drill titles by frequency across all blocks
 *     in the window, plus typical duration per drill type. Lets the model
 *     reuse the coach's go-to drills even when no single past practice fully
 *     matches today's focus areas.
 *  2. Up to 4 recent practice skeletons (date, focus areas, blocks list with
 *     title + drillType + duration only — descriptions stripped to keep the
 *     prompt small). Gives the model concrete examples of how the coach
 *     structures a plan end-to-end.
 *
 * Returns an empty string when there are no past plans, so the caller can
 * skip the section entirely and avoid leading the model with an empty block.
 */
function buildCoachStyleDigest(
  pastPractices: Array<{
    date: Date;
    durationMinutes: number;
    focusAreas: string[];
    blocks: PracticeBlockJson[];
  }>,
): string {
  if (pastPractices.length === 0) return "";

  // Frequency of each drill title (case-insensitive, trimmed) so the model
  // can spot the coach's go-to drills. We keep the original casing of the
  // first occurrence for display.
  const drillTitleCounts = new Map<string, { display: string; count: number }>();
  // Sum of durations + occurrence count per drill type, used to surface a
  // typical-length hint (e.g. "warmup ~12 min, drill ~22 min").
  const drillTypeDurations = new Map<string, { total: number; count: number }>();
  // Count of how many times each focus area shows up across past practices.
  const focusCounts = new Map<string, number>();

  for (const p of pastPractices) {
    for (const f of p.focusAreas) {
      focusCounts.set(f, (focusCounts.get(f) ?? 0) + 1);
    }
    for (const b of p.blocks) {
      const key = b.title.trim().toLowerCase();
      if (key.length > 0) {
        const existing = drillTitleCounts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          drillTitleCounts.set(key, { display: b.title.trim(), count: 1 });
        }
      }
      const dt = drillTypeDurations.get(b.drillType) ?? { total: 0, count: 0 };
      dt.total += b.durationMinutes;
      dt.count += 1;
      drillTypeDurations.set(b.drillType, dt);
    }
  }

  const topDrills = Array.from(drillTitleCounts.values())
    .filter((d) => d.count >= 2) // only highlight a drill if it's been used more than once
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((d) => `"${d.display}" (used ${d.count}x)`)
    .join(", ");

  const typicalDurations = Array.from(drillTypeDurations.entries())
    .map(([type, { total, count }]) => `${type} ~${Math.round(total / count)}m`)
    .join(", ");

  const topFocus = Array.from(focusCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => `${key} (${count}x)`)
    .join(", ");

  // Recent skeletons — most recent 4. Strip descriptions to keep tokens low;
  // the titles + drillType + duration carry the structural pattern. Also
  // hard-cap per-block title length and blocks-per-skeleton so the digest
  // can never balloon the prompt and crowd out the 1800-token completion
  // budget when a coach has unusually long titles or very block-heavy plans.
  const MAX_TITLE_CHARS = 60;
  const MAX_BLOCKS_PER_SKELETON = 8;
  const MAX_FOCUS_PER_BLOCK = 3;
  const truncateTitle = (t: string): string =>
    t.length > MAX_TITLE_CHARS ? `${t.slice(0, MAX_TITLE_CHARS - 1)}…` : t;
  const recentSkeletons = pastPractices
    .slice(0, 4)
    .map((p, i) => {
      const dateStr = p.date.toISOString().slice(0, 10);
      const blocksLine = p.blocks
        .slice() // don't mutate caller's array
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .slice(0, MAX_BLOCKS_PER_SKELETON)
        .map((b) => {
          const focus = b.focusAreas.slice(0, MAX_FOCUS_PER_BLOCK);
          return `    ${b.durationMinutes}m ${b.drillType}: "${truncateTitle(b.title)}"${
            focus.length > 0 ? ` [${focus.join(",")}]` : ""
          }`;
        })
        .join("\n");
      const truncatedNote =
        p.blocks.length > MAX_BLOCKS_PER_SKELETON
          ? `\n    …(+${p.blocks.length - MAX_BLOCKS_PER_SKELETON} more blocks)`
          : "";
      return `  ${i + 1}. ${dateStr} (${p.durationMinutes}m, focus: ${p.focusAreas.join(", ") || "—"}):\n${blocksLine}${truncatedNote}`;
    })
    .join("\n");

  const sections: string[] = [];
  if (topDrills.length > 0) sections.push(`Favorite drills: ${topDrills}`);
  if (typicalDurations.length > 0)
    sections.push(`Typical block lengths: ${typicalDurations}`);
  if (topFocus.length > 0) sections.push(`Recurring focus areas: ${topFocus}`);
  if (recentSkeletons.length > 0)
    sections.push(`Recent practice skeletons (most recent first):\n${recentSkeletons}`);

  return sections.join("\n");
}

interface RawBlock {
  title?: unknown;
  durationMinutes?: unknown;
  description?: unknown;
  drillType?: unknown;
  focusAreas?: unknown;
  groups?: unknown;
}
interface RawGroup {
  label?: unknown;
  playerNames?: unknown;
}

const DEFENSIVE_FOCUS_KEYS = new Set([
  "infield",
  "outfield",
  "catching",
  "pitching",
]);

interface RawPlan {
  blocks?: unknown;
  rationale?: unknown;
}

function parseAiPlan(
  raw: string,
  pickedFocusAreas: string[],
  validPlayerNames: Set<string>,
): { blocks: PracticeBlockJson[]; rationale: string } | null {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const r = obj as RawPlan;
  if (!Array.isArray(r.blocks) || r.blocks.length === 0) return null;

  // Sanitize each block. Coerce out-of-range / unknown values to safe
  // defaults rather than dropping the block — the UI is editable so the
  // coach can tweak anything off, but missing blocks would leave a hole
  // in the timeline.
  const fallbackFocus =
    pickedFocusAreas.find((f) => VALID_FOCUS_AREAS.has(f)) ?? "drill";
  const blocks: PracticeBlockJson[] = (r.blocks as RawBlock[])
    .map((b, i): PracticeBlockJson | null => {
      if (!b || typeof b !== "object") return null;
      const title = typeof b.title === "string" && b.title.trim().length > 0
        ? b.title.trim().slice(0, 200)
        : `Block ${i + 1}`;
      const durRaw = typeof b.durationMinutes === "number" ? b.durationMinutes : NaN;
      const durationMinutes = Number.isFinite(durRaw) && durRaw > 0
        ? Math.min(240, Math.max(1, Math.round(durRaw)))
        : 10;
      const description = typeof b.description === "string"
        ? b.description.trim().slice(0, 2000)
        : "";
      const drillType =
        typeof b.drillType === "string" && VALID_DRILL_TYPES.has(b.drillType)
          ? b.drillType
          : "drill";
      const rawFocus = Array.isArray(b.focusAreas) ? b.focusAreas : [];
      const focusAreas = rawFocus
        .filter((f): f is string => typeof f === "string" && VALID_FOCUS_AREAS.has(f))
        .slice(0, 5);
      const finalFocus = focusAreas.length > 0 ? focusAreas : [fallbackFocus];

      // Sanitize groups: only allow them for defensive blocks, drop unknown
      // player names so the AI can't smuggle in fake kids, and cap counts so
      // a runaway response can't bloat the JSONB column. Setting to undefined
      // (vs an empty array) keeps the UI's "has groups?" check trivial.
      let groups: { label: string; playerNames: string[] }[] | undefined;
      const isDefensive = finalFocus.some((f) => DEFENSIVE_FOCUS_KEYS.has(f));
      if (isDefensive && Array.isArray(b.groups)) {
        const cleaned = (b.groups as RawGroup[])
          .map((g): { label: string; playerNames: string[] } | null => {
            if (!g || typeof g !== "object") return null;
            const label = typeof g.label === "string" ? g.label.trim().slice(0, 60) : "";
            const rawNames = Array.isArray(g.playerNames) ? g.playerNames : [];
            const playerNames = rawNames
              .filter((n): n is string => typeof n === "string")
              .map((n) => n.trim())
              .filter((n) => n.length > 0 && validPlayerNames.has(n))
              .slice(0, 30);
            if (label.length === 0 || playerNames.length === 0) return null;
            return { label, playerNames };
          })
          .filter((g): g is { label: string; playerNames: string[] } => g !== null)
          .slice(0, 6);
        if (cleaned.length > 0) groups = cleaned;
      }

      return {
        id: randomUUID(),
        orderIndex: i,
        title,
        durationMinutes,
        description,
        drillType,
        focusAreas: finalFocus,
        ...(groups ? { groups } : {}),
      };
    })
    .filter((b): b is PracticeBlockJson => b !== null);

  if (blocks.length === 0) return null;

  const rationale =
    typeof r.rationale === "string" && r.rationale.trim().length > 0
      ? r.rationale.trim().slice(0, 500)
      : "Time-blocked plan covering the focus areas you selected.";
  return { blocks, rationale };
}

router.post(
  "/practices/:id/generate-plan",
  async (req, res): Promise<void> => {
    const userId = req.ownerUserId!;
    const params = GeneratePracticePlanParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = GeneratePracticePlanBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const [practice] = await db
      .select()
      .from(practicesTable)
      .where(
        and(
          eq(practicesTable.id, params.data.id),
          eq(practicesTable.userId, userId),
          isNull(practicesTable.deletedAt),
        ),
      );
    if (!practice) {
      res.status(404).json({ error: "Practice not found" });
      return;
    }

    // Sanitize requested focus areas so the prompt only uses keys the UI
    // can render. Drop unknowns silently — the coach picked them via a
    // chip menu so this is defensive only.
    const pickedFocusAreas = Array.from(
      new Set(body.data.focusAreas.filter((f) => VALID_FOCUS_AREAS.has(f))),
    );
    if (pickedFocusAreas.length === 0) {
      res.status(400).json({ error: "Pick at least one focus area" });
      return;
    }

    // Active roster scoped to this coach (gives the AI player names + pitcher
    // status it can reference in drill descriptions). Plus today's attendance
    // (so AI-generated defensive groups can be limited to who's actually
    // here). Run in parallel with the past-practices query — they're all
    // small reads against independent tables and we always need them before
    // calling OpenAI.
    const [allPlayers, attendanceRows, recentPracticeRows] = await Promise.all([
      db
        .select()
        .from(playersTable)
        .where(
          and(eq(playersTable.userId, userId), isNull(playersTable.deletedAt)),
        ),
      db
        .select({
          playerId: practiceAttendanceTable.playerId,
          attended: practiceAttendanceTable.attended,
        })
        .from(practiceAttendanceTable)
        .where(
          and(
            eq(practiceAttendanceTable.userId, userId),
            eq(practiceAttendanceTable.practiceId, params.data.id),
          ),
        ),
      // Filter empty-block drafts at the SQL level so a coach with many
      // recent empty drafts can't starve the digest of real signal. We use
      // jsonb_array_length on the JSONB blocks column — Postgres-specific
      // but `practicesTable.blocks` is already typed as JSONB so this is
      // safe. Exclude the current practice — we only want history, not
      // whatever stub the coach is regenerating against.
      db
        .select({
          date: practicesTable.date,
          durationMinutes: practicesTable.durationMinutes,
          focusAreas: practicesTable.focusAreas,
          blocks: practicesTable.blocks,
        })
        .from(practicesTable)
        .where(
          and(
            eq(practicesTable.userId, userId),
            isNull(practicesTable.deletedAt),
            ne(practicesTable.id, params.data.id),
            sql`jsonb_array_length(${practicesTable.blocks}) > 0`,
          ),
        )
        .orderBy(desc(practicesTable.date))
        .limit(8),
    ]);

    const activePlayers = allPlayers.filter((p) => p.active);
    const validPlayerNames = new Set(activePlayers.map((p) => p.name));

    // Build today's attendance summary. Only "present" matters for grouping
    // — absent/unmarked players are excluded from defensive groups so the
    // coach doesn't get a station diagram that includes kids who aren't
    // there. If nothing is marked yet, we fall through to "use full roster".
    const presentIds = new Set(
      attendanceRows.filter((a) => a.attended === true).map((a) => a.playerId),
    );
    const absentIds = new Set(
      attendanceRows.filter((a) => a.attended === false).map((a) => a.playerId),
    );
    const anyAttendanceMarked = presentIds.size > 0 || absentIds.size > 0;
    const playersForGrouping = anyAttendanceMarked
      ? activePlayers.filter((p) => presentIds.has(p.id))
      : activePlayers;

    const rosterLines =
      activePlayers.length === 0
        ? "(no roster yet — give a generic plan)"
        : activePlayers
            .map((p) => {
              const status = anyAttendanceMarked
                ? presentIds.has(p.id)
                  ? " PRESENT"
                  : absentIds.has(p.id)
                    ? " ABSENT"
                    : " UNMARKED"
                : "";
              return `- ${p.name}${p.number != null ? ` #${p.number}` : ""} preferred=[${(p.preferredPositions ?? []).join(",") || "any"}]${p.canPitch ? " canPitch" : ""}${status}`;
            })
            .join("\n");

    const requiredDrills = (body.data.requiredDrills ?? [])
      .map((d) => (typeof d === "string" ? d.trim() : ""))
      .filter((d) => d.length > 0)
      .slice(0, 10);

    const attendanceLine = anyAttendanceMarked
      ? `Attendance for today: ${presentIds.size} marked present, ${absentIds.size} marked absent. ONLY use the players marked PRESENT above when emitting "groups" on defensive blocks.`
      : `Attendance for today: not marked yet. Use the full active roster (${playersForGrouping.length} players) when emitting defensive "groups".`;

    const styleDigest = buildCoachStyleDigest(recentPracticeRows);

    const userPrompt = `Practice duration: ${body.data.durationMinutes} minutes
Focus areas the coach picked (use these keys verbatim in block focusAreas): ${pickedFocusAreas.join(", ")}
${body.data.ageGroup ? `Age group: ${body.data.ageGroup}\n` : ""}
Roster:
${rosterLines}

${attendanceLine}

Required drills (each MUST appear as its own block):
${requiredDrills.length > 0 ? requiredDrills.map((d, i) => `${i + 1}. ${d}`).join("\n") : "(none)"}

Coach notes (free text, may be empty):
${body.data.coachNotes?.trim() || "(none)"}
${
  styleDigest.length > 0
    ? `\nCOACH'S RECENT STYLE (digest of past practices — lean into these patterns where they fit today's focus):\n${styleDigest}\n`
    : ""
}
Build the time-blocked plan now.`;

    // Hard ceiling on the upstream call so a hung OpenAI request never ties
    // up an Express worker indefinitely (availability/DOS surface). 45s is
    // generous for gpt-5.2 + 1800-token plans and well under the proxy's
    // request timeout.
    const charge = await chargeAiCall(req, "practice-plan");
    if (!charge.ok) { res.status(charge.status).json({ error: charge.error }); return; }

    let raw = "";
    try {
      const completion = await openai.chat.completions.create(
        {
          model: "gpt-5.2",
          max_completion_tokens: 1800,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        },
        { signal: AbortSignal.timeout(45_000) },
      );
      raw = completion.choices[0]?.message?.content ?? "";
    } catch (err) {
      const aborted =
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError");
      req.log.error({ err, aborted }, "Practice plan generation failed");
      res
        .status(aborted ? 504 : 502)
        .json({ error: aborted ? "AI request timed out" : "AI service unavailable" });
      return;
    }

    const parsed = parseAiPlan(raw, pickedFocusAreas, validPlayerNames);
    if (!parsed) {
      req.log.warn({ raw }, "Could not parse practice plan AI response");
      res.status(502).json({ error: "Could not parse AI response" });
      return;
    }

    res.json(parsed);
  },
);

export default router;
