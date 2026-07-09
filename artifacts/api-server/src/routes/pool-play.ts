import { Router, type IRouter } from "express";
import multer from "multer";
import { and, eq, isNull } from "drizzle-orm";
import {
  parseIfMatch,
  rejectBadIfMatch,
  sendConflict,
  versionedUpdate,
} from "../lib/concurrency";
import { z } from "zod";
import {
  db,
  tournamentsTable,
  PoolPlayJson,
  POOL_PLAY_TIEBREAKER_KEYS,
  type PoolPlayJson as PoolPlayJsonType,
  type PoolPlayTiebreakerKey,
} from "@workspace/db";
import { AI_MODEL, createChatCompletion } from "../lib/ai";
import { gateWrites } from "../lib/permissions";
import { chargeAiCall } from "../lib/ai-usage";
import { simulatePoolPlay } from "../lib/pool-play-simulator";

const router: IRouter = Router();
router.use("/tournaments", gateWrites("full"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 3 }, // 8 MB / image, max 3
});

/**
 * Resolve and own-check a tournament by id. Returns the row or null.
 */
async function getOwnedTournament(id: number, userId: string) {
  const [row] = await db
    .select()
    .from(tournamentsTable)
    .where(
      and(
        eq(tournamentsTable.id, id),
        eq(tournamentsTable.userId, userId),
        isNull(tournamentsTable.deletedAt),
      ),
    );
  return row ?? null;
}

const IdParam = z.object({
  id: z.coerce.number().int().positive(),
});

// ---------------------------------------------------------------------------
// POST /tournaments/:id/pool-play/extract — multipart upload, AI parse
// ---------------------------------------------------------------------------

