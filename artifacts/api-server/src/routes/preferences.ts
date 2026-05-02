import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, userPreferencesTable, type UserPreferences } from "@workspace/db";

const router: IRouter = Router();

const UpdateBody = z.object({
  defaultInnings: z.number().int().min(1).max(15).optional(),
  defaultMaxInningsPerPosition: z.number().int().min(1).max(15).optional(),
  defaultMaxInningsBench: z.number().int().min(0).max(15).optional(),
  defaultEnsureAllPositions: z.boolean().optional(),
  defaultPitcherRotation: z.boolean().optional(),
});

/**
 * Lazy-create + fetch user preferences. Defaults come from the column
 * defaults declared on the table — the empty insert just materializes a row
 * with all defaults.
 */
async function getOrCreateForUser(userId: string): Promise<UserPreferences> {
  await db
    .insert(userPreferencesTable)
    .values({ userId })
    .onConflictDoNothing({ target: userPreferencesTable.userId });
  const [row] = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.userId, userId));
  return row!;
}

router.get("/preferences", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const prefs = await getOrCreateForUser(userId);
  res.json(prefs);
});

router.patch("/preferences", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  await getOrCreateForUser(userId);
  const updates: Record<string, unknown> = { updatedAt: sql`now()` };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) updates[k] = v;
  }
  const [updated] = await db
    .update(userPreferencesTable)
    .set(updates)
    .where(eq(userPreferencesTable.userId, userId))
    .returning();
  res.json(updated);
});

export default router;
