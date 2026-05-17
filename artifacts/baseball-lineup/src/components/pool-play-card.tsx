import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useExtractTournamentPoolPlay,
  useExtractTournamentPoolPlayFromUrl,
  useExtractTournamentPoolPlayFormat,
  useSaveTournamentPoolPlay,
  useClearTournamentPoolPlay,
  getGetTournamentQueryKey,
  type PoolPlay,
  type PoolPlayAnalysis,
  type PoolPlayGame,
  type PoolPlayTiebreakerKey,
  type ExtractedPoolPlay,
  type ExtractedPoolPlayFormat,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ListChecks,
  UploadCloud,
  Loader2,
  Trash2,
  Plus,
  Trophy,
  CheckCircle2,
  XCircle,
  Sparkles,
  Pencil,
  X,
  ArrowUp,
  ArrowDown,
  Award,
  Camera,
  MessageCircle,
  Link2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TournamentFormatChatDialog } from "@/components/tournament-format-chat-dialog";

/**
 * "Pool Play" card on the tournament detail page. Handles the full
 * lifecycle: empty → import screenshots → review/edit → save →
 * standings + scenario projections.
 *
 * The simulator runs server-side on every GET, so saving the edited
 * pool re-projects on the next refetch. The card itself stays
 * stateless beyond local edits-in-flight.
 */
export function PoolPlayCard({
  tournamentId,
  poolPlay,
  analysis,
}: {
  tournamentId: number;
  poolPlay: PoolPlay | null;
  analysis: PoolPlayAnalysis | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Held when the coach extracts a format via rules-photo while no
  // pool exists yet — the next opened Import/Edit dialog will seed
  // its defaults from this so the format isn't lost.
  const [pendingFormat, setPendingFormat] = useState<{
    advanceCount?: number;
    byeCount?: number;
    tiebreakers?: PoolPlayTiebreakerKey[];
  } | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListChecks className="h-5 w-5 text-purple-600" />
          Pool Play Scenarios
        </CardTitle>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={() => setChatOpen(true)}>
            <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
            Set up with AI
          </Button>
          {poolPlay && (
            <Button size="sm" variant="outline" onClick={() => setFormatOpen(true)}>
              <Camera className="h-3.5 w-3.5 mr-1.5" />
              Rules photo
            </Button>
          )}
          {poolPlay && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          )}
          <Button size="sm" variant={poolPlay ? "outline" : "default"} onClick={() => setImportOpen(true)}>
            <UploadCloud className="h-3.5 w-3.5 mr-1.5" />
            {poolPlay ? "Re-import" : "Import screenshots"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!poolPlay || !analysis ? (
          <EmptyState
            onImport={() => setImportOpen(true)}
            onSetFormat={() => setFormatOpen(true)}
          />
        ) : (
          <PoolPlayBody poolPlay={poolPlay} analysis={analysis} />
        )}
      </CardContent>

      {importOpen && (
        <ImportDialog
          tournamentId={tournamentId}
          existing={poolPlay}
          seedFormat={pendingFormat}
          onClose={() => {
            setImportOpen(false);
            setPendingFormat(null);
          }}
        />
      )}
      {editOpen && poolPlay && (
        <EditDialog
          tournamentId={tournamentId}
          initial={poolPlay}
          onClose={() => setEditOpen(false)}
        />
      )}
      {formatOpen && (
        <FormatExtractDialog
          tournamentId={tournamentId}
          existing={poolPlay}
          onClose={() => setFormatOpen(false)}
          onSeedFormat={(fmt) => {
            // No pool exists yet — stash the extracted format and chain
            // into the Import flow so the coach can add teams next.
            setPendingFormat(fmt);
            setFormatOpen(false);
            setImportOpen(true);
          }}
        />
      )}
      {chatOpen && (
        <TournamentFormatChatDialog
          tournamentId={tournamentId}
          onClose={() => setChatOpen(false)}
          onApplyFormat={(fmt) => {
            setChatOpen(false);
            if (poolPlay) {
              // Pool already exists — merge the new format directly and
              // save. We don't reopen the Edit dialog because the
              // PreviewEditor seeds tiebreakers from `existing` first,
              // which would silently drop the AI's proposal.
              void applyFormatToExistingPool(tournamentId, poolPlay, fmt, qc, toast);
            } else {
              // No pool yet — stash and chain into Import where the
              // coach adds team names; PreviewEditor reads `seedFormat`
              // when `existing` is null.
              setPendingFormat(fmt);
              setImportOpen(true);
            }
          }}
        />
      )}
    </Card>
  );
}

/**
 * Merge a chat-applied format into an existing pool and save in-place.
 * Keeps teams/games/ourTeamName/tiebreaker (legacy) untouched, just
 * overlays the new advanceCount/byeCount/tiebreakers fields and
 * bumps updatedAt.
 */
