import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import {
  parseIfMatch,
  rejectBadIfMatch,
  sendConflict,
  versionedUpdate,
} from "../lib/concurrency";
import { idempotent } from "../middlewares/idempotency";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  practicesTable,
  practiceAttendanceTable,
  playersTable,
  type Practice,
  type PracticeBlockJson,
} from "@workspace/db";
import {
  CreatePracticeBody,
  GetPracticeParams,
  UpdatePracticeParams,
  UpdatePracticeBody,
  DeletePracticeParams,
  ReplacePracticeAttendanceParams,
  ReplacePracticeAttendanceBody,
} from "@workspace/api-zod";

const router: IRouter = Router();
router.use("/practices", gateWrites("partial"));

/**
 * Trim, drop empties, dedupe, and cap a focus-points array. Centralized
 * so POST + PATCH apply identical normalization (no surprise that
 * "Bunt defense " and "bunt defense" become two bullets). Case-folded
 * for dedup but original casing preserved so the coach's wording shows
 * up in the UI exactly as they typed it. Cap matches the OpenAPI
 * `maxItems: 20` so the route's effective limit stays the same as the
 * client validator.
 */
function dedupeFocusPoints(input: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().slice(0, 200);
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Verify a practice belongs to the calling coach. Returns the row on
 * success, or null on failure (404). Centralized because every detail/
 * mutation route below needs the same ownership gate.
 */
async function getOwnedPractice(
  userId: string,
  practiceId: number,
): Promise<Practice | null> {
  const [row] = await db
    .select()
    .from(practicesTable)
    .where(
      and(
        eq(practicesTable.id, practiceId),
        eq(practicesTable.userId, userId),
        isNull(practicesTable.deletedAt),
      ),
    );
  return row ?? null;
}

router.get("/practices", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const practices = await db
    .select()
    .from(practicesTable)
    .where(
      and(eq(practicesTable.userId, userId), isNull(practicesTable.deletedAt)),
    )
    .orderBy(desc(practicesTable.date));

  if (practices.length === 0) {
    res.json([]);
    return;
  }

  // Per-practice attendance roll-up: marked = total rows; present = attended=true.
  const practiceIds = practices.map((p) => p.id);
  const attendanceRows = await db
    .select({
      practiceId: practiceAttendanceTable.practiceId,
      marked: sql<number>`count(*)::int`,
      present: sql<number>`sum(case when ${practiceAttendanceTable.attended} then 1 else 0 end)::int`,
    })
    .from(practiceAttendanceTable)
    .where(
      and(
        eq(practiceAttendanceTable.userId, userId),
        inArray(practiceAttendanceTable.practiceId, practiceIds),
      ),
    )
    .groupBy(practiceAttendanceTable.practiceId);

  const attByPid = new Map(
    attendanceRows.map((r) => [r.practiceId, { marked: r.marked, present: r.present }]),
  );

  res.json(
    practices.map((p) => ({
      ...p,
      attendanceMarked: attByPid.get(p.id)?.marked ?? 0,
      attendancePresent: attByPid.get(p.id)?.present ?? 0,
    })),
  );
});

router.post("/practices", idempotent("createPractice"), async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = CreatePracticeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const [inserted] = await db
    .insert(practicesTable)
    .values({
      userId,
      date: new Date(d.date),
      durationMinutes: d.durationMinutes ?? 90,
      title: d.title ?? null,
      focusAreas: d.focusAreas ?? [],
      // focusPoints capped + length-limited at the schema layer; we
      // additionally trim/dedup here so two flavors of whitespace don't
      // create dupes in the bullet list.
      focusPoints: dedupeFocusPoints(d.focusPoints ?? []),
      blocks: [],
      notes: d.notes ?? null,
    })
    .returning();
  res.status(201).json(inserted);
});

router.get("/practices/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = GetPracticeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const practice = await getOwnedPractice(userId, params.data.id);
  if (!practice) {
    res.status(404).json({ error: "Practice not found" });
    return;
  }
  const attendance = await db
    .select()
    .from(practiceAttendanceTable)
    .where(
      and(
        eq(practiceAttendanceTable.userId, userId),
        eq(practiceAttendanceTable.practiceId, practice.id),
      ),
    );
  res.json({ ...practice, attendance });
});

