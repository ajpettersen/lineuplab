import { integer } from "drizzle-orm/pg-core";

/**
 * Optimistic-concurrency version counter shared by every mutable table.
 *
 * Starts at 1 and is incremented by the server on EVERY UPDATE (see the
 * api-server's concurrency helpers). Clients may send the version they
 * last saw in an `If-Match` header; when present, the UPDATE's WHERE
 * clause pins `row_version = <expected>` and a 0-row result returns
 * `409 Conflict` with the current row so the client can resolve the
 * conflict ("keep mine" / "keep theirs" / merge) instead of silently
 * losing an offline edit. Requests WITHOUT `If-Match` keep the legacy
 * last-writer-wins behavior, so old clients are unaffected.
 */
export const rowVersion = () => integer("row_version").notNull().default(1);