async function applyFormatToExistingPool(
  tournamentId: number,
  existing: PoolPlay,
  fmt: {
    advanceCount?: number;
    byeCount?: number;
    tiebreakers?: PoolPlayTiebreakerKey[];
  },
  qc: ReturnType<typeof useQueryClient>,
  toast: ReturnType<typeof useToast>["toast"],
) {
  // Pool sizes have an invariant — byeCount must not exceed advanceCount,
  // and advanceCount must not exceed the team count. Clamp defensively
  // so the server doesn't 400 on edge AI suggestions.
  const nextAdvance = Math.min(
    Math.max(1, fmt.advanceCount ?? existing.advanceCount),
    existing.teams.length,
  );
  const nextBye = Math.min(
    Math.max(0, fmt.byeCount ?? existing.byeCount ?? 0),
    nextAdvance,
  );
  const nextTiebreakers =
    fmt.tiebreakers && fmt.tiebreakers.length > 0
      ? fmt.tiebreakers
      : existing.tiebreakers && existing.tiebreakers.length > 0
        ? existing.tiebreakers
        : (["winPct", "h2h", "runDiff"] as PoolPlayTiebreakerKey[]);
  const next: PoolPlay = {
    ...existing,
    advanceCount: nextAdvance,
    byeCount: nextBye,
    tiebreakers: nextTiebreakers,
    updatedAt: new Date().toISOString(),
  };
  try {
    const { saveTournamentPoolPlay } = await import("@workspace/api-client-react");
    await saveTournamentPoolPlay(tournamentId, next);
    await qc.invalidateQueries({ queryKey: getGetTournamentQueryKey(tournamentId) });
    toast({ title: "Format applied", description: "Pool standings re-projected." });
  } catch (e) {
    toast({
      title: "Couldn't apply format",
      description: (e as Error)?.message ?? "Try again or use Edit to set it manually.",
      variant: "destructive",
    });
  }
}

