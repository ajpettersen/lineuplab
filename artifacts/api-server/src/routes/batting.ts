import { Router, type IRouter } from "express";
import { gateWrites } from "../lib/permissions";
import {
  parseIfMatch,
  rejectBadIfMatch,
  sendConflict,
  versionedUpdate,
  versionedDelete,
} from "../lib/concurrency";
import { idempotent } from "../middlewares/idempotency";
import multer from "multer";
import { db, battingStatsTable, gameBattingLinesTable, gamesTable, playersTable } from "@workspace/db";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AI_MODEL, createChatCompletion } from "../lib/ai";
import { getOwnedPlayer } from "../lib/ownership";
import { getBattingTotals } from "../lib/batting-totals";
import { chargeAiCall } from "../lib/ai-usage";

const router: IRouter = Router();
router.use("/batting", gateWrites("partial"));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const BattingRowSchema = z.object({
  playerId: z.number().int(),
  seasonLabel: z.string().default("Current"),
  ab: z.number().int().min(0).default(0),
  hits: z.number().int().min(0).default(0),
  doubles: z.number().int().min(0).default(0),
  triples: z.number().int().min(0).default(0),
  hr: z.number().int().min(0).default(0),
  rbi: z.number().int().min(0).default(0),
  bb: z.number().int().min(0).default(0),
  k: z.number().int().min(0).default(0),
  hbp: z.number().int().min(0).default(0),
  sac: z.number().int().min(0).default(0),
  sf: z.number().int().min(0).default(0),
  sb: z.number().int().min(0).default(0),
  sourceNote: z.string().optional(),
});

function computeRates(row: { ab: number; hits: number; doubles: number; triples: number; hr: number; bb: number; hbp: number; sac: number; sf: number }) {
  const pa = row.ab + row.bb + row.hbp + row.sac + row.sf;
  const avg = row.ab > 0 ? row.hits / row.ab : 0;
  const obp = pa > 0 ? (row.hits + row.bb + row.hbp) / pa : 0;
  const tb = row.hits - row.doubles - row.triples - row.hr + row.doubles * 2 + row.triples * 3 + row.hr * 4;
  const slg = row.ab > 0 ? tb / row.ab : 0;
  const ops = obp + slg;
  return { avg: Math.round(avg * 1000) / 1000, obp: Math.round(obp * 1000) / 1000, slg: Math.round(slg * 1000) / 1000, ops: Math.round(ops * 1000) / 1000 };
}

// ---------------------------------------------------------------------------
// GameChanger CSV import. GameChanger's "Export Stats" produces a CSV with a
// two-row header: row 1 carries SECTION markers (Batting / Pitching / Fielding)
// spread across the columns, row 2 carries the actual column names. Crucially
// several column names (H, R, BB, SO) appear in BOTH the batting and pitching
// sections, so we MUST scope batting reads to columns left of the "Pitching"
// marker — otherwise we'd read a pitcher's hits-allowed as their batting hits.
// We parse this deterministically (no AI) since it's already structured data.
// ---------------------------------------------------------------------------

type RosterPlayer = {
  id: number;
  name: string;
  number: number | null;
  firstName?: string | null;
  lastName?: string | null;
};

type ExtractedBattingRow = {
  playerId: number;
  playerName: string;
  ab: number; hits: number; doubles: number; triples: number; hr: number;
  rbi: number; bb: number; k: number; hbp: number; sac: number; sf: number; sb: number;
};

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes
// (""), and CRLF/LF line endings. Sufficient for GameChanger exports.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// CSV batting column name -> our ExtractedBattingRow key.
const GC_BATTING_COLS: Record<string, keyof ExtractedBattingRow> = {
  AB: "ab", H: "hits", "2B": "doubles", "3B": "triples", HR: "hr",
  RBI: "rbi", BB: "bb", SO: "k", HBP: "hbp", SAC: "sac", SF: "sf", SB: "sb",
};