router.post(
  "/tournaments/:id/pool-play/extract",
  upload.array("files", 3),
  async (req, res): Promise<void> => {
    const userId = req.ownerUserId!;
    const params = IdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const tournament = await getOwnedTournament(params.data.id, userId);
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: "Upload at least one screenshot" });
      return;
    }
    if (files.length > 3) {
      res.status(400).json({ error: "Upload at most 3 screenshots" });
      return;
    }

    // Pre-charge the AI usage budget for all images up front so a
    // 3-image batch either fully succeeds or is refused before we
    // spend tokens.
    const charge = await chargeAiCall(req, "pool-play-extract", files.length);
    if (!charge.ok) {
      res.status(charge.status).json({ error: charge.error });
      return;
    }

    // Hint the model with the existing pool data, if any, so re-imports
    // can stitch additional screenshots onto the prior state instead of
    // wiping it (e.g. one screenshot for standings, another for the
    // remaining schedule). The coach can still edit before saving.
    const existingHint = tournament.poolPlay
      ? `\n\nThe coach already has this pool data saved — prefer reconciling rather than inventing new teams or games:\n${JSON.stringify(
          {
            teams: tournament.poolPlay.teams,
            games: tournament.poolPlay.games.map((g) => ({
              home: g.home,
              away: g.away,
              homeScore: g.homeScore,
              awayScore: g.awayScore,
              final: g.final,
            })),
          },
        )}`
      : "";

    const systemPrompt = `You are a baseball/softball tournament pool-play extractor. The user uploaded screenshots of a published pool-play standings page and/or schedule. Extract:

1. TEAMS in the pool (their names exactly as written; trim whitespace; preserve case and any colors/numbers in the name).
2. GAMES between those teams. For each game:
   - home / away team names (use the schedule order if shown; otherwise pick one — coach can correct).
   - homeScore / awayScore: integers if a final score is visible; null if the game has not been played.
   - final: true iff a final score is visible AND the game is shown as completed (not "in progress").
   - scheduledAt: the scheduled first-pitch wall-clock time as an ISO-8601 string with timezone. Build it from the tournament's startDate (${tournament.startDate.toISOString()}) for the date portion when only a time is visible on the schedule. If the screenshot shows the date too, prefer that. Use the tournament's local timezone offset if visible (default to "${tournament.startDate.toISOString().slice(-6) === "+00:00" ? "Z" : tournament.startDate.toISOString().slice(-6)}"). null if no time is visible.
3. TIEBREAKER NOTE: free-form text of any tiebreaker rules visible on the page (e.g. "Tiebreakers: H2H, then run diff, then runs allowed"). null if not shown.
4. OUR TEAM GUESS: which team in the pool is the coach's. Common signals: row highlighted in screenshot, a "you" or "your team" marker, the tournament name including the team name. null if no clear signal.

Only include teams + games visible across the uploaded images. Do NOT invent games to "complete" a round-robin. Do NOT carry information from your training data — only what's on screen.${existingHint}

Tournament context: "${tournament.name}"${tournament.location ? `, ${tournament.location}` : ""}. Runs ${tournament.startDate.toISOString().slice(0, 10)} to ${tournament.endDate.toISOString().slice(0, 10)}.

Return RAW JSON only, no markdown, no commentary:
{
  "ourTeamGuess": "<string or null>",
  "teams": [{ "name": "<string>" }, ...],
  "games": [
    { "home": "<string>", "away": "<string>", "homeScore": <int|null>, "awayScore": <int|null>, "final": <bool>, "scheduledAt": "<ISO-8601 string or null>" },
    ...
  ],
  "tiebreakerNote": "<string or null>"
}`;

    // Send all images in a single completion call — the AI needs to
    // see them together to reconcile (e.g. standings on one page, the
    // schedule on the next). Pool play is a small payload, so a single
    // call is preferred over the parallel/merge pattern used for box
    // scores.
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: systemPrompt }];
    for (const f of files) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${f.mimetype || "image/png"};base64,${f.buffer.toString("base64")}`,
        },
      });
    }

    let parsed: unknown;
    try {
      const response = await createChatCompletion({
        model: AI_MODEL,
        max_completion_tokens: 4000,
        reasoning_effort: "none",
        messages: [{ role: "user", content }],
      });
      const text = response.choices[0]?.message?.content ?? "";
      // Strip code fences if the model wrapped it
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      req.log.error({ err: e }, "pool-play extract failed");
      res.status(502).json({ error: "Failed to parse screenshots — try again or paste teams + games manually." });
      return;
    }

    // Best-effort shape coercion — the coach will review/edit before
    // saving, so we don't reject on minor schema deviations.
    const safeStr = (v: unknown, max = 80) =>
      typeof v === "string" ? v.trim().slice(0, max) : "";
    const intOrNull = (v: unknown): number | null => {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      const n = Math.round(v);
      if (n < 0 || n > 99) return null;
      return n;
    };
    const rawTeams = Array.isArray((parsed as { teams?: unknown }).teams)
      ? ((parsed as { teams: unknown[] }).teams as unknown[])
      : [];
    const rawGames = Array.isArray((parsed as { games?: unknown }).games)
      ? ((parsed as { games: unknown[] }).games as unknown[])
      : [];

    const teams = rawTeams
      .map((t) => ({ name: safeStr((t as { name?: unknown })?.name) }))
      .filter((t) => t.name.length > 0)
      .slice(0, 16);

    // Dedupe team names (case-insensitive) preserving first-seen casing.
    const seenTeam = new Set<string>();
    const uniqueTeams = teams.filter((t) => {
      const k = t.name.toLowerCase();
      if (seenTeam.has(k)) return false;
      seenTeam.add(k);
      return true;
    });
    const teamLookup = new Map(uniqueTeams.map((t) => [t.name.toLowerCase(), t.name]));

    // Game IDs are server-generated UUIDs so the client never has to
    // mint them; on edit/add the client mints new ones.
    let gid = 0;
    const games = rawGames
      .map((g) => {
        const o = g as Record<string, unknown>;
        const home = teamLookup.get(safeStr(o.home).toLowerCase()) ?? safeStr(o.home);
        const away = teamLookup.get(safeStr(o.away).toLowerCase()) ?? safeStr(o.away);
        const homeScore = intOrNull(o.homeScore);
        const awayScore = intOrNull(o.awayScore);
        const final = Boolean(o.final) && homeScore != null && awayScore != null;
        if (!home || !away || home.toLowerCase() === away.toLowerCase()) return null;
        // Validate scheduledAt: must parse as a real date AND fall
        // within ±14 days of the tournament window (guards against the
        // model hallucinating times in a different year or returning
        // "today" by accident).
        let scheduledAt: string | null = null;
        const rawSched = o.scheduledAt;
        if (typeof rawSched === "string" && rawSched.length > 0) {
          const parsed = new Date(rawSched);
          if (!Number.isNaN(parsed.getTime())) {
            const tMs = parsed.getTime();
            const winMs = 14 * 24 * 60 * 60 * 1000;
            const lo = tournament.startDate.getTime() - winMs;
            const hi = tournament.endDate.getTime() + winMs;
            if (tMs >= lo && tMs <= hi) {
              scheduledAt = parsed.toISOString();
            }
          }
        }
        gid++;
        return {
          id: `ext-${Date.now()}-${gid}`,
          home,
          away,
          homeScore: final ? homeScore : null,
          awayScore: final ? awayScore : null,
          final,
          scheduledAt,
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
      .slice(0, 64);

    const ourTeamGuessRaw = safeStr((parsed as { ourTeamGuess?: unknown }).ourTeamGuess);
    const ourTeamGuess =
      ourTeamGuessRaw && teamLookup.get(ourTeamGuessRaw.toLowerCase())
        ? teamLookup.get(ourTeamGuessRaw.toLowerCase())!
        : null;
    const tiebreakerNoteRaw = (parsed as { tiebreakerNote?: unknown }).tiebreakerNote;
    const tiebreakerNote =
      typeof tiebreakerNoteRaw === "string" && tiebreakerNoteRaw.trim().length > 0
        ? tiebreakerNoteRaw.trim().slice(0, 400)
        : null;

    res.json({
      ourTeamGuess,
      teams: uniqueTeams,
      games,
      tiebreakerNote,
    });
  },
);

// ---------------------------------------------------------------------------
// POST /tournaments/:id/pool-play/extract-url — fetch a public tournament
// page (e.g. SportsEngine Tourney bracket / TourneyMachine) and parse it
// via the same gpt-5.2 extraction schema as screenshots. The coach
// reviews/edits the preview before persisting, identical to the
// screenshot flow.
// ---------------------------------------------------------------------------

const ExtractUrlBody = z.object({
  url: z.string().url().max(2048),
});

/**
 * Returns true iff an IP literal lies in a loopback, private,
 * link-local, CGNAT, or IPv6 ULA/link-local range. Anything we don't
 * recognize is treated as public (rangelist is conservative; the URL
 * parse + dns.lookup upstream guarantees we only ever feed real IPs).
 */
function isPrivateIp(ip: string): boolean {
  return (
    /^127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ||
    ip === "0.0.0.0" ||
    ip === "::1" ||
    ip === "::" ||
    /^fe80:/i.test(ip) ||
    /^f[cd][0-9a-f]{2}:/i.test(ip)
  );
}

type ResolvedHost = { url: URL; ip: string; family: 4 | 6 };

/**
 * SSRF guard. Refuse non-http(s). Resolve hostname; refuse if ANY
 * returned address is private (so dual-stack mixed records can't
 * smuggle a private IP). Returns the first allowed address so the
 * caller can PIN the socket to that exact IP via a custom undici
 * dispatcher — this is what defeats DNS-rebinding (a second lookup at
 * connect time would otherwise let an attacker swap the public IP for
 * 127.0.0.1 between check and fetch).
 */
async function assertPublicHttpUrl(raw: string): Promise<ResolvedHost> {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed.");
  }
  const dns = await import("node:dns");
  const net = await import("node:net");
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await dns.promises.lookup(u.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Couldn't resolve that hostname.");
  }
  if (addrs.length === 0) throw new Error("Couldn't resolve that hostname.");
  for (const a of addrs) {
    if (net.isIP(a.address) === 0 || isPrivateIp(a.address)) {
      throw new Error("That URL points to a private network address.");
    }
  }
  const first = addrs[0]!;
  return { url: u, ip: first.address, family: first.family === 6 ? 6 : 4 };
}

/**
 * SSRF-safe fetch: pins the socket to the IP we already validated
 * (defeats DNS rebinding) and follows redirects MANUALLY, re-running
 * `assertPublicHttpUrl` on each hop (so a public URL can't redirect to
 * `http://127.0.0.1/...`). Streams the body with a hard byte cap so a
 * 1 GB response can't OOM the server. Returns the decoded text.
 */
