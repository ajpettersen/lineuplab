import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  teamSettingsTable,
  DEFAULT_TEAM_NAME,
  DEFAULT_TEAM_SHORT_NAME,
  type TeamSettings,
} from "@workspace/db";

const router: IRouter = Router();

// PATCH semantics: both fields optional, but at least one must be provided.
const UpdateBody = z
  .object({
    teamName: z.string().trim().min(1, "Team name required").max(80).optional(),
    teamShortName: z.string().trim().min(1, "Short name required").max(20).optional(),
  })
  .refine((v) => v.teamName !== undefined || v.teamShortName !== undefined, {
    message: "Provide teamName or teamShortName",
  });

/**
 * Lazily create + return the user's team settings row. Two coaches signing
 * up at the same time is fine: ON CONFLICT DO NOTHING means whichever
 * INSERT loses just falls back to a SELECT.
 */
async function getOrCreateForUser(userId: string): Promise<TeamSettings> {
  await db
    .insert(teamSettingsTable)
    .values({
      userId,
      teamName: DEFAULT_TEAM_NAME,
      teamShortName: DEFAULT_TEAM_SHORT_NAME,
    })
    .onConflictDoNothing({ target: teamSettingsTable.userId });
  const [row] = await db
    .select()
    .from(teamSettingsTable)
    .where(eq(teamSettingsTable.userId, userId));
  // Should always exist after the upsert above.
  return row!;
}

router.get("/team-settings", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const settings = await getOrCreateForUser(userId);
  res.json(settings);
});

router.patch("/team-settings", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  // Ensure a row exists, then update only the fields the coach actually sent.
  await getOrCreateForUser(userId);
  const patch: { teamName?: string; teamShortName?: string; updatedAt: ReturnType<typeof sql> } = {
    updatedAt: sql`now()`,
  };
  if (parsed.data.teamName !== undefined) patch.teamName = parsed.data.teamName;
  if (parsed.data.teamShortName !== undefined) patch.teamShortName = parsed.data.teamShortName;
  const [updated] = await db
    .update(teamSettingsTable)
    .set(patch)
    .where(eq(teamSettingsTable.userId, userId))
    .returning();
  res.json(updated);
});

export default router;