const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function extractGameChangerBatting(
  text: string,
  players: RosterPlayer[],
): { extracted: ExtractedBattingRow[]; unmatched: string[] } | null {
  // Strip a leading UTF-8 BOM — some browsers/OSes prepend one on download,
  // which would otherwise corrupt the first header cell.
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return null;

  // Locate the column-header row (has both "Last" and "First").
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const r = rows[i].map((c) => c.trim());
    if (r.includes("Last") && r.includes("First")) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return null; // not a recognizable GameChanger export

  const header = rows[headerIdx].map((c) => c.trim());

  // The section-marker row is usually directly above the header row. Use the
  // "Pitching" marker column as the right boundary for batting columns.
  let pitchingStart = header.length;
  if (headerIdx > 0) {
    const sec = rows[headerIdx - 1].map((c) => c.trim());
    const pi = sec.indexOf("Pitching");
    if (pi >= 0) pitchingStart = pi;
  }

  const findCol = (name: string, maxExclusive = header.length): number => {
    for (let i = 0; i < maxExclusive; i++) if (header[i] === name) return i;
    return -1;
  };

  const numberIdx = findCol("Number");
  const lastIdx = findCol("Last");
  const firstIdx = findCol("First");
  if (lastIdx === -1 || firstIdx === -1) return null;

  // Resolve each batting stat column, scoped to the batting section.
  const statIdx: Partial<Record<keyof ExtractedBattingRow, number>> = {};
  for (const [csvName, key] of Object.entries(GC_BATTING_COLS)) {
    const idx = findCol(csvName, pitchingStart);
    if (idx >= 0) statIdx[key] = idx;
  }

  // Build roster lookups. Jersey number is the most reliable key (skip numbers
  // shared by multiple players); fall back to normalized full-name matching.
  const numberCounts = new Map<number, number>();
  for (const p of players) {
    if (p.number != null) numberCounts.set(p.number, (numberCounts.get(p.number) ?? 0) + 1);
  }
  const byNumber = new Map<number, RosterPlayer>();
  const byFullName = new Map<string, RosterPlayer>();
  for (const p of players) {
    if (p.number != null && numberCounts.get(p.number) === 1) byNumber.set(p.number, p);
    const keys = [
      normName(`${p.firstName ?? ""}${p.lastName ?? ""}`),
      normName(`${p.lastName ?? ""}${p.firstName ?? ""}`),
      normName(p.name),
    ];
    for (const k of keys) if (k && !byFullName.has(k)) byFullName.set(k, p);
  }

  const numCell = (row: string[], idx?: number): number => {
    if (idx == null || idx < 0) return 0;
    const raw = (row[idx] ?? "").trim();
    if (!raw || raw === "-") return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };

  const extracted: ExtractedBattingRow[] = [];
  const unmatched: string[] = [];
  const seen = new Set<number>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const last = (row[lastIdx] ?? "").trim();
    const first = (row[firstIdx] ?? "").trim();
    const firstCell = (row[0] ?? "").trim().toLowerCase();
    // Stop at the trailing Totals / Glossary blocks.
    if (firstCell === "totals" || firstCell === "glossary") break;
    if (!last && !first) continue;

    let player: RosterPlayer | undefined;
    const numRaw = numberIdx >= 0 ? (row[numberIdx] ?? "").trim() : "";
    if (numRaw) {
      const num = parseInt(numRaw, 10);
      if (Number.isFinite(num)) player = byNumber.get(num);
    }
    if (!player) player = byFullName.get(normName(`${first}${last}`));
    if (!player) player = byFullName.get(normName(`${last}${first}`));

    const display = `${first} ${last}`.trim() || last || first;
    if (!player) { unmatched.push(display); continue; }
    if (seen.has(player.id)) continue; // ignore dupes; keep first occurrence
    seen.add(player.id);

    extracted.push({
      playerId: player.id,
      playerName: player.name,
      ab: numCell(row, statIdx.ab),
      hits: numCell(row, statIdx.hits),
      doubles: numCell(row, statIdx.doubles),
      triples: numCell(row, statIdx.triples),
      hr: numCell(row, statIdx.hr),
      rbi: numCell(row, statIdx.rbi),
      bb: numCell(row, statIdx.bb),
      k: numCell(row, statIdx.k),
      hbp: numCell(row, statIdx.hbp),
      sac: numCell(row, statIdx.sac),
      sf: numCell(row, statIdx.sf),
      sb: numCell(row, statIdx.sb),
    });
  }

  return { extracted, unmatched };
}

