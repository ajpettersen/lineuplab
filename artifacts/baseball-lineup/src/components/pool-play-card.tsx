import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useExtractTournamentPoolPlay,
  useSaveTournamentPoolPlay,
  useClearTournamentPoolPlay,
  getGetTournamentQueryKey,
  type PoolPlay,
  type PoolPlayAnalysis,
  type PoolPlayGame,
  type ExtractedPoolPlay,
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListChecks className="h-5 w-5 text-purple-600" />
          Pool Play Scenarios
        </CardTitle>
        <div className="flex gap-2">
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
          <EmptyState onImport={() => setImportOpen(true)} />
        ) : (
          <PoolPlayBody poolPlay={poolPlay} analysis={analysis} />
        )}
      </CardContent>

      {importOpen && (
        <ImportDialog
          tournamentId={tournamentId}
          existing={poolPlay}
          onClose={() => setImportOpen(false)}
        />
      )}
      {editOpen && poolPlay && (
        <EditDialog
          tournamentId={tournamentId}
          initial={poolPlay}
          onClose={() => setEditOpen(false)}
        />
      )}
    </Card>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground space-y-3">
      <ListChecks className="h-8 w-8 mx-auto opacity-50" />
      <div>
        Upload screenshots of the tournament's pool-play standings and schedule
        to project how the standings could finish.
      </div>
      <Button size="sm" onClick={onImport} className="mt-1">
        <UploadCloud className="h-4 w-4 mr-1.5" />
        Import screenshots
      </Button>
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
        Tiebreaker: {tiebreakerLabel(poolPlay.tiebreaker)} • Pool of{" "}
        {poolPlay.teams.length} teams • {analysis.remainingGames}{" "}
        {analysis.remainingGames === 1 ? "game" : "games"} remaining
      </div>
    </div>
  );
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

function tiebreakerLabel(t: PoolPlay["tiebreaker"]): string {
  switch (t) {
    case "winPct_runDiff_h2h":
      return "Win % → Run diff → H2H";
    case "winPct_h2h":
      return "Win % → Head-to-head";
    case "winPct_h2h_runDiff":
    default:
      return "Win % → Head-to-head → Run diff";
  }
}

// ---------------------------------------------------------------------------
// Import dialog: upload → preview → save
// ---------------------------------------------------------------------------

function ImportDialog({
  tournamentId,
  existing,
  onClose,
}: {
  tournamentId: number;
  existing: PoolPlay | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ExtractedPoolPlay | null>(null);

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
  const isExtracting = extract.isPending;

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
            Upload 1-3 screenshots of the standings or schedule. The AI will extract
            teams and games — you can edit before saving.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4 py-2">
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
  onClose,
  onSaved,
  showClear,
}: {
  tournamentId: number;
  preview: ExtractedPoolPlay;
  existing: PoolPlay | null;
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
  const [tiebreaker, setTiebreaker] = useState<PoolPlay["tiebreaker"]>(
    existing?.tiebreaker ?? "winPct_h2h_runDiff",
  );
  const [advanceCount, setAdvanceCount] = useState<number>(existing?.advanceCount ?? 2);

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
    const body: PoolPlay = {
      ourTeamName: ourTeam,
      teams: normalizedTeams,
      games: normalizedGames,
      tiebreaker,
      advanceCount,
      updatedAt: new Date().toISOString(),
    };
    save.mutate({ id: tournamentId, data: body });
  }

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
          <Label className="text-xs">Tiebreaker</Label>
          <Select
            value={tiebreaker}
            onValueChange={(v) => setTiebreaker(v as PoolPlay["tiebreaker"])}
          >
            <SelectTrigger className="h-8 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="winPct_h2h_runDiff">Win % → H2H → Run diff</SelectItem>
              <SelectItem value="winPct_runDiff_h2h">Win % → Run diff → H2H</SelectItem>
              <SelectItem value="winPct_h2h">Win % → H2H</SelectItem>
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
      <div className="flex-1" />
      <Button size="icon" variant="ghost" onClick={onRemove} className="h-7 w-7 shrink-0">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
