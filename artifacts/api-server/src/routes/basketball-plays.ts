import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, basketballPlaysTable } from "@workspace/db";
import { gateWrites } from "../lib/permissions";

// Drawn basketball plays (Settings → Plays), shown on the court display at
// timeouts. Drawing plays is coaching work, so the same tier as game lineups.
const router: IRouter = Router();
router.use("/basketball-plays", gateWrites("partial"));

const MAX_PLAYS = 100;
const GROUP_LAYOUTS = ["guards-front", "guards-forwards-center", "perimeter-bigs", "five-out"] as const;

const PointZ = z.object({ x: z.number().min(0).max(500), y: z.number().min(0).max(470) });
const PlayZ = z.object({
  name: z.string().trim().min(1, "Give the play a name.").max(60),
  notes: z.string().trim().max(1000).nullable().optional(),
  groupLayout: z.enum(GROUP_LAYOUTS),
  data: z.object({
    players: z
      .array(z.object({ spot: z.number().int().min(1).max(5), x: z.number().min(0).max(500), y: z.number().min(0).max(470) }))
      .max(5),
    ballSpot: z.number().int().min(1).max(5).nullable(),
    actions: z
      .array(
        z.object({
          type: z.enum(["cut", "pass", "dribble", "screen"]),
          step: z.number().int().min(1).max(10),
          points: z.array(PointZ).min(2).max(200),
        }),
      )
      .max(60),
  }),
});

function playIdParam(raw: string | string[] | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const round = (n: number) => Math.round(n * 10) / 10;
function clean(data: z.infer<typeof PlayZ>["data"]) {
  return {
    players: data.players.map((p) => ({ spot: p.spot, x: round(p.x), y: round(p.y) })),
    ballSpot: data.ballSpot,
    actions: data.actions.map((a) => ({ type: a.type, step: a.step, points: a.points.map((p) => ({ x: round(p.x), y: round(p.y) })) })),
  };
}

function present(p: typeof basketballPlaysTable.$inferSelect) {
  return { id: p.id, name: p.name, notes: p.notes, groupLayout: p.groupLayout, data: p.data, sortOrder: p.sortOrder, updatedAt: p.updatedAt };
}

router.get("/basketball-plays", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const plays = await db
    .select()
    .from(basketballPlaysTable)
    .where(eq(basketballPlaysTable.userId, userId))
    .orderBy(asc(basketballPlaysTable.sortOrder), asc(basketballPlaysTable.name), asc(basketballPlaysTable.id));
  res.json(plays.map(present));
});

router.post("/basketball-plays", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = PlayZ.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid play" });
    return;
  }
  const existing = await db.select({ id: basketballPlaysTable.id }).from(basketballPlaysTable).where(eq(basketballPlaysTable.userId, userId));
  if (existing.length >= MAX_PLAYS) {
    res.status(400).json({ error: `A team can have up to ${MAX_PLAYS} plays.` });
    return;
  }
  const [created] = await db
    .insert(basketballPlaysTable)
    .values({
      userId,
      name: parsed.data.name,
      notes: parsed.data.notes || null,
      groupLayout: parsed.data.groupLayout,
      data: clean(parsed.data.data),
      sortOrder: existing.length,
    })
    .returning();
  res.status(201).json(present(created));
});

router.put("/basketball-plays/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const id = playIdParam(req.params.id);
  const parsed = PlayZ.safeParse(req.body);
  if (!id) {
    res.status(404).json({ error: "Play not found" });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid play" });
    return;
  }
  const [updated] = await db
    .update(basketballPlaysTable)
    .set({
      name: parsed.data.name,
      notes: parsed.data.notes || null,
      groupLayout: parsed.data.groupLayout,
      data: clean(parsed.data.data),
      updatedAt: new Date(),
    })
    .where(and(eq(basketballPlaysTable.id, id), eq(basketballPlaysTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Play not found" });
    return;
  }
  res.json(present(updated));
});

router.delete("/basketball-plays/:id", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const id = playIdParam(req.params.id);
  if (id) {
    await db.delete(basketballPlaysTable).where(and(eq(basketballPlaysTable.id, id), eq(basketballPlaysTable.userId, userId)));
  }
  res.status(204).send();
});

export default router;