async function safeHttpFetchText(
  initial: ResolvedHost,
  opts: { maxBytes: number; timeoutMs: number; maxRedirects: number },
): Promise<{ text: string; contentType: string }> {
  // undici ships with Node 24 but isn't a typed workspace dep, so we
  // grab it via the runtime require to bypass tsc module resolution.
  // We only need `new Agent({ connect: { lookup } })`.
  const { createRequire } = await import("node:module");
  const nodeRequire = createRequire(import.meta.url);
  const undici = nodeRequire("undici") as {
    Agent: new (opts: {
      connect: {
        lookup: (
          host: string,
          options: unknown,
          cb: (err: Error | null, addr: string, family: number) => void,
        ) => void;
      };
    }) => unknown;
  };
  let hop = initial;
  for (let i = 0; i <= opts.maxRedirects; i++) {
    // Per-hop dispatcher pins this connection's DNS to the IP we
    // already vetted. SNI/Host still uses hop.url.hostname so HTTPS
    // certs validate normally.
    const dispatcher = new undici.Agent({
      connect: {
        lookup: (_host, _options, cb) => cb(null, hop.ip, hop.family),
      },
    });
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    let r: Response;
    try {
      r = await fetch(hop.url.toString(), {
        method: "GET",
        signal: ctrl.signal,
        redirect: "manual",
        headers: {
          "user-agent": "LineupLab/1.0 (+https://lineuplab.app)",
          accept: "text/html,application/xhtml+xml",
        },
        // Node's global fetch accepts an undici Dispatcher even though
        // the lib.dom RequestInit type doesn't declare it.
        ...({ dispatcher } as object),
      });
    } finally {
      clearTimeout(to);
    }

    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) throw new Error("Got a redirect with no Location header.");
      const next = new URL(loc, hop.url);
      hop = await assertPublicHttpUrl(next.toString());
      // Drain the (likely empty) redirect body so the socket can close.
      try {
        await r.body?.cancel();
      } catch {
        /* ignore */
      }
      continue;
    }
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }
    const contentType = r.headers.get("content-type") ?? "";

    // Stream the body, abort when we cross the cap. arrayBuffer() would
    // buffer the full payload first, which is the OOM hole.
    const reader = r.body?.getReader();
    if (!reader) throw new Error("Empty response body.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > opts.maxBytes) {
          await reader.cancel();
          throw new Error("That page is too large to read.");
        }
        chunks.push(value);
      }
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    return { text: new TextDecoder("utf-8").decode(buf), contentType };
  }
  throw new Error("Too many redirects.");
}

