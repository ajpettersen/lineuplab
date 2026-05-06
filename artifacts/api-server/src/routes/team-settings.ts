import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
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
router.use("/team-settings", gateWrites("full"));

// Single rest-tier shape — matches OpenAPI's RestTier component.
const RestTierZ = z.object({
  maxPitches: z.number().int().min(0).max(999),
  daysRest: z.number().int().min(0).max(10),
});

const REQUIRED_CORE_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "RF"] as const;
const FieldPositionEnum = z.enum(["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "CF", "RCF", "RF"]);

// Active-positions validator: must contain the 8 fixed corners (P, C, IF×4,
// LF, RF) plus EITHER {CF} (the standard 9) OR {LCF, RCF} (the 10-player
// field). Anything else (no center, both CF and LCF, etc.) is rejected so
// the lineup generator always has a coherent slot list to fill.
const ActiveFieldPositionsZ = z
  .array(FieldPositionEnum)
  .min(9)
  .max(10)
  .refine(
    (arr) => {
      const set = new Set(arr);
      if (set.size !== arr.length) return false; // no duplicates
      for (const p of REQUIRED_CORE_POSITIONS) if (!set.has(p)) return false;
      const hasCF = set.has("CF");
      const hasLCF = set.has("LCF");
      const hasRCF = set.has("RCF");
      // Exactly one of: CF alone, OR (LCF AND RCF) — never mix.
      const standard = hasCF && !hasLCF && !hasRCF && set.size === 9;
      const tenMan = hasLCF && hasRCF && !hasCF && set.size === 10;
      return standard || tenMan;
    },
    {
      message:
        'activeFieldPositions must be the standard 9 (with "CF") or the 10-player field (with "LCF" and "RCF" instead of "CF").',
    },
  );

// PATCH semantics: every field optional, but at least one must be provided.
const UpdateBody = z
  .object({
    teamName: z.string().trim().min(1, "Team name required").max(80).optional(),
    teamShortName: z.string().trim().min(1, "Short name required").max(20).optional(),
    battingStyle: z.enum(["continuous", "nine_man"]).optional(),
    defaultDailyPitchMax: z.number().int().min(0).max(500).nullish(),
    defaultTournamentPitchMax: z.number().int().min(0).max(2000).nullish(),
    defaultRestTiers: z.array(RestTierZ).nullish(),
    activeFieldPositions: ActiveFieldPositionsZ.optional(),
    usesGameChanger: z.boolean().optional(),
    usesTournaments: z.boolean().optional(),
    // HSL string `"H S% L%"` (e.g. `"220 85% 22%"`). Permissive shape
    // — three space-separated tokens, the last two ending in `%`.
    primaryColor: z
      .string()
      .trim()
      .regex(/^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$/, "Color must be in HSL form 'H S% L%'")
      .nullish(),
    secondaryColor: z
      .string()
      .trim()
      .regex(/^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$/, "Color must be in HSL form 'H S% L%'")
      .nullish(),
  })
  .refine(
    (v) =>
      v.teamName !== undefined ||
      v.teamShortName !== undefined ||
      v.battingStyle !== undefined ||
      v.defaultDailyPitchMax !== undefined ||
      v.defaultTournamentPitchMax !== undefined ||
      v.defaultRestTiers !== undefined ||
      v.activeFieldPositions !== undefined ||
      v.usesGameChanger !== undefined ||
      v.usesTournaments !== undefined ||
      v.primaryColor !== undefined ||
      v.secondaryColor !== undefined,
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
    activeFieldPositions?: string[];
    usesGameChanger?: boolean;
    usesTournaments?: boolean;
    primaryColor?: string | null;
    secondaryColor?: string | null;
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
  if (parsed.data.activeFieldPositions !== undefined)
    patch.activeFieldPositions = [...parsed.data.activeFieldPositions];
  if (parsed.data.usesGameChanger !== undefined)
    patch.usesGameChanger = parsed.data.usesGameChanger;
  if (parsed.data.usesTournaments !== undefined)
    patch.usesTournaments = parsed.data.usesTournaments;
  if (parsed.data.primaryColor !== undefined)
    patch.primaryColor = parsed.data.primaryColor ?? null;
  if (parsed.data.secondaryColor !== undefined)
    patch.secondaryColor = parsed.data.secondaryColor ?? null;
  const [updated] = await db
    .update(teamSettingsTable)
    .set(patch)
    .where(eq(teamSettingsTable.userId, userId))
    .returning();
  res.json(updated);
});

/**
 * Mark the first-run onboarding wizard as completed for the current
 * coach. Idempotent — re-calling just refreshes `updatedAt`. Used by
 * the wizard's final "Take me to the dashboard" button so we don't
 * redirect the coach back to /welcome on the next sign-in.
 */
router.post("/team-settings/complete-onboarding", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  await getOrCreateForUser(userId);
  const [updated] = await db
    .update(teamSettingsTable)
    .set({
      onboardingCompletedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(teamSettingsTable.userId, userId))
    .returning();
  res.json(updated);
});

export default router;