router.get("/batting", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  // Returns the unioned per-player totals (manual `batting_stats` row
  // counts + summed `game_batting_lines`), with rates recomputed from
  // the unioned counts. Idempotent w.r.t. box-score imports.
  const rows = await getBattingTotals(userId);
  // Map to the legacy response shape the UI expects (playerId-keyed
  // row with avg/obp/slg/ops + counts). `seasonLabel` is preserved
  // for backwards compat — pinned to "Current" since the unified
  // view doesn't currently distinguish seasons.
  res.json(
    rows.map((r) => ({
      playerId: r.playerId,
      playerName: r.playerName,
      playerNumber: r.playerNumber,
      seasonLabel: "Current",
      ab: r.ab,
      hits: r.hits,
      doubles: r.doubles,
      triples: r.triples,
      hr: r.hr,
      rbi: r.rbi,
      bb: r.bb,
      k: r.k,
      hbp: r.hbp,
      sac: r.sac,
      sf: r.sf,
      sb: r.sb,
      runs: r.runs,
      avg: r.avg,
      obp: r.obp,
      slg: r.slg,
      ops: r.ops,
      gamesRecorded: r.gamesRecorded,
      hasPerGameLines: r.hasPerGameLines,
      updatedAt: r.updatedAt,
    })),
  );
});

router.put("/batting/:playerId", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const playerId = parseInt(req.params.playerId);
  if (isNaN(playerId)) { res.status(400).json({ error: "Invalid player ID" }); return; }

  const ifm = parseIfMatch(req);
  if (!ifm.ok) { rejectBadIfMatch(res); return; }

  // Confirm the target player belongs to this coach before any write lands.
  if (!(await getOwnedPlayer(userId, playerId))) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  const parsed = BattingRowSchema.safeParse({ ...req.body, playerId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() }); return; }

  // The numbers the UI shows (and pre-fills the edit form with) are
  // the UNIONED season totals — manual `batting_stats` row + summed
  // `game_batting_lines`. If we wrote the incoming totals directly
  // into the manual row, the next GET would re-add the per-game lines
  // on top and the stat would appear to double. So before writing,
  // we subtract the per-game contribution and store only the manual
  // DELTA. Mental model for callers: "save what you see" still works.
  //
  // We must subtract the SAME per-game slice that `getBattingTotals`
  // adds back: only games dated AFTER this player's season-import
  // cutoff (all games when there's no cutoff). Otherwise an inline
  // edit on a player who has a season override would store a wrong
  // delta. The cutoff itself is preserved on the write below.
  const existing = await db
    .select()
    .from(battingStatsTable)
    .where(eq(battingStatsTable.playerId, playerId));
  const cutoff = existing[0]?.seasonImportedAt ?? null;

  const perGameRows = await db
    .select({
      ab: sql<number>`coalesce(sum(${gameBattingLinesTable.ab}), 0)::int`,
      hits: sql<number>`coalesce(sum(${gameBattingLinesTable.hits}), 0)::int`,
      doubles: sql<number>`coalesce(sum(${gameBattingLinesTable.doubles}), 0)::int`,
      triples: sql<number>`coalesce(sum(${gameBattingLinesTable.triples}), 0)::int`,
      hr: sql<number>`coalesce(sum(${gameBattingLinesTable.hr}), 0)::int`,
      rbi: sql<number>`coalesce(sum(${gameBattingLinesTable.rbi}), 0)::int`,
      bb: sql<number>`coalesce(sum(${gameBattingLinesTable.bb}), 0)::int`,
      k: sql<number>`coalesce(sum(${gameBattingLinesTable.k}), 0)::int`,
      hbp: sql<number>`coalesce(sum(${gameBattingLinesTable.hbp}), 0)::int`,
      sac: sql<number>`coalesce(sum(${gameBattingLinesTable.sac}), 0)::int`,
      sf: sql<number>`coalesce(sum(${gameBattingLinesTable.sf}), 0)::int`,
      sb: sql<number>`coalesce(sum(${gameBattingLinesTable.sb}), 0)::int`,
    })
    .from(gameBattingLinesTable)
    .innerJoin(gamesTable, eq(gamesTable.id, gameBattingLinesTable.gameId))
    .where(
      and(
        eq(gameBattingLinesTable.userId, userId),
        eq(gameBattingLinesTable.playerId, playerId),
        cutoff ? gt(gamesTable.gameDate, cutoff) : undefined,
      ),
    );
  const pg = perGameRows[0] ?? {
    ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, rbi: 0,
    bb: 0, k: 0, hbp: 0, sac: 0, sf: 0, sb: 0,
  };

  // Reject impossible totals (incoming < per-game sum) up front rather
  // than silently clamping to zero, so the coach knows the box score
  // is the source of truth and they should edit it there instead.
  const COUNT_KEYS = [
    "ab", "hits", "doubles", "triples", "hr", "rbi",
    "bb", "k", "hbp", "sac", "sf", "sb",
  ] as const;
  for (const key of COUNT_KEYS) {
    if (parsed.data[key] < pg[key]) {
      res.status(400).json({
        error: `${key.toUpperCase()} (${parsed.data[key]}) is below the recorded box-score total (${pg[key]}). Edit the box score for the relevant game instead of lowering the season total.`,
      });
      return;
    }
  }

  // Subtract the per-game contribution to derive the manual delta.
  const manual = { ...parsed.data };
  for (const key of COUNT_KEYS) {
    manual[key] = parsed.data[key] - pg[key];
  }

  // Rates we store on the manual row are best-effort and not what the
  // UI ultimately renders — `getBattingTotals` recomputes them from
  // the unioned counts. Keep the column populated so legacy callers
  // that read the row directly still see sensible numbers.
  const rates = computeRates(manual);

  if (existing.length > 0) {
    const result = await versionedUpdate(db, battingStatsTable, {
      set: { ...manual, ...rates, updatedAt: new Date() },
      where: eq(battingStatsTable.playerId, playerId),
      ifMatch: ifm.version,
    });
    if (result.kind === "conflict") {
      sendConflict(res, result.current);
      return;
    }
    if (result.kind === "missing") {
      res.status(404).json({ error: "Player not found" });
      return;
    }
    res.json(result.row);
  } else {
    const [created] = await db
      .insert(battingStatsTable)
      .values({ ...manual, ...rates })
      .returning();
    res.status(201).json(created);
  }
});