/**
 * Strip HTML to text the LLM can reason about. We keep <a href> URLs
 * out (waste of tokens), drop <script>/<style>, and collapse runs of
 * whitespace. Truncate to ~60 KB of text — plenty for a tournament
 * standings/schedule page and well under gpt-5.2's context budget.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60_000);
}

router.post(
  "/tournaments/:id/pool-play/extract-url",
  async (req, res): Promise<void> => {
    const userId = req.ownerUserId!;
    const params = IdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = ExtractUrlBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const tournament = await getOwnedTournament(params.data.id, userId);
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }

    let initialHost: ResolvedHost;
    try {
      initialHost = await assertPublicHttpUrl(body.data.url);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }

    // Fetch BEFORE charging — a failed fetch shouldn't burn the
    // coach's AI budget.
    let pageText: string;
    try {
      const { text, contentType } = await safeHttpFetchText(initialHost, {
        maxBytes: 4 * 1024 * 1024,
        timeoutMs: 15_000,
        maxRedirects: 5,
      });
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        res.status(400).json({ error: "That URL didn't return an HTML page." });
        return;
      }
      pageText = htmlToText(text);
    } catch (e) {
      req.log.warn(
        { err: e, url: initialHost.url.toString() },
        "pool-play url fetch failed",
      );
      const msg = (e as Error)?.message ?? "";
      if (msg === "That page is too large to read.") {
        res.status(400).json({ error: msg });
        return;
      }
      if (msg.startsWith("That URL points to a private")) {
        res.status(400).json({ error: msg });
        return;
      }
      res.status(502).json({ error: "Couldn't load that page — check the link and try again." });
      return;
    }
    if (pageText.length < 50) {
      res.status(400).json({ error: "That page didn't contain any readable schedule text." });
      return;
    }

    // Page fetched & non-empty — NOW charge the AI call.
    const charge = await chargeAiCall(req, "pool-play-extract", 1);
    if (!charge.ok) {
      res.status(charge.status).json({ error: charge.error });
      return;
    }

    const existingHint = tournament.poolPlay
      ? `\n\nThe coach already has this pool data saved — prefer reconciling rather than inventing new teams or games:\n${JSON.stringify(
          {
            teams: tournament.poolPlay.teams,
            games: tournament.poolPlay.games.map((g) => ({
              home: g.home,
              away: g.away,
              homeScore: g.homeScore,
              awayScore: g.awayScore,
              final: g.final,
            })),
          },
        )}`
      : "";

    const systemPrompt = `You are a baseball/softball tournament pool-play extractor. The user pasted a link to a published tournament page (commonly SportsEngine Tourney / TourneyMachine, GameChanger, or a league site). The page's visible text is provided below between <PAGE> tags. Extract:

1. TEAMS in the coach's pool (their names exactly as written; trim whitespace; preserve case and any colors/numbers in the name). If the page lists multiple pools/divisions, pick the one that matches "${tournament.name}" or the coach's tournament location best; if ambiguous, prefer the FIRST pool/division shown.
2. GAMES between those teams. For each game:
   - home / away team names.
   - homeScore / awayScore: integers if a final score is shown; null otherwise.
   - final: true iff a final score is shown AND the game is marked complete (not "in progress" / "scheduled" / TBD).
   - scheduledAt: scheduled first-pitch ISO-8601 with timezone. Fall back to the tournament startDate (${tournament.startDate.toISOString()}) for the date portion when only a time is visible. null if no time is shown.
3. TIEBREAKER NOTE: free-form text of any tiebreaker rules visible on the page. null if not shown.
4. OUR TEAM GUESS: which team in the pool is the coach's. The team often appears in the tournament name "${tournament.name}". null if no clear signal.

Only include teams + games visible on the page. Do NOT invent games to "complete" a round-robin. Do NOT carry information from your training data — only what's on the page.${existingHint}

Tournament context: "${tournament.name}"${tournament.location ? `, ${tournament.location}` : ""}. Runs ${tournament.startDate.toISOString().slice(0, 10)} to ${tournament.endDate.toISOString().slice(0, 10)}.

Return RAW JSON only, no markdown, no commentary:
{
  "ourTeamGuess": "<string or null>",
  "teams": [{ "name": "<string>" }, ...],
  "games": [
    { "home": "<string>", "away": "<string>", "homeScore": <int|null>, "awayScore": <int|null>, "final": <bool>, "scheduledAt": "<ISO-8601 string or null>" },
    ...
  ],
  "tiebreakerNote": "<string or null>"
}

<PAGE>
${pageText}
</PAGE>`;

    let parsed: unknown;
    try {
      const response = await createChatCompletion({
        model: AI_MODEL,
        max_completion_tokens: 4000,
        reasoning_effort: "none",
        messages: [{ role: "user", content: systemPrompt }],
      });
      const text = response.choices[0]?.message?.content ?? "";
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      req.log.error({ err: e }, "pool-play url extract failed");
      res.status(502).json({ error: "Couldn't read that page — try a different link or upload screenshots instead." });
      return;
    }

    // Reuse identical shape coercion as the screenshot path.
    const safeStr = (v: unknown, max = 80) =>
      typeof v === "string" ? v.trim().slice(0, max) : "";
    const intOrNull = (v: unknown): number | null => {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      const n = Math.round(v);
      if (n < 0 || n > 99) return null;
      return n;
    };
    const rawTeams = Array.isArray((parsed as { teams?: unknown }).teams)
      ? ((parsed as { teams: unknown[] }).teams as unknown[])
      : [];
    const rawGames = Array.isArray((parsed as { games?: unknown }).games)
      ? ((parsed as { games: unknown[] }).games as unknown[])
      : [];

    const teams = rawTeams
      .map((t) => ({ name: safeStr((t as { name?: unknown })?.name) }))
      .filter((t) => t.name.length > 0)
      .slice(0, 16);

    const seenTeam = new Set<string>();
    const uniqueTeams = teams.filter((t) => {
      const k = t.name.toLowerCase();
      if (seenTeam.has(k)) return false;
      seenTeam.add(k);
      return true;
    });
    const teamLookup = new Map(uniqueTeams.map((t) => [t.name.toLowerCase(), t.name]));

    let gid = 0;
    const games = rawGames
      .map((g) => {
        const o = g as Record<string, unknown>;
        const home = teamLookup.get(safeStr(o.home).toLowerCase()) ?? safeStr(o.home);
        const away = teamLookup.get(safeStr(o.away).toLowerCase()) ?? safeStr(o.away);
        const homeScore = intOrNull(o.homeScore);
        const awayScore = intOrNull(o.awayScore);
        const final = Boolean(o.final) && homeScore != null && awayScore != null;
        if (!home || !away || home.toLowerCase() === away.toLowerCase()) return null;
        let scheduledAt: string | null = null;
        const rawSched = o.scheduledAt;
        if (typeof rawSched === "string" && rawSched.length > 0) {
          const parsedDate = new Date(rawSched);
          if (!Number.isNaN(parsedDate.getTime())) {
            const tMs = parsedDate.getTime();
            const winMs = 14 * 24 * 60 * 60 * 1000;
            const lo = tournament.startDate.getTime() - winMs;
            const hi = tournament.endDate.getTime() + winMs;
            if (tMs >= lo && tMs <= hi) {
              scheduledAt = parsedDate.toISOString();
            }
          }
        }
        gid++;
        return {
          id: `ext-${Date.now()}-${gid}`,
          home,
          away,
          homeScore: final ? homeScore : null,
          awayScore: final ? awayScore : null,
          final,
          scheduledAt,
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
      .slice(0, 64);

    const ourTeamGuessRaw = safeStr((parsed as { ourTeamGuess?: unknown }).ourTeamGuess);
    const ourTeamGuess =
      ourTeamGuessRaw && teamLookup.get(ourTeamGuessRaw.toLowerCase())
        ? teamLookup.get(ourTeamGuessRaw.toLowerCase())!
        : null;
    const tiebreakerNoteRaw = (parsed as { tiebreakerNote?: unknown }).tiebreakerNote;
    const tiebreakerNote =
      typeof tiebreakerNoteRaw === "string" && tiebreakerNoteRaw.trim().length > 0
        ? tiebreakerNoteRaw.trim().slice(0, 400)
        : null;

    res.json({
      ourTeamGuess,
      teams: uniqueTeams,
      games,
      tiebreakerNote,
    });
  },
);

// ---------------------------------------------------------------------------
// POST /tournaments/:id/pool-play/format-extract — parse a rules screenshot
//
// Coach uploads 1-2 photos of the tournament's posted seeding /
// tiebreaker rules. We ask the AI to return only the structured fields
// (advanceCount, byeCount, ordered tiebreakers, teamCount). The coach
// confirms in the UI before they're applied to the saved pool play.
// ---------------------------------------------------------------------------

router.post(
  "/tournaments/:id/pool-play/format-extract",
  upload.array("files", 2),
  async (req, res): Promise<void> => {
    const userId = req.ownerUserId!;
    const params = IdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const tournament = await getOwnedTournament(params.data.id, userId);
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: "Upload at least one screenshot" });
      return;
    }
    if (files.length > 2) {
      res.status(400).json({ error: "Upload at most 2 screenshots" });
      return;
    }

    const charge = await chargeAiCall(req, "pool-play-format-extract", files.length);
    if (!charge.ok) {
      res.status(charge.status).json({ error: charge.error });
      return;
    }

    const allowedTiebreakers = POOL_PLAY_TIEBREAKER_KEYS.join(" | ");
    const systemPrompt = `You are a baseball/softball tournament seeding-rule extractor. The user uploaded screenshots of a tournament's posted seeding/tiebreaker rules. Extract ONLY the structured format — do NOT extract team names or games.

Return EXACTLY this JSON shape (no markdown, no commentary):
{
  "advanceCount": <integer 1-8 | null>,   // how many teams advance from the pool
  "byeCount":     <integer 0-8 | null>,   // how many advancing teams get a bracket bye
  "teamCount":    <integer 2-16 | null>,  // total teams in the pool
  "tiebreakers":  ["${POOL_PLAY_TIEBREAKER_KEYS.join('","')}", ...] | null,  // ORDERED list, most-important first
  "notes":        "<short free-text summary of anything you noticed but couldn't structure>" | null
}

Rules for "tiebreakers" — map English phrases to these keys (use ONLY these, in the order the rules state):
  ${allowedTiebreakers}
Common mappings:
  - "record" / "win-loss record" / "winning percentage" → "winPct"
  - "head to head" / "h2h" / "head-to-head" → "h2h"
  - "run differential" / "run diff" / "run +/-" → "runDiff"
  - "runs allowed" / "fewest runs against" / "runs against" / "defensive runs" → "runsAllowed"
  - "runs scored" / "most runs for" → "runsScored"
  - "coin flip" / "coin toss" / "draw" / "random" → "coinFlip"

If a rule isn't visible in the screenshot, return null for that field — do NOT guess from your training data.

Tournament context: "${tournament.name}"${tournament.location ? `, ${tournament.location}` : ""}.`;

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: systemPrompt }];
    for (const f of files) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${f.mimetype || "image/png"};base64,${f.buffer.toString("base64")}`,
        },
      });
    }

    let parsed: unknown;
    try {
      const response = await createChatCompletion({
        model: AI_MODEL,
        max_completion_tokens: 1000,
        reasoning_effort: "none",
        messages: [{ role: "user", content }],
      });
      const text = response.choices[0]?.message?.content ?? "";
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      req.log.error({ err: e }, "pool-play format-extract failed");
      res.status(502).json({ error: "Couldn't read the rules screenshot — try a clearer photo or enter manually." });
      return;
    }

    // Best-effort coercion. The coach confirms before applying.
    const obj = (parsed ?? {}) as Record<string, unknown>;
    const intInRange = (v: unknown, lo: number, hi: number): number | null => {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      const n = Math.round(v);
      if (n < lo || n > hi) return null;
      return n;
    };
    const allowedSet = new Set<string>(POOL_PLAY_TIEBREAKER_KEYS);
    const rawTb = obj.tiebreakers;
    let tiebreakers: PoolPlayTiebreakerKey[] | null = null;
    if (Array.isArray(rawTb)) {
      const seen = new Set<string>();
      const list: PoolPlayTiebreakerKey[] = [];
      for (const k of rawTb) {
        if (typeof k !== "string") continue;
        if (!allowedSet.has(k)) continue;
        if (seen.has(k)) continue;
        seen.add(k);
        list.push(k as PoolPlayTiebreakerKey);
        if (list.length >= 8) break;
      }
      if (list.length > 0) tiebreakers = list;
    }
    const notes =
      typeof obj.notes === "string" && obj.notes.trim().length > 0
        ? obj.notes.trim().slice(0, 400)
        : null;

    res.json({
      advanceCount: intInRange(obj.advanceCount, 1, 8),
      byeCount: intInRange(obj.byeCount, 0, 8),
      teamCount: intInRange(obj.teamCount, 2, 16),
      tiebreakers,
      notes,
    });
  },
);

// ---------------------------------------------------------------------------
// POST /tournaments/:id/pool-play/chat — conversational format intake
//
// Lets a coach describe their tournament format in natural language
// ("10 teams, top 6 advance, top 2 get a bye, tiebreakers are h2h
// then run differential then runs allowed"). The AI replies in plain
// English AND, when it has enough signal, emits a structured
// `parsedFormat` object matching ExtractedPoolPlayFormat. The coach
// reviews and clicks "Apply format" in the dialog to commit.
//
// Stateless — the client sends the full conversation each turn.
// ---------------------------------------------------------------------------

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const ChatBodySchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(40),
});

router.post(
  "/tournaments/:id/pool-play/chat",
  async (req, res): Promise<void> => {
    const userId = req.ownerUserId!;
    const params = IdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const tournament = await getOwnedTournament(params.data.id, userId);
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    const bodyParsed = ChatBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: bodyParsed.error.message });
      return;
    }

    const charge = await chargeAiCall(req, "pool-play-format-chat", 1);
    if (!charge.ok) {
      res.status(charge.status).json({ error: charge.error });
      return;
    }

    const allowedTiebreakers = POOL_PLAY_TIEBREAKER_KEYS.join('","');
    const systemPrompt = `You are helping a youth baseball/softball coach configure the seeding/tiebreaker rules of a tournament called "${tournament.name}"${tournament.location ? ` (${tournament.location})` : ""}.

Have a brief, friendly conversation with the coach to gather:
  - teamCount      (total teams in their pool — integer 2-16, optional)
  - advanceCount   (how many advance to bracket play — integer 1-8)
  - byeCount       (how many advancing teams get a first-round bye — integer 0-8, ≤ advanceCount)
  - tiebreakers    (ORDERED list, most-important first; one or more of: "${allowedTiebreakers}")

Mapping help (English → key):
  - "record" / "win-loss record" / "winning percentage" → "winPct"
  - "head to head" / "h2h" → "h2h"
  - "run differential" / "run diff" → "runDiff"
  - "runs allowed" / "fewest runs against" → "runsAllowed"
  - "runs scored" / "most runs for" → "runsScored"
  - "coin flip" / "draw" / "random" → "coinFlip"

GUIDELINES:
  - Keep replies SHORT (1-3 sentences). Ask at most one clarifying question per turn.
  - If the coach gives all required fields in one message, confirm by summarizing back and emit the parsedFormat immediately.
  - If the coach pastes verbose tournament rules, extract everything you can and emit a partial parsedFormat without nagging for missing fields — they can fill them in later.
  - Never invent values you weren't told. Omit (null) anything you're unsure of.
  - Don't ask about pool/team names — that's collected in a separate flow.

RETURN FORMAT — EXACTLY this JSON, no markdown fences, no extra prose:
{
  "reply": "<short conversational response to the coach>",
  "parsedFormat": null OR {
    "advanceCount": <integer 1-8 | null>,
    "byeCount":     <integer 0-8 | null>,
    "teamCount":    <integer 2-16 | null>,
    "tiebreakers":  ["${POOL_PLAY_TIEBREAKER_KEYS.join('","')}", ...] | null,
    "notes":        "<short free-text> | null"
  }
}

Emit a non-null parsedFormat as soon as you've gathered enough to be useful — at minimum advanceCount + tiebreakers. The coach reviews before it's applied, so it's safe to propose.`;

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      ...bodyParsed.data.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    let parsed: { reply?: unknown; parsedFormat?: unknown };
    try {
      const response = await createChatCompletion({
        model: AI_MODEL,
        max_completion_tokens: 800,
        reasoning_effort: "none",
        messages: chatMessages,
      });
      const text = response.choices[0]?.message?.content ?? "";
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      req.log.error({ err: e }, "pool-play chat failed");
      res.status(502).json({
        error: "AI couldn't process that message — try rephrasing or fall back to the rules-photo / manual edit flow.",
      });
      return;
    }

    const reply =
      typeof parsed.reply === "string" && parsed.reply.trim().length > 0
        ? parsed.reply.trim().slice(0, 2000)
        : "Got it.";

    // Reuse the same coercion as format-extract so the shapes match.
    let parsedFormat: {
      advanceCount: number | null;
      byeCount: number | null;
      teamCount: number | null;
      tiebreakers: PoolPlayTiebreakerKey[] | null;
      notes: string | null;
    } | null = null;
    const rawFmt = parsed.parsedFormat;
    if (rawFmt && typeof rawFmt === "object") {
      const obj = rawFmt as Record<string, unknown>;
      const intInRange = (v: unknown, lo: number, hi: number): number | null => {
        if (typeof v !== "number" || !Number.isFinite(v)) return null;
        const n = Math.round(v);
        if (n < lo || n > hi) return null;
        return n;
      };
      const allowedSet = new Set<string>(POOL_PLAY_TIEBREAKER_KEYS);
      let tiebreakers: PoolPlayTiebreakerKey[] | null = null;
      if (Array.isArray(obj.tiebreakers)) {
        const seen = new Set<string>();
        const list: PoolPlayTiebreakerKey[] = [];
        for (const k of obj.tiebreakers) {
          if (typeof k !== "string") continue;
          if (!allowedSet.has(k)) continue;
          if (seen.has(k)) continue;
          seen.add(k);
          list.push(k as PoolPlayTiebreakerKey);
          if (list.length >= 8) break;
        }
        if (list.length > 0) tiebreakers = list;
      }
      const notes =
        typeof obj.notes === "string" && obj.notes.trim().length > 0
          ? obj.notes.trim().slice(0, 400)
          : null;
      parsedFormat = {
        advanceCount: intInRange(obj.advanceCount, 1, 8),
        byeCount: intInRange(obj.byeCount, 0, 8),
        teamCount: intInRange(obj.teamCount, 2, 16),
        tiebreakers,
        notes,
      };
      // If every field is null, drop it — no point showing the coach a
      // useless "Apply format" CTA.
      const allNull =
        parsedFormat.advanceCount === null &&
        parsedFormat.byeCount === null &&
        parsedFormat.teamCount === null &&
        parsedFormat.tiebreakers === null &&
        parsedFormat.notes === null;
      if (allNull) parsedFormat = null;
    }

    res.json({ reply, parsedFormat });
  },
);

// ---------------------------------------------------------------------------
// PUT /tournaments/:id/pool-play — save (or replace) parsed pool data
// ---------------------------------------------------------------------------

router.put("/tournaments/:id/pool-play", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ifm = parseIfMatch(req);
  if (!ifm.ok) {
    rejectBadIfMatch(res);
    return;
  }
  const tournament = await getOwnedTournament(params.data.id, userId);
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }

  const bodyParsed = PoolPlayJson.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const poolPlay = bodyParsed.data;

  // Cross-validate: every game's home/away must be a listed team.
  const teamNames = new Set(poolPlay.teams.map((t) => t.name));
  for (const g of poolPlay.games) {
    if (!teamNames.has(g.home) || !teamNames.has(g.away)) {
      res.status(400).json({
        error: `Game references unknown team: ${g.home} vs ${g.away}`,
      });
      return;
    }
    if (g.home === g.away) {
      res.status(400).json({ error: "Game home and away must differ" });
      return;
    }
    if (g.final && (g.homeScore == null || g.awayScore == null)) {
      res.status(400).json({ error: "Final games require both scores" });
      return;
    }
  }
  if (!teamNames.has(poolPlay.ourTeamName)) {
    res
      .status(400)
      .json({ error: `ourTeamName "${poolPlay.ourTeamName}" is not in the teams list` });
    return;
  }

  const toStore: PoolPlayJsonType = {
    ...poolPlay,
    updatedAt: new Date().toISOString(),
  };
  const result = await versionedUpdate(db, tournamentsTable, {
    set: { poolPlay: toStore },
    where: and(
      eq(tournamentsTable.id, params.data.id),
      eq(tournamentsTable.userId, userId),
    ),
    ifMatch: ifm.version,
  });
  if (result.kind === "conflict") {
    sendConflict(res, result.current);
    return;
  }
  if (result.kind === "missing") {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }

  const poolPlayAnalysis = simulatePoolPlay(toStore);
  res.json({ poolPlay: toStore, poolPlayAnalysis });
});

// ---------------------------------------------------------------------------
// DELETE /tournaments/:id/pool-play — clear saved pool data
// ---------------------------------------------------------------------------

router.delete("/tournaments/:id/pool-play", async (req, res): Promise<void> => {
  const userId = req.ownerUserId!;
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ifm = parseIfMatch(req);
  if (!ifm.ok) {
    rejectBadIfMatch(res);
    return;
  }
  const tournament = await getOwnedTournament(params.data.id, userId);
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  const result = await versionedUpdate(db, tournamentsTable, {
    set: { poolPlay: null },
    where: and(
      eq(tournamentsTable.id, params.data.id),
      eq(tournamentsTable.userId, userId),
    ),
    ifMatch: ifm.version,
  });
  if (result.kind === "conflict") {
    sendConflict(res, result.current);
    return;
  }
  if (result.kind === "missing") {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  res.status(204).end();
});

export default router;
