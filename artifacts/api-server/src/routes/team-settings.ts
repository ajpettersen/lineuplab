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

// PATCH semantics: every field optional, but at least one must be provided.
const UpdateBody = z
  .object({
    teamName: z.string().trim().min(1, "Team name required").max(80).optional(),
    teamShortName: z.string().trim().min(1, "Short name required").max(20).optional(),
    battingStyle: z.enum(["continuous", "nine_man"]).optional(),
    defaultPitchRuleset: z.string().nullish(),
    defaultAgeGroup: z.string().nullish(),
  })
  .refine(
    (v) =>
      v.teamName !== undefined ||
      v.teamShortName !== undefined ||
      v.battingStyle !== undefined ||
      v.defaultPitchRuleset !== undefined ||
      v.defaultAgeGroup !== undefined,
    { message: "Provide at least one field to update" }
  );

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
  const userId = req.ownerUserId!;
  const settings = await getOrCreateForUser(userId);
  res.json(settings);
});

router.patch("/team-settings", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  // Ensure a row exists, then update only the fields the coach actually sent.
  await getOrCreateForUser(userId);
  const patch: {
    teamName?: string;
    teamShortName?: string;
    battingStyle?: "continuous" | "nine_man";
    defaultPitchRuleset?: string | null;
    defaultAgeGroup?: string | null;
    updatedAt: ReturnType<typeof sql>;
  } = {
    updatedAt: sql`now()`,
  };
  if (parsed.data.teamName !== undefined) patch.teamName = parsed.data.teamName;
  if (parsed.data.teamShortName !== undefined) patch.teamShortName = parsed.data.teamShortName;
  if (parsed.data.battingStyle !== undefined) patch.battingStyle = parsed.data.battingStyle;
  if (parsed.data.defaultPitchRuleset !== undefined)
    patch.defaultPitchRuleset = parsed.data.defaultPitchRuleset ?? null;
  if (parsed.data.defaultAgeGroup !== undefined)
    patch.defaultAgeGroup = parsed.data.defaultAgeGroup ?? null;
  const [updated] = await db
    .update(teamSettingsTable)
    .set(patch)
    .where(eq(teamSettingsTable.userId, userId))
    .returning();
  res.json(updated);
});

export default router;