router.delete("/batting/:playerId", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const playerId = parseInt(req.params.playerId);
  const ifm = parseIfMatch(req);
  if (!ifm.ok) { rejectBadIfMatch(res); return; }
  if (!(await getOwnedPlayer(userId, playerId))) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  const result = await versionedDelete(db, battingStatsTable, {
    where: eq(battingStatsTable.playerId, playerId),
    ifMatch: ifm.version,
  });
  if (result.kind === "conflict") {
    sendConflict(res, result.current);
    return;
  }
  // Preserve legacy behavior: a missing row is treated as a successful
  // no-op delete (this route never 404'd on an absent stats row).
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Bulk nuke + restore for the manual `batting_stats` rows. Used by the
// "Delete all manual stats" flow on Season Stats. Box-score-derived
// `game_batting_lines` are NOT touched — those remain authoritative
// for per-game data and roll up via getBattingTotals.
// ---------------------------------------------------------------------------

const ClearAllSchema = z.object({ confirm: z.literal("DELETE") });

router.post("/batting/clear-all", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = ClearAllSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Confirmation required: send { confirm: \"DELETE\" }" });
    return;
  }
  // Snapshot every manual row this coach owns BEFORE wiping. We join
  // through `players` to constrain to this tenant — `batting_stats`
  // doesn't have its own `userId` column.
  const snapshot = await db
    .select({ row: battingStatsTable })
    .from(battingStatsTable)
    .innerJoin(playersTable, eq(playersTable.id, battingStatsTable.playerId))
    .where(eq(playersTable.userId, userId));
  const snapshotRows = snapshot.map((s) => s.row);
  if (snapshotRows.length === 0) {
    res.json({ deletedCount: 0, snapshot: [] });
    return;
  }
  const playerIds = snapshotRows.map((r) => r.playerId);
  await db
    .delete(battingStatsTable)
    .where(inArray(battingStatsTable.playerId, playerIds));
  res.json({ deletedCount: snapshotRows.length, snapshot: snapshotRows });
});

