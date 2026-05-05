import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  teamSettingsTable,
  DEFAULT_TEAM_NAME,
  DEFAULT_TEAM_SHORT_NAME,
  type TeamSettings,
  type RestTier,
} from "@workspace/db";

const router: IRouter = Router();

// Single rest-tier shape — matches OpenAPI's RestTier component.
const RestTierZ = z.object({
  maxPitches: z.number().int().min(0).max(999),
  daysRest: z.number().int().min(0).max(10),
});

// PATCH semantics: every field optional, but at least one must be provided.
const UpdateBody = z
  .object({
    teamName: z.string().trim().min(1, "Team name required").max(80).optional(),
    teamShortName: z.string().trim().min(1, "Short name required").max(20).optional(),
    battingStyle: z.enum(["continuous", "nine_man"]).optional(),
    defaultDailyPitchMax: z.number().int().min(0).max(500).nullish(),
    defaultTournamentPitchMax: z.number().int().min(0).max(2000).nullish(),
    defaultRestTiers: z.array(RestTierZ).nullish(),
  })
  .refine(
    (v) =>
      v.teamName !== undefined ||
      v.teamShortName !== undefined ||
      v.battingStyle !== undefined ||
      v.defaultDailyPitchMax !== undefined ||
      v.defaultTournamentPitchMax !== undefined ||
      v.defaultRestTiers !== undefined,
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
  await getOrCreateForUser(userId);
  const patch: {
    teamName?: string;
    teamShortName?: string;
    battingStyle?: "continuous" | "nine_man";
    defaultDailyPitchMax?: number | null;
    defaultTournamentPitchMax?: number | null;
    defaultRestTiers?: RestTier[] | null;
    updatedAt: ReturnType<typeof sql>;
  } = { updatedAt: sql`now()` };
  if (parsed.data.teamName !== undefined) patch.teamName = parsed.data.teamName;
  if (parsed.data.teamShortName !== undefined) patch.teamShortName = parsed.data.teamShortName;
  if (parsed.data.battingStyle !== undefined) patch.battingStyle = parsed.data.battingStyle;
  if (parsed.data.defaultDailyPitchMax !== undefined)
    patch.defaultDailyPitchMax = parsed.data.defaultDailyPitchMax ?? null;
  if (parsed.data.defaultTournamentPitchMax !== undefined)
    patch.defaultTournamentPitchMax = parsed.data.defaultTournamentPitchMax ?? null;
  if (parsed.data.defaultRestTiers !== undefined)
    patch.defaultRestTiers = parsed.data.defaultRestTiers ?? null;
  const [updated] = await db
    .update(teamSettingsTable)
    .set(patch)
    .where(eq(teamSettingsTable.userId, userId))
    .returning();
  res.json(updated);
});

export default router;
