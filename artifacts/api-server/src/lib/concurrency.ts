import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Request, Response } from "express";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";

/**
 * Optimistic-concurrency helpers for the offline-mode work.
 *
 * Every mutable table carries a `row_version` column (see
 * `@workspace/db` → `rowVersion()`), incremented on every UPDATE.
 * Clients that queued an edit while offline send the version they last
 * saw in an `If-Match` header. When present, the UPDATE pins
 * `row_version = <expected>`; a 0-row result means another device
 * changed the row in the meantime and the route answers
 * `409 Conflict` with the CURRENT row so the client can offer
 * "keep mine / keep theirs / merge" instead of silently clobbering.
 *
 * Requests WITHOUT `If-Match` keep last-writer-wins behavior — old
 * clients (and the Field Display's own queue) are unaffected.
 */

/** A pgTable that carries the shared row_version column. */
type VersionedTable = PgTable & { rowVersion: PgColumn };

export type IfMatchParse =
  | { ok: true; version: number | null }
  | { ok: false };

/**
 * Read + validate the optional `If-Match` header.
 * Accepts a bare integer (`3`) or an ETag-quoted one (`"3"`, `W/"3"`).
 * Returns `{ok: true, version: null}` when the header is absent.
 */
export function parseIfMatch(req: Request): IfMatchParse {
  const raw = req.header("if-match");
  if (raw == null || raw.trim() === "") return { ok: true, version: null };
  const cleaned = raw.trim().replace(/^W\//i, "").replace(/^"(.*)"$/, "$1");
  if (!/^\d{1,9}$/.test(cleaned)) return { ok: false };
  return { ok: true, version: Number(cleaned) };
}

/** 400 for a malformed If-Match header. Returns true when it responded. */
export function rejectBadIfMatch(res: Response): void {
  res
    .status(400)
    .json({ error: "Invalid If-Match header — expected a row version integer" });
}

export type VersionedWriteResult<Row> =
  | { kind: "ok"; row: Row }
  | { kind: "conflict"; current: Row }
  | { kind: "missing" };

/** Minimal executor shape satisfied by both `db` and a transaction. */
type Executor = Pick<typeof db, "update" | "select" | "delete">;

/**
 * UPDATE with optional optimistic locking + automatic version bump.
 *
 * `where` must contain the id + ownership (+ soft-delete) predicates but
 * NOT the version check — that's added here from `ifMatch`. On a 0-row
 * update with a version pin, the current row is re-read (same `where`)
 * to distinguish `conflict` (row exists at another version) from
 * `missing` (gone / not owned).
 */
export async function versionedUpdate<T extends VersionedTable>(
  executor: Executor,
  table: T,
  opts: {
    set: Record<string, unknown>;
    where: SQL | undefined;
    ifMatch: number | null;
  },
): Promise<VersionedWriteResult<T["$inferSelect"]>> {
  const where =
    opts.ifMatch == null
      ? opts.where
      : and(opts.where, eq(table.rowVersion, opts.ifMatch));
  const rows = (await executor
    .update(table)
    .set({
      ...opts.set,
      rowVersion: sql`${table.rowVersion} + 1`,
    } as never)
    .where(where)
    .returning()) as T["$inferSelect"][];
  const row = rows[0];
  if (row) return { kind: "ok", row };
  if (opts.ifMatch != null) {
    const current = (await executor
      .select()
      .from(table as PgTable)
      .where(opts.where)) as T["$inferSelect"][];
    if (current[0]) return { kind: "conflict", current: current[0] };
  }
  return { kind: "missing" };
}

/**
 * HARD DELETE with optional optimistic locking. Most entity deletes in
 * this app are soft (stamp `deletedAt`) and should use `versionedUpdate`;
 * this is for genuinely destructive rows (pitch counts, constraint rows).
 */
export async function versionedDelete<T extends VersionedTable>(
  executor: Executor,
  table: T,
  opts: { where: SQL | undefined; ifMatch: number | null },
): Promise<VersionedWriteResult<T["$inferSelect"]>> {
  const where =
    opts.ifMatch == null
      ? opts.where
      : and(opts.where, eq(table.rowVersion, opts.ifMatch));
  const rows = (await executor
    .delete(table)
    .where(where)
    .returning()) as T["$inferSelect"][];
  const row = rows[0];
  if (row) return { kind: "ok", row };
  if (opts.ifMatch != null) {
    const current = (await executor
      .select()
      .from(table as PgTable)
      .where(opts.where)) as T["$inferSelect"][];
    if (current[0]) return { kind: "conflict", current: current[0] };
  }
  return { kind: "missing" };
}

/**
 * Standard 409 payload. `current` is the row as it exists NOW (the other
 * device's version) — the client renders a mine-vs-theirs diff from it.
 * The shape is stable API contract: { error, code, current }.
 */
export function sendConflict(res: Response, current: unknown): void {
  res.status(409).json({
    error: "This record was changed on another device since you last loaded it.",
    code: "row_version_conflict",
    current,
  });
}
