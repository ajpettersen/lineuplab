import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
      and(eq(practicesTable.id, practiceId), eq(practicesTable.userId, userId)),
    );
  return row ?? null;
}

router.get("/practices", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const practices = await db
    .select()
    .from(practicesTable)
    .where(eq(practicesTable.userId, userId))
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

router.post("/practices", async (req, res): Promise<void> => {
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
    }));
    updates.blocks = blocks;
  }

  if (Object.keys(updates).length === 1) {
    // only updatedAt — caller sent an empty patch
    res.status(400).json({ error: "No fields provided" });
    return;
  }

  const [updated] = await db
    .update(practicesTable)
    .set(updates)
    .where(
      and(eq(practicesTable.id, owned.id), eq(practicesTable.userId, userId)),
    )
    .returning();
  res.json(updated);
});

router.delete("/practices/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = DeletePracticeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const result = await db
    .delete(practicesTable)
    .where(
      and(eq(practicesTable.id, params.data.id), eq(practicesTable.userId, userId)),
    )
    .returning({ id: practicesTable.id });
  if (result.length === 0) {
    res.status(404).json({ error: "Practice not found" });
    return;
  }
  res.status(204).end();
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