function EmptyState({
  onImport,
  onSetFormat,
}: {
  onImport: () => void;
  onSetFormat: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground space-y-3">
      <ListChecks className="h-8 w-8 mx-auto opacity-50" />
      <div>
        Upload screenshots of the tournament's pool-play standings and schedule
        to project how the standings could finish.
      </div>
      <div className="flex gap-2 justify-center mt-1 flex-wrap">
        <Button size="sm" onClick={onImport}>
          <UploadCloud className="h-4 w-4 mr-1.5" />
          Import screenshots
        </Button>
        <Button size="sm" variant="outline" onClick={onSetFormat}>
          <Camera className="h-4 w-4 mr-1.5" />
          Set format from rules photo
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Display: standings + insights + projections
// ---------------------------------------------------------------------------

function PoolPlayBody({ poolPlay, analysis }: { poolPlay: PoolPlay; analysis: PoolPlayAnalysis }) {
  return (
    <div className="space-y-4">
      {analysis.ourTeamInsights.length > 0 && (
        <div className="rounded-md border border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/40 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-purple-900 dark:text-purple-200">
            <Sparkles className="h-4 w-4" />
            For {poolPlay.ourTeamName}
          </div>
          {analysis.ourTeamInsights.map((line, i) => (
            <div key={i} className="text-sm text-purple-950 dark:text-purple-100">
              {line}
            </div>
          ))}
        </div>
      )}

      {analysis.truncated && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-2.5 text-xs">
          {analysis.remainingGames} remaining games — only the first{" "}
          {analysis.remainingGamesCap} were enumerated ({analysis.scenarioCount} scenarios).
        </div>
      )}

      <AwaitingScoreBanner poolPlay={poolPlay} />


      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
          Standings today
        </div>
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-center">W-L-T</TableHead>
                <TableHead className="text-right">Run Diff</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.standingsToday.map((row, i) => (
                <TableRow
                  key={row.teamName}
                  className={row.teamName === poolPlay.ourTeamName ? "bg-purple-50/60 dark:bg-purple-950/20" : ""}
                >
                  <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                  <TableCell className="font-medium">{row.teamName}</TableCell>
                  <TableCell className="text-center font-mono text-sm">
                    {row.wins}-{row.losses}
                    {row.ties > 0 ? `-${row.ties}` : ""}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {row.runDiff >= 0 ? "+" : ""}
                    {row.runDiff}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
          Finishing odds (over {analysis.scenarioCount.toLocaleString()}{" "}
          {analysis.scenarioCount === 1 ? "scenario" : "scenarios"})
        </div>
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">1st</TableHead>
                <TableHead className="text-right">Advance (top {analysis.advanceCount})</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.projections.map((p) => {
                const isUs = p.teamName === poolPlay.ourTeamName;
                return (
                  <TableRow key={p.teamName} className={isUs ? "bg-purple-50/60 dark:bg-purple-950/20" : ""}>
                    <TableCell className="font-medium">{p.teamName}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {pct(p.firstProb)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {pct(p.advanceProb)}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge p={p} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        Tiebreakers: {tiebreakerChainLabel(analysis.tiebreakers)} • Pool of{" "}
        {poolPlay.teams.length} teams • Top {analysis.advanceCount} advance
        {analysis.byeCount > 0 ? ` (top ${analysis.byeCount} get a bye)` : ""} •{" "}
        {analysis.remainingGames}{" "}
        {analysis.remainingGames === 1 ? "game" : "games"} remaining
      </div>
    </div>
  );
}

/**
 * Surfaces games whose scheduled first-pitch time has passed but no
 * score has been entered yet. Helps coaches spot "missing" pool games
 * after walking off the field. Hidden when nothing is overdue — the
 * standings already say "N games remaining" for everything else.
 *
 * `scheduledAt` is optional per game (extracted from schedule
 * screenshots or copied from the linked real game's gameDate on
 * server-side merge), so most pool games will have it once the
 * tournament is set up.
 */
function AwaitingScoreBanner({ poolPlay }: { poolPlay: PoolPlay }) {
  const now = Date.now();
  // 30-minute grace so a game that just started doesn't immediately
  // get flagged as "missing a score."
  const cutoff = now - 30 * 60 * 1000;
  const overdue = poolPlay.games.filter((g) => {
    if (g.final) return false;
    if (!g.scheduledAt) return false;
    const t = new Date(g.scheduledAt).getTime();
    if (Number.isNaN(t)) return false;
    return t <= cutoff;
  });
  if (overdue.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-2.5 space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
        Awaiting score ({overdue.length})
      </div>
      <ul className="space-y-0.5 text-xs text-amber-950 dark:text-amber-100">
        {overdue.map((g) => (
          <li key={g.id} className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-amber-800/80 dark:text-amber-200/80 shrink-0">
              {formatScheduleTime(g.scheduledAt!)}
            </span>
            <span>
              {g.away} @ {g.home}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Short local-time format like "Sat 9:00 AM" for the awaiting list. */
function formatScheduleTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Convert ISO → "YYYY-MM-DDTHH:MM" in local time for datetime-local inputs. */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert datetime-local input value (local wall-clock) → ISO UTC. */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function StatusBadge({ p }: { p: PoolPlayAnalysis["projections"][number] }) {
  if (p.clinchedFirst) {
    return (
      <Badge className="bg-green-600 hover:bg-green-600">
        <Trophy className="h-3 w-3 mr-1" />
        Clinched 1st
      </Badge>
    );
  }
  if (p.clinchedBye) {
    return (
      <Badge className="bg-amber-500 hover:bg-amber-500 text-amber-950">
        <Award className="h-3 w-3 mr-1" />
        Clinched bye
      </Badge>
    );
  }
  if (p.clinchedAdvance) {
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Clinched
      </Badge>
    );
  }
  if (p.eliminatedAdvance) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <XCircle className="h-3 w-3 mr-1" />
        Eliminated
      </Badge>
    );
  }
  if (p.eliminatedFirst) {
    return (
      <Badge variant="outline">Can't finish 1st</Badge>
    );
  }
  return null;
}

function pct(n: number): string {
  if (n === 1) return "100%";
  if (n === 0) return "0%";
  const v = n * 100;
  if (v < 1) return "<1%";
  if (v > 99) return ">99%";
  return `${Math.round(v)}%`;
}

const TIEBREAKER_LABELS: Record<PoolPlayTiebreakerKey, string> = {
  winPct: "Win %",
  h2h: "Head-to-head",
  runDiff: "Run diff",
  runsAllowed: "Fewest runs allowed",
  runsScored: "Most runs scored",
  coinFlip: "Coin flip",
};

function tiebreakerChainLabel(keys: PoolPlayTiebreakerKey[]): string {
  if (!keys || keys.length === 0) return "Win %";
  return keys.map((k) => TIEBREAKER_LABELS[k] ?? k).join(" → ");
}

// ---------------------------------------------------------------------------
// Import dialog: upload → preview → save
// ---------------------------------------------------------------------------

type SeededFormat = {
  advanceCount?: number;
  byeCount?: number;
  tiebreakers?: PoolPlayTiebreakerKey[];
} | null;

function ImportDialog({
  tournamentId,
  existing,
  seedFormat,
  onClose,
}: {
  tournamentId: number;
  existing: PoolPlay | null;
  seedFormat?: SeededFormat;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ExtractedPoolPlay | null>(null);
  // Two import sources tab. SportsEngine Tourney / TourneyMachine /
  // GameChanger publish public bracket URLs — paste-and-go is faster
  // for coaches than screenshotting their own phones.
  const [source, setSource] = useState<"screenshots" | "url">("screenshots");
  const [url, setUrl] = useState("");

  const extract = useExtractTournamentPoolPlay({
    mutation: {
      onSuccess: (data) => {
        setPreview(data);
      },
      onError: (e) => {
        toast({
          title: "Couldn't read the screenshots",
          description: (e as Error)?.message ?? "Try again or use Edit to enter teams manually.",
          variant: "destructive",
        });
      },
    },
  });
  const extractUrl = useExtractTournamentPoolPlayFromUrl({
    mutation: {
      onSuccess: (data) => {
        setPreview(data);
      },
      onError: (e) => {
        toast({
          title: "Couldn't read that page",
          description:
            (e as Error)?.message ??
            "Check the link is public and try again, or upload screenshots instead.",
          variant: "destructive",
        });
      },
    },
  });
  const isExtracting = extract.isPending || extractUrl.isPending;

  function onSubmitUrl() {
    const trimmed = url.trim();
    if (trimmed.length === 0) return;
    extractUrl.mutate({ id: tournamentId, data: { url: trimmed } });
  }

  function onPickFiles(ev: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(ev.target.files ?? []);
    if (picked.length === 0) return;
    if (picked.length > 3) {
      toast({
        title: "Too many files",
        description: "Pick at most 3 screenshots.",
        variant: "destructive",
      });
      return;
    }
    setFiles(picked);
    extract.mutate({ id: tournamentId, data: { files: picked } });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import pool play</DialogTitle>
          <DialogDescription>
            Paste a SportsEngine Tourney / TourneyMachine link, or upload screenshots.
            The AI will extract teams and games — you can edit before saving.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4 py-2">
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-sm">
              <button
                type="button"
                className={`px-3 py-1.5 rounded ${source === "screenshots" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
                onClick={() => setSource("screenshots")}
                disabled={isExtracting}
              >
                <Camera className="h-3.5 w-3.5 mr-1.5 inline" />
                Screenshots
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded ${source === "url" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
                onClick={() => setSource("url")}
                disabled={isExtracting}
              >
                <Link2 className="h-3.5 w-3.5 mr-1.5 inline" />
                From link
              </button>
            </div>

            {source === "screenshots" ? (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={onPickFiles}
                />
                <div
                  className="rounded-lg border border-dashed py-12 text-center cursor-pointer hover:bg-muted/40 transition"
                  onClick={() => inputRef.current?.click()}
                >
                  {isExtracting ? (
                    <>
                      <Loader2 className="h-10 w-10 mx-auto animate-spin text-muted-foreground" />
                      <div className="text-sm text-muted-foreground mt-3">
                        Reading {files.length} {files.length === 1 ? "screenshot" : "screenshots"}…
                      </div>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="h-10 w-10 mx-auto text-muted-foreground" />
                      <div className="mt-2 text-sm font-medium">
                        Tap to choose screenshots
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        PNG, JPEG, or WebP. Up to 3 images, 8 MB each.
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <Label htmlFor="pool-play-url">Tournament page link</Label>
                <Input
                  id="pool-play-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://tourneymachine.com/Public/Results/Tournament.aspx?…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isExtracting) {
                      e.preventDefault();
                      onSubmitUrl();
                    }
                  }}
                  disabled={isExtracting}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Works with SportsEngine Tourney, TourneyMachine, GameChanger, and most public
                  league pages. The page must be publicly viewable — no login.
                </p>
                <Button
                  type="button"
                  onClick={onSubmitUrl}
                  disabled={isExtracting || url.trim().length === 0}
                >
                  {isExtracting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Reading page…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      Read pool play
                    </>
                  )}
                </Button>
              </div>
            )}
            {existing && (
              <div className="text-xs text-muted-foreground">
                Existing pool data will be used as context — re-importing won't lose your edits unless the AI returns conflicting data, which you'll review next.
              </div>
            )}
          </div>
        ) : (
          <PreviewEditor
            tournamentId={tournamentId}
            preview={preview}
            existing={existing}
            seedFormat={seedFormat}
            onClose={onClose}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: getGetTournamentQueryKey(tournamentId) });
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit dialog: open from saved state for manual tweaks
// ---------------------------------------------------------------------------

function EditDialog({
  tournamentId,
  initial,
  onClose,
}: {
  tournamentId: number;
  initial: PoolPlay;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Convert PoolPlay -> ExtractedPoolPlay shape for the shared editor.
  const preview: ExtractedPoolPlay = useMemo(
    () => ({
      ourTeamGuess: initial.ourTeamName,
      teams: initial.teams,
      games: initial.games,
      tiebreakerNote: null,
    }),
    [initial],
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit pool play</DialogTitle>
          <DialogDescription>
            Tweak teams, games, or scores. Saving re-runs the scenario simulator.
          </DialogDescription>
        </DialogHeader>
        <PreviewEditor
          tournamentId={tournamentId}
          preview={preview}
          existing={initial}
          onClose={onClose}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: getGetTournamentQueryKey(tournamentId) });
            onClose();
          }}
          showClear
        />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Editable preview / shared form
// ---------------------------------------------------------------------------

function PreviewEditor({
  tournamentId,
  preview,
  existing,
  seedFormat,
  onClose,
  onSaved,
  showClear,
}: {
  tournamentId: number;
  preview: ExtractedPoolPlay;
  existing: PoolPlay | null;
  seedFormat?: SeededFormat;
  onClose: () => void;
  onSaved: () => void;
  showClear?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [teams, setTeams] = useState<{ name: string }[]>(preview.teams);
  const [games, setGames] = useState<PoolPlayGame[]>(preview.games);
  const [ourTeam, setOurTeam] = useState<string>(
    preview.ourTeamGuess ?? existing?.ourTeamName ?? preview.teams[0]?.name ?? "",
  );
  // Precedence: existing saved values > seedFormat (from rules-photo
  // extraction in an empty-state flow) > hardcoded defaults.
  const [tiebreakers, setTiebreakers] = useState<PoolPlayTiebreakerKey[]>(
    existing?.tiebreakers && existing.tiebreakers.length > 0
      ? existing.tiebreakers
      : seedFormat?.tiebreakers && seedFormat.tiebreakers.length > 0
        ? seedFormat.tiebreakers
        : ["winPct", "h2h", "runDiff"],
  );
  const [advanceCount, setAdvanceCount] = useState<number>(
    existing?.advanceCount ?? seedFormat?.advanceCount ?? 2,
  );
  const [byeCount, setByeCount] = useState<number>(
    existing?.byeCount ?? seedFormat?.byeCount ?? 0,
  );

  // Keep ourTeam in sync when the team list shrinks below it.
  useEffect(() => {
    if (!teams.some((t) => t.name === ourTeam)) {
      setOurTeam(teams[0]?.name ?? "");
    }
  }, [teams, ourTeam]);

  const save = useSaveTournamentPoolPlay({
    mutation: {
      onSuccess: () => {
        toast({ title: "Pool play saved" });
        onSaved();
      },
      onError: (e) => {
        toast({
          title: "Save failed",
          description: (e as Error)?.message ?? "Check the form for errors.",
          variant: "destructive",
        });
      },
    },
  });
  const clear = useClearTournamentPoolPlay({
    mutation: {
      onSuccess: () => {
        toast({ title: "Pool play cleared" });
        qc.invalidateQueries({ queryKey: getGetTournamentQueryKey(tournamentId) });
        onClose();
      },
    },
  });

  function addTeam() {
    if (teams.length >= 16) return;
    setTeams((prev) => [...prev, { name: `Team ${prev.length + 1}` }]);
  }
  function removeTeam(idx: number) {
    const name = teams[idx]?.name;
    setTeams((prev) => prev.filter((_, i) => i !== idx));
    // Drop any games referencing the removed team
    if (name) setGames((prev) => prev.filter((g) => g.home !== name && g.away !== name));
  }
  function updateTeam(idx: number, newName: string) {
    const oldName = teams[idx]?.name;
    setTeams((prev) => prev.map((t, i) => (i === idx ? { name: newName } : t)));
    // Cascade rename into games + ourTeam
    if (oldName && oldName !== newName) {
      setGames((prev) =>
        prev.map((g) => ({
          ...g,
          home: g.home === oldName ? newName : g.home,
          away: g.away === oldName ? newName : g.away,
        })),
      );
      if (ourTeam === oldName) setOurTeam(newName);
    }
  }
  function addGame() {
    if (games.length >= 64) return;
    if (teams.length < 2) return;
    setGames((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        home: teams[0].name,
        away: teams[1]?.name ?? teams[0].name,
        homeScore: null,
        awayScore: null,
        final: false,
      },
    ]);
  }
  function removeGame(id: string) {
    setGames((prev) => prev.filter((g) => g.id !== id));
  }
  function updateGame(id: string, patch: Partial<PoolPlayGame>) {
    setGames((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const next = { ...g, ...patch };
        // If unmarking final, also clear scores so they re-enter as nulls
        if (!next.final) {
          // keep scores so the coach doesn't lose them mid-edit; the
          // server validator allows nulls when !final, and we always
          // null them on save if !final below
        }
        return next;
      }),
    );
  }

  function handleSave() {
    if (teams.length < 2) {
      toast({ title: "Add at least 2 teams", variant: "destructive" });
      return;
    }
    if (!ourTeam) {
      toast({ title: "Pick your team", variant: "destructive" });
      return;
    }
    // Normalize: blank-name teams dropped, scores cleared on non-final games.
    const normalizedTeams = teams.map((t) => ({ name: t.name.trim() })).filter((t) => t.name.length > 0);
    const teamNames = new Set(normalizedTeams.map((t) => t.name));
    const normalizedGames = games
      .filter((g) => teamNames.has(g.home) && teamNames.has(g.away) && g.home !== g.away)
      .map((g) =>
        g.final
          ? g
          : { ...g, homeScore: null, awayScore: null },
      );
    if (tiebreakers.length === 0) {
      toast({ title: "Add at least one tiebreaker", variant: "destructive" });
      return;
    }
    if (byeCount > advanceCount) {
      toast({
        title: "Bye count can't exceed advance count",
        variant: "destructive",
      });
      return;
    }
    const body: PoolPlay = {
      ourTeamName: ourTeam,
      teams: normalizedTeams,
      games: normalizedGames,
      tiebreakers,
      advanceCount,
      byeCount,
      updatedAt: new Date().toISOString(),
    };
    save.mutate({ id: tournamentId, data: body });
  }

  function moveTiebreaker(idx: number, delta: -1 | 1) {
    setTiebreakers((prev) => {
      const next = [...prev];
      const swap = idx + delta;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }
  function removeTiebreaker(idx: number) {
    setTiebreakers((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }
  function addTiebreaker(key: PoolPlayTiebreakerKey) {
    setTiebreakers((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }
  const availableTiebreakers = (Object.keys(TIEBREAKER_LABELS) as PoolPlayTiebreakerKey[]).filter(
    (k) => !tiebreakers.includes(k),
  );

  return (
    <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
      {/* Teams */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Teams ({teams.length})
          </Label>
          <Button size="sm" variant="ghost" onClick={addTeam} disabled={teams.length >= 16}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Team
          </Button>
        </div>
        <div className="space-y-1.5">
          {teams.map((t, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={t.name}
                onChange={(e) => updateTeam(idx, e.target.value)}
                className="h-8"
                maxLength={80}
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeTeam(idx)}
                title="Remove team"
                className="h-8 w-8 shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Settings */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Your team</Label>
          <Select value={ourTeam} onValueChange={setOurTeam}>
            <SelectTrigger className="h-8 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Advance from pool</Label>
          <Input
            type="number"
            min={1}
            max={8}
            value={advanceCount}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n >= 1 && n <= 8) setAdvanceCount(n);
            }}
            className="h-8 mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">Byes (top N)</Label>
          <Input
            type="number"
            min={0}
            max={advanceCount}
            value={byeCount}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n >= 0 && n <= 8) setByeCount(n);
            }}
            className="h-8 mt-1"
          />
        </div>
      </section>

      {/* Tiebreaker chain */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tiebreakers (in order)
          </Label>
        </div>
        <div className="space-y-1">
          {tiebreakers.map((key, idx) => (
            <div
              key={key}
              className="flex items-center gap-2 rounded-md border bg-muted/30 p-1.5"
            >
              <span className="font-mono text-[11px] text-muted-foreground w-5 text-center">
                {idx + 1}
              </span>
              <span className="text-sm flex-1">{TIEBREAKER_LABELS[key]}</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={idx === 0}
                onClick={() => moveTiebreaker(idx, -1)}
                title="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={idx === tiebreakers.length - 1}
                onClick={() => moveTiebreaker(idx, 1)}
                title="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={tiebreakers.length <= 1}
                onClick={() => removeTiebreaker(idx)}
                title="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        {availableTiebreakers.length > 0 && (
          <div className="mt-2">
            <Select
              value=""
              onValueChange={(v) => addTiebreaker(v as PoolPlayTiebreakerKey)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="+ Add tiebreaker…" />
              </SelectTrigger>
              <SelectContent>
                {availableTiebreakers.map((k) => (
                  <SelectItem key={k} value={k}>
                    {TIEBREAKER_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </section>

      {/* Games */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Games ({games.length})
          </Label>
          <Button size="sm" variant="ghost" onClick={addGame} disabled={games.length >= 64 || teams.length < 2}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Game
          </Button>
        </div>
        <div className="space-y-1.5">
          {games.map((g) => (
            <GameRow
              key={g.id}
              game={g}
              teams={teams}
              onChange={(patch) => updateGame(g.id, patch)}
              onRemove={() => removeGame(g.id)}
            />
          ))}
          {games.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-3">
              No games yet — tap "+ Game" to add the pool schedule.
            </div>
          )}
        </div>
      </section>

      {preview.tiebreakerNote && (
        <div className="text-[11px] text-muted-foreground italic">
          Tiebreaker note from screenshot: "{preview.tiebreakerNote}"
        </div>
      )}

      <DialogFooter className="gap-2">
        {showClear && (
          <Button
            variant="ghost"
            onClick={() => {
              if (confirm("Clear all pool-play data for this tournament?")) {
                clear.mutate({ id: tournamentId });
              }
            }}
            disabled={clear.isPending}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Clear
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FormatExtractDialog — upload a screenshot of the tournament's posted
// seeding/tiebreaker rules; AI returns {advanceCount?, byeCount?,
// tiebreakers?, teamCount?}; coach picks which fields to apply.
//
// If a pool already exists, applying merges into it. Otherwise it
// seeds a fresh pool stub (teams empty, coach fills in via Edit /
// Import screenshots next).
// ---------------------------------------------------------------------------

function FormatExtractDialog({
  tournamentId,
  existing,
  onClose,
  onSeedFormat,
}: {
  tournamentId: number;
  existing: PoolPlay | null;
  onClose: () => void;
  // Called when there's no existing pool yet — parent stashes the
  // extracted format and chains into the Import flow so the coach
  // can add teams next without losing the extracted values.
  onSeedFormat: (fmt: {
    advanceCount?: number;
    byeCount?: number;
    tiebreakers?: PoolPlayTiebreakerKey[];
  }) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [parsed, setParsed] = useState<ExtractedPoolPlayFormat | null>(null);
  // Per-field "apply this one" toggles — coach can opt out of any
  // single field the AI guessed wrong.
  const [applyAdvance, setApplyAdvance] = useState(true);
  const [applyBye, setApplyBye] = useState(true);
  const [applyTiebreakers, setApplyTiebreakers] = useState(true);

  const extract = useExtractTournamentPoolPlayFormat({
    mutation: {
      onSuccess: (data) => {
        setParsed(data);
        setApplyAdvance(data.advanceCount != null);
        setApplyBye(data.byeCount != null);
        setApplyTiebreakers(!!data.tiebreakers && data.tiebreakers.length > 0);
      },
      onError: (e) => {
        toast({
          title: "Couldn't read the rules screenshot",
          description: (e as Error)?.message ?? "Try a clearer photo or enter manually via Edit.",
          variant: "destructive",
        });
      },
    },
  });
  const save = useSaveTournamentPoolPlay({
    mutation: {
      onSuccess: () => {
        toast({ title: "Format applied" });
        qc.invalidateQueries({ queryKey: getGetTournamentQueryKey(tournamentId) });
        onClose();
      },
      onError: (e) => {
        toast({
          title: "Save failed",
          description: (e as Error)?.message ?? "Try again.",
          variant: "destructive",
        });
      },
    },
  });

  function onPickFiles(ev: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(ev.target.files ?? []);
    if (picked.length === 0) return;
    if (picked.length > 2) {
      toast({ title: "Pick at most 2 screenshots", variant: "destructive" });
      return;
    }
    setFiles(picked);
    extract.mutate({ id: tournamentId, data: { files: picked } });
  }

  function handleApply() {
    if (!parsed) return;
    const nextAdvance =
      applyAdvance && parsed.advanceCount != null
        ? parsed.advanceCount
        : (existing?.advanceCount ?? 2);
    const nextBye = (() => {
      const candidate =
        applyBye && parsed.byeCount != null
          ? parsed.byeCount
          : (existing?.byeCount ?? 0);
      // Clamp to advanceCount — server would reject otherwise.
      return Math.min(candidate, nextAdvance);
    })();
    const nextTbs: PoolPlayTiebreakerKey[] =
      applyTiebreakers && parsed.tiebreakers && parsed.tiebreakers.length > 0
        ? parsed.tiebreakers
        : (existing?.tiebreakers && existing.tiebreakers.length > 0
            ? existing.tiebreakers
            : ["winPct", "h2h", "runDiff"]);

    if (!existing) {
      // Server requires ≥2 teams, so we can't persist the format
      // alone. Hand the extracted format back to the parent so it
      // can stash + chain into the Import dialog with seedFormat
      // wired into PreviewEditor's defaults.
      toast({
        title: "Format saved — now add teams",
        description: "Upload pool screenshots or add teams to finish.",
      });
      onSeedFormat({
        advanceCount: applyAdvance ? (parsed.advanceCount ?? undefined) : undefined,
        byeCount: applyBye ? (parsed.byeCount ?? undefined) : undefined,
        tiebreakers:
          applyTiebreakers && parsed.tiebreakers && parsed.tiebreakers.length > 0
            ? parsed.tiebreakers
            : undefined,
      });
      return;
    }
    const body: PoolPlay = {
      ourTeamName: existing.ourTeamName,
      teams: existing.teams,
      // Drop synthetic real-* entries before saving — they get
      // re-derived on the next GET from the live `games` table.
      games: existing.games.filter((g) => !g.id.startsWith("real-")),
      tiebreakers: nextTbs,
      advanceCount: nextAdvance,
      byeCount: nextBye,
      updatedAt: new Date().toISOString(),
    };
    save.mutate({ id: tournamentId, data: body });
  }

  const isExtracting = extract.isPending;
  const anyParsed =
    parsed != null &&
    (parsed.advanceCount != null ||
      parsed.byeCount != null ||
      (parsed.tiebreakers && parsed.tiebreakers.length > 0) ||
      parsed.teamCount != null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Set format from rules photo</DialogTitle>
          <DialogDescription>
            Upload 1-2 photos of the tournament's posted seeding rules
            (how many advance, byes, tiebreaker order). The AI extracts
            just the format — review before applying.
          </DialogDescription>
        </DialogHeader>

        {!parsed ? (
          <div className="space-y-3 py-2">
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onPickFiles}
            />
            <div
              className="rounded-lg border border-dashed py-10 text-center cursor-pointer hover:bg-muted/40 transition"
              onClick={() => inputRef.current?.click()}
            >
              {isExtracting ? (
                <>
                  <Loader2 className="h-10 w-10 mx-auto animate-spin text-muted-foreground" />
                  <div className="text-sm text-muted-foreground mt-3">
                    Reading {files.length} {files.length === 1 ? "photo" : "photos"}…
                  </div>
                </>
              ) : (
                <>
                  <Camera className="h-10 w-10 mx-auto text-muted-foreground" />
                  <div className="mt-2 text-sm font-medium">Tap to choose photos</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    PNG, JPEG, or WebP. Up to 2 photos.
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {!anyParsed && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                We couldn't make out any format details from those photos.
                {parsed.notes ? (
                  <div className="mt-1 text-xs italic">"{parsed.notes}"</div>
                ) : null}
              </div>
            )}
            {parsed.advanceCount != null && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={applyAdvance}
                  onChange={(e) => setApplyAdvance(e.target.checked)}
                  className="h-4 w-4"
                />
                <span>
                  Top <strong>{parsed.advanceCount}</strong> advance
                </span>
              </label>
            )}
            {parsed.byeCount != null && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={applyBye}
                  onChange={(e) => setApplyBye(e.target.checked)}
                  className="h-4 w-4"
                />
                <span>
                  Top <strong>{parsed.byeCount}</strong>{" "}
                  {parsed.byeCount === 1 ? "team gets a bye" : "teams get byes"}
                </span>
              </label>
            )}
            {parsed.tiebreakers && parsed.tiebreakers.length > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={applyTiebreakers}
                  onChange={(e) => setApplyTiebreakers(e.target.checked)}
                  className="h-4 w-4 mt-0.5"
                />
                <span>
                  Tiebreakers:{" "}
                  <strong>{tiebreakerChainLabel(parsed.tiebreakers)}</strong>
                </span>
              </label>
            )}
            {parsed.teamCount != null && (
              <div className="text-xs text-muted-foreground">
                Photo mentions {parsed.teamCount} teams — add them via Import or Edit.
              </div>
            )}
            {parsed.notes && anyParsed && (
              <div className="text-[11px] text-muted-foreground italic">
                Note from photo: "{parsed.notes}"
              </div>
            )}
            {!existing && anyParsed && (
              <div className="rounded-md border border-purple-200 bg-purple-50 p-2.5 text-xs text-purple-900">
                You don't have any pool data yet. After applying the format,
                use "Import screenshots" or "Edit" to add your pool teams.
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {parsed && (
            <Button
              onClick={handleApply}
              disabled={!anyParsed || save.isPending}
            >
              {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {existing ? "Apply to pool play" : "Save format"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GameRow({
  game,
  teams,
  onChange,
  onRemove,
}: {
  game: PoolPlayGame;
  teams: { name: string }[];
  onChange: (patch: Partial<PoolPlayGame>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border p-1.5">
      <Select value={game.away} onValueChange={(v) => onChange({ away: v })}>
        <SelectTrigger className="h-7 text-xs w-[110px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {teams.map((t) => (
            <SelectItem key={t.name} value={t.name}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        min={0}
        max={99}
        value={game.awayScore ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") onChange({ awayScore: null });
          else {
            const n = parseInt(v, 10);
            if (Number.isFinite(n) && n >= 0 && n <= 99) onChange({ awayScore: n });
          }
        }}
        className="h-7 w-12 text-xs text-center font-mono px-1"
        placeholder="–"
        disabled={!game.final}
      />
      <span className="text-xs text-muted-foreground">@</span>
      <Input
        type="number"
        min={0}
        max={99}
        value={game.homeScore ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") onChange({ homeScore: null });
          else {
            const n = parseInt(v, 10);
            if (Number.isFinite(n) && n >= 0 && n <= 99) onChange({ homeScore: n });
          }
        }}
        className="h-7 w-12 text-xs text-center font-mono px-1"
        placeholder="–"
        disabled={!game.final}
      />
      <Select value={game.home} onValueChange={(v) => onChange({ home: v })}>
        <SelectTrigger className="h-7 text-xs w-[110px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {teams.map((t) => (
            <SelectItem key={t.name} value={t.name}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground select-none cursor-pointer ml-1">
        <input
          type="checkbox"
          checked={game.final}
          onChange={(e) => {
            const final = e.target.checked;
            if (final && (game.homeScore == null || game.awayScore == null)) {
              onChange({ final, homeScore: game.homeScore ?? 0, awayScore: game.awayScore ?? 0 });
            } else {
              onChange({ final });
            }
          }}
          className="h-3.5 w-3.5"
        />
        Final
      </label>
      <Input
        type="datetime-local"
        value={isoToLocalInput(game.scheduledAt)}
        onChange={(e) => onChange({ scheduledAt: localInputToIso(e.target.value) })}
        className="h-7 text-xs w-[160px] px-1.5 ml-1"
        title="Scheduled first pitch (optional)"
      />
      <div className="flex-1" />
      <Button size="icon" variant="ghost" onClick={onRemove} className="h-7 w-7 shrink-0">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