const RestoreSchema = z.object({
  rows: z.array(
    z.object({
      playerId: z.number().int(),
      seasonLabel: z.string().default("Current"),
      ab: z.number().int().min(0).default(0),
      hits: z.number().int().min(0).default(0),
      doubles: z.number().int().min(0).default(0),
      triples: z.number().int().min(0).default(0),
      hr: z.number().int().min(0).default(0),
      rbi: z.number().int().min(0).default(0),
      bb: z.number().int().min(0).default(0),
      k: z.number().int().min(0).default(0),
      hbp: z.number().int().min(0).default(0),
      sac: z.number().int().min(0).default(0),
      sf: z.number().int().min(0).default(0),
      sb: z.number().int().min(0).default(0),
      sourceNote: z.string().nullable().optional(),
      // Preserve the season-import cutoff so undo is lossless — without
      // this a restore would silently revert overridden players back to
      // legacy additive behavior.
      seasonImportedAt: z.coerce.date().nullable().optional(),
    }),
  ),
});

router.post("/batting/restore", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = RestoreSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid snapshot", details: parsed.error.flatten() });
    return;
  }
  if (parsed.data.rows.length === 0) {
    res.json({ restored: 0 });
    return;
  }
  // Reconfirm every snapshot row is still an owned player. A snapshot
  // produced from clear-all minutes ago could reference a player who
  // has since been deleted — silently drop those rather than 4xx.
  const requestedIds = Array.from(
    new Set(parsed.data.rows.map((r) => r.playerId)),
  );
  const ownedRows = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(
      and(
        eq(playersTable.userId, userId),
        isNull(playersTable.deletedAt),
        inArray(playersTable.id, requestedIds),
      ),
    );
  const ownedSet = new Set(ownedRows.map((r) => r.id));
  const safeRows = parsed.data.rows.filter((r) => ownedSet.has(r.playerId));
  let restored = 0;
  // upsert per row — clearAll wiped them so insert path is the common
  // case, but accept overwrite in case the coach added new manual
  // stats between clear and restore (last writer wins on restore).
  for (const r of safeRows) {
    const rates = computeRates(r);
    await db
      .insert(battingStatsTable)
      .values({ ...r, ...rates, sourceNote: r.sourceNote ?? null })
      .onConflictDoUpdate({
        target: battingStatsTable.playerId,
        set: {
          ...r,
          ...rates,
          sourceNote: r.sourceNote ?? null,
          updatedAt: new Date(),
          rowVersion: sql`${battingStatsTable.rowVersion} + 1`,
        },
      });
    restored += 1;
  }
  res.json({ restored });
});

// ---------------------------------------------------------------------------
// Season override import. A coach uploads a SEASON stats screenshot whose
// totals already include every game played so far. We store those FULL
// totals on the manual `batting_stats` row (NOT a delta) and stamp
// `seasonImportedAt = now()`. `getBattingTotals` then only ADDS per-game
// `game_batting_lines` from games dated AFTER that cutoff — so the season
// sheet overrides all prior box-score rollups while future games still
// accumulate on top. One shared timestamp for the whole batch keeps the
// cutoff consistent across players.
// ---------------------------------------------------------------------------

const ImportSeasonSchema = z.object({
  rows: z.array(
    z.object({
      playerId: z.number().int(),
      seasonLabel: z.string().default("Current"),
      ab: z.number().int().min(0).default(0),
      hits: z.number().int().min(0).default(0),
      doubles: z.number().int().min(0).default(0),
      triples: z.number().int().min(0).default(0),
      hr: z.number().int().min(0).default(0),
      rbi: z.number().int().min(0).default(0),
      bb: z.number().int().min(0).default(0),
      k: z.number().int().min(0).default(0),
      hbp: z.number().int().min(0).default(0),
      sac: z.number().int().min(0).default(0),
      sf: z.number().int().min(0).default(0),
      sb: z.number().int().min(0).default(0),
      sourceNote: z.string().nullable().optional(),
    }),
  ),
});