router.patch("/practices/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = UpdatePracticeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ifm = parseIfMatch(req);
  if (!ifm.ok) {
    rejectBadIfMatch(res);
    return;
  }
  const parsed = UpdatePracticeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const owned = await getOwnedPractice(userId, params.data.id);
  if (!owned) {
    res.status(404).json({ error: "Practice not found" });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const d = parsed.data;
  if (d.date !== undefined) updates.date = new Date(d.date);
  if (d.durationMinutes !== undefined) updates.durationMinutes = d.durationMinutes;
  if (d.title !== undefined) updates.title = d.title;
  if (d.focusAreas !== undefined) updates.focusAreas = d.focusAreas;
  if (d.focusPoints !== undefined) {
    updates.focusPoints = dedupeFocusPoints(d.focusPoints);
  }
  if (d.notes !== undefined) updates.notes = d.notes;
  if (d.blocks !== undefined) {
    // Normalize: re-derive orderIndex from array position so the saved
    // order is canonical regardless of what the client sent. The UI uses
    // orderIndex to render the timeline, and trusting array order would
    // let a stale client overwrite a fresh reorder.
    const blocks: PracticeBlockJson[] = d.blocks.map((b, i) => ({
      id: b.id,
      orderIndex: i,
      title: b.title,
      durationMinutes: b.durationMinutes,
      description: b.description,
      drillType: b.drillType,
      focusAreas: b.focusAreas,
      // Preserve AI-generated player groups when present. Stored as plain
      // names; cap counts so a malformed payload can't bloat the JSONB.
      ...(Array.isArray(b.groups) && b.groups.length > 0
        ? {
            groups: b.groups.slice(0, 6).map((g) => ({
              label: String(g.label ?? "").trim().slice(0, 60),
              playerNames: (Array.isArray(g.playerNames) ? g.playerNames : [])
                .filter((n): n is string => typeof n === "string")
                .map((n) => n.trim())
                .filter((n) => n.length > 0)
                .slice(0, 30),
            })).filter((g) => g.label.length > 0 && g.playerNames.length > 0),
          }
        : {}),
      // Round-trip the AI-tagged "this block addresses these focus
      // points" array. Cap so a malformed payload can't bloat JSONB.
      ...(Array.isArray(b.addressesFocusPoints) && b.addressesFocusPoints.length > 0
        ? {
            addressesFocusPoints: b.addressesFocusPoints
              .filter((s): s is string => typeof s === "string")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
              .slice(0, 10),
          }
        : {}),
    }));
    updates.blocks = blocks;
  }

  if (Object.keys(updates).length === 1) {
    // only updatedAt — caller sent an empty patch
    res.status(400).json({ error: "No fields provided" });
    return;
  }

  const result = await versionedUpdate(db, practicesTable, {
    set: updates,
    where: and(
      eq(practicesTable.id, owned.id),
      eq(practicesTable.userId, userId),
    ),
    ifMatch: ifm.version,
  });
  if (result.kind === "conflict") {
    sendConflict(res, result.current);
    return;
  }
  if (result.kind === "missing") {
    res.status(404).json({ error: "Practice not found" });
    return;
  }
  res.json(result.row);
});

// Soft delete — see games.ts / players.ts. Practice attendance rows
// stay intact and reappear on restore.
router.delete("/practices/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = DeletePracticeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ifm = parseIfMatch(req);
  if (!ifm.ok) {
    rejectBadIfMatch(res);
    return;
  }
  const result = await versionedUpdate(db, practicesTable, {
    set: { deletedAt: new Date() },
    where: and(
      eq(practicesTable.id, params.data.id),
      eq(practicesTable.userId, userId),
      isNull(practicesTable.deletedAt),
    ),
    ifMatch: ifm.version,
  });
  if (result.kind === "conflict") {
    sendConflict(res, result.current);
    return;
  }
  if (result.kind === "missing") {
    res.status(404).json({ error: "Practice not found" });
    return;
  }
  res.status(204).end();
});

// Restore — clears `deletedAt`. Looks up without the soft-delete
// filter so we can find the row we just trashed.
router.post("/practices/:id/restore", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = DeletePracticeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [practice] = await db
    .update(practicesTable)
    .set({ deletedAt: null, rowVersion: sql`${practicesTable.rowVersion} + 1` })
    .where(
      and(
        eq(practicesTable.id, params.data.id),
        eq(practicesTable.userId, userId),
      ),
    )
    .returning();
  if (!practice) {
    res.status(404).json({ error: "Practice not found" });
    return;
  }
  res.json(practice);
});

router.put("/practices/:id/attendance", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = ReplacePracticeAttendanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ReplacePracticeAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const owned = await getOwnedPractice(userId, params.data.id);
  if (!owned) {
    res.status(404).json({ error: "Practice not found" });
    return;
  }

  // Filter to players this coach actually owns — no cross-tenant writes.
  const playerIds = Array.from(new Set(parsed.data.entries.map((e) => e.playerId)));
  const validRows =
    playerIds.length === 0
      ? []
      : await db
          .select({ id: playersTable.id })
          .from(playersTable)
          .where(
            and(
              eq(playersTable.userId, userId),
              inArray(playersTable.id, playerIds),
            ),
          );
  const validPids = new Set(validRows.map((r) => r.id));
  const filtered = parsed.data.entries.filter((e) => validPids.has(e.playerId));

  // Replace-by-upsert per row. Rows for players NOT in the request are
  // intentionally left alone — the UI only sends entries for players the
  // coach actually toggled, so we don't blow away unrelated state.
  await db.transaction(async (tx) => {
    for (const entry of filtered) {
      await tx
        .insert(practiceAttendanceTable)
        .values({
          userId,
          practiceId: owned.id,
          playerId: entry.playerId,
          attended: entry.attended,
          notes: entry.notes ?? null,
        })
        .onConflictDoUpdate({
          target: [
            practiceAttendanceTable.practiceId,
            practiceAttendanceTable.playerId,
          ],
          set: {
            attended: entry.attended,
            notes: entry.notes ?? null,
            recordedAt: new Date(),
            rowVersion: sql`${practiceAttendanceTable.rowVersion} + 1`,
          },
        });
    }
  });

  const all = await db
    .select()
    .from(practiceAttendanceTable)
    .where(
      and(
        eq(practiceAttendanceTable.userId, userId),
        eq(practiceAttendanceTable.practiceId, owned.id),
      ),
    );
  res.json(all);
});

export default router;