router.post("/batting/import-season", idempotent("importSeasonBatting"), async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const parsed = ImportSeasonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
    return;
  }
  if (parsed.data.rows.length === 0) {
    res.json({ imported: 0 });
    return;
  }
  // Constrain to owned, non-deleted players — silently drop any stray ids.
  const requestedIds = Array.from(new Set(parsed.data.rows.map((r) => r.playerId)));
  const ownedRows = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(
      and(
        eq(playersTable.userId, userId),
        isNull(playersTable.deletedAt),
        inArray(playersTable.id, requestedIds),
      ),
    );
  const ownedSet = new Set(ownedRows.map((r) => r.id));
  const safeRows = parsed.data.rows.filter((r) => ownedSet.has(r.playerId));

  const seasonImportedAt = new Date();
  let imported = 0;
  for (const r of safeRows) {
    const rates = computeRates(r);
    await db
      .insert(battingStatsTable)
      .values({ ...r, ...rates, sourceNote: r.sourceNote ?? null, seasonImportedAt })
      .onConflictDoUpdate({
        target: battingStatsTable.playerId,
        set: {
          ...r,
          ...rates,
          sourceNote: r.sourceNote ?? null,
          seasonImportedAt,
          updatedAt: new Date(),
          rowVersion: sql`${battingStatsTable.rowVersion} + 1`,
        },
      });
    imported += 1;
  }
  res.json({ imported, seasonImportedAt });
});

router.post("/batting/extract", upload.single("file"), async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const players = await db
    .select()
    .from(playersTable)
    .where(
      and(
        eq(playersTable.userId, userId),
        eq(playersTable.active, true),
        isNull(playersTable.deletedAt),
      ),
    );

  // CSV (e.g. GameChanger "Export Stats") is already structured data — parse it
  // deterministically rather than spending an AI call on OCR. Detect by file
  // extension or mimetype; fall through to the AI vision path for images/PDFs.
  const filename = req.file.originalname ?? "";
  const mimetype = req.file.mimetype ?? "";
  const isCsv = /\.csv$/i.test(filename) || /csv/i.test(mimetype);
  if (isCsv) {
    const text = req.file.buffer.toString("utf-8");
    const result = extractGameChangerBatting(text, players);
    if (!result) {
      res.status(422).json({
        error: "Couldn't read this CSV. Make sure it's a GameChanger stats export (it should have Number, Last, First and batting columns).",
      });
      return;
    }
    res.json({ extracted: result.extracted, unmatched: result.unmatched });
    return;
  }

  const charge = await chargeAiCall(req, "batting-import");
  if (!charge.ok) { res.status(charge.status).json({ error: charge.error }); return; }

  const playerList = players.map((p) => `${p.id}: ${p.name}${p.number != null ? ` (#${p.number})` : ""}`).join("\n");

  const base64 = req.file.buffer.toString("base64");
  const mimeType = req.file.mimetype || "image/png";

  const systemPrompt = `You are a baseball stats extractor. Given an image of a scorebook, stats sheet, or document, extract batting statistics for each player. Match players by name to the roster provided. Return a JSON array only, no explanation.

Roster (id: name):
${playerList}

Return format:
[
  {
    "playerId": <number>,
    "playerName": "<string>",
    "ab": <int>,
    "hits": <int>,
    "doubles": <int>,
    "triples": <int>,
    "hr": <int>,
    "rbi": <int>,
    "bb": <int>,
    "k": <int>,
    "hbp": <int>,
    "sac": <int>,
    "sf": <int>,
    "sb": <int>
  }
]

"sac" = sacrifice bunts, "sf" = sacrifice flies — they are SEPARATE columns; do not merge them. If a stat column is not visible, use 0. Only include players whose stats you can read. Return raw JSON array, no markdown.`;

  const response = await createChatCompletion({
    model: AI_MODEL,
    max_completion_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: systemPrompt },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "[]";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let extracted;
  try {
    extracted = JSON.parse(cleaned);
  } catch {
    res.status(422).json({ error: "Could not parse AI response", raw });
    return;
  }

  // Drop any rows the LLM tried to attribute to players outside this roster.
  const rosterIds = new Set(players.map((p) => p.id));
  if (Array.isArray(extracted)) {
    extracted = extracted.filter(
      (r: { playerId?: unknown }) => typeof r.playerId === "number" && rosterIds.has(r.playerId),
    );
  }

  res.json({ extracted });
});

export default router;
