import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBoxScore,
  useExtractBoxScore,
  useSaveBoxScore,
  useDeleteBoxScore,
  useUpdateGame,
  getGetBoxScoreQueryKey,
  getGetGameQueryKey,
  getGetGameLineupQueryKey,
  getListGamesQueryKey,
  getGetSeasonStatsQueryKey,
  getGetPlayerStatsQueryKey,
  getGetGamePitchCountsQueryKey,
  type ExtractedBoxScore,
  type BattingLine,
  type PitchingLine,
  type Player,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { showUndoToast, postJson } from "@/lib/undo-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
import { Upload, Trash2, X, Plus, Sparkles, AlertCircle } from "lucide-react";
import { format } from "date-fns";

interface Props {
  gameId: number;
  /**
   * The game's currently scheduled innings count. Surfaced as the
   * default + max for the "Last inning played" picker on the preview
   * step. When the coach saves with a lower value we also patch the
   * game to shorten it (drops lineup entries / locks past that
   * inning) — replaces the standalone "Game Ended Early" dialog.
   */
  gameInnings: number;
  players: Player[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_FILES = 4;
const MAX_BYTES = 6 * 1024 * 1024;
const ACCEPTED = "image/png,image/jpeg,image/webp";

const ZERO_BATTING: BattingLine = {
  playerId: 0,
  ab: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  hr: 0,
  rbi: 0,
  bb: 0,
  k: 0,
  hbp: 0,
  sac: 0,
  sb: 0,
  runs: 0,
};

type EditableBatting = BattingLine & { _key: string };
type EditablePitching = PitchingLine & { _key: string };

let _kid = 0;
const newKey = () => `r${++_kid}`;

/**
 * Box-score import flow:
 *
 *   1. Coach uploads 1–4 phone screenshots of a scorebook.
 *   2. AI extracts batting + pitching lines + final score, returns a
 *      preview the coach can edit (player matches, typo fixes, add/remove).
 *   3. "Save" replaces all per-game batting lines for this game and
 *      upserts pitch counts, so re-importing is idempotent — totals
 *      never double-count.
 *
 * The dialog also supports re-opening on an already-imported game:
 * we hydrate the editable preview from the saved state (no AI call
 * needed) and let the coach tweak + re-save, or "Remove import" to
 * wipe the per-game lines.
 */
export function BoxScoreImportDialog({
  gameId,
  gameInnings,
  players,
  open,
  onOpenChange,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateGame = useUpdateGame();

  const { data: state, isLoading: stateLoading } = useGetBoxScore(gameId, {
    query: {
      queryKey: getGetBoxScoreQueryKey(gameId),
      enabled: open,
    },
  });

  const extract = useExtractBoxScore();
  const save = useSaveBoxScore();
  const remove = useDeleteBoxScore();

  type Step = "upload" | "preview";
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [batting, setBatting] = useState<EditableBatting[]>([]);
  const [pitching, setPitching] = useState<EditablePitching[]>([]);
  const [ourScore, setOurScore] = useState<string>("");
  const [opponentScore, setOpponentScore] = useState<string>("");
  // "Last inning actually played" — defaults to the full scheduled
  // length. Picking a smaller number shortens the game on save
  // (replaces the old standalone "Game Ended Early" flow).
  const [lastInning, setLastInning] = useState<number>(gameInnings);
  // Object-storage paths for the screenshots attached to this import.
  // Either hydrated from the saved state (re-opening an already-imported
  // game) or returned by /extract after a fresh upload. Sent back on
  // /save so the originals stay attached to the game.
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // When the dialog opens, hydrate from saved state if it exists. If
  // there's no prior import we land on the upload step; otherwise we
  // jump straight into the editable preview so the coach can tweak.
  useEffect(() => {
    if (!open) return;
    if (stateLoading) return;
    if (state && Array.isArray(state.batting) && state.batting.length > 0) {
      setBatting(
        state.batting.map((b) => ({
          ...ZERO_BATTING,
          playerId: b.playerId,
          ab: b.ab ?? 0,
          hits: b.hits ?? 0,
          doubles: b.doubles ?? 0,
          triples: b.triples ?? 0,
          hr: b.hr ?? 0,
          rbi: b.rbi ?? 0,
          bb: b.bb ?? 0,
          k: b.k ?? 0,
          hbp: b.hbp ?? 0,
          sac: b.sac ?? 0,
          sb: b.sb ?? 0,
          runs: b.runs ?? 0,
          _key: newKey(),
        })),
      );
      setPitching(
        (state.pitching ?? []).map((p) => ({
          playerId: p.playerId,
          pitches: p.pitches ?? 0,
          notes: p.notes ?? null,
          _key: newKey(),
        })),
      );
      setOurScore(state.ourScore != null ? String(state.ourScore) : "");
      setOpponentScore(state.opponentScore != null ? String(state.opponentScore) : "");
      setImagePaths(state.imagePaths ?? []);
      setStep("preview");
    } else {
      setBatting([]);
      setPitching([]);
      setOurScore("");
      setOpponentScore("");
      setImagePaths(state?.imagePaths ?? []);
      setStep("upload");
    }
    setFiles([]);
    setLightboxIdx(null);
    // Reset the last-inning picker to the game's full length each
    // time the dialog opens — coaches who mark a game complete
    // shouldn't accidentally inherit a prior shortening.
    setLastInning(gameInnings);
  }, [open, stateLoading, state, gameInnings]);

  const playersById = useMemo(() => {
    const m = new Map<number, Player>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  );

  const pitchers = useMemo(
    () => sortedPlayers.filter((p) => p.canPitch || p.active),
    [sortedPlayers],
  );

  const onPickFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const next = [...files];
    for (let i = 0; i < incoming.length; i++) {
      const f = incoming.item(i);
      if (!f) continue;
      if (next.length >= MAX_FILES) {
        toast({
          title: `You can upload at most ${MAX_FILES} images.`,
          variant: "destructive",
        });
        break;
      }
      if (f.size > MAX_BYTES) {
        toast({
          title: `${f.name} is too large (6 MB max).`,
          variant: "destructive",
        });
        continue;
      }
      next.push(f);
    }
    setFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const runExtract = async () => {
    if (files.length === 0) {
      toast({ title: "Add at least one image", variant: "destructive" });
      return;
    }
    try {
      const result: ExtractedBoxScore = await extract.mutateAsync({
        id: gameId,
        data: { files },
      });
      setBatting(
        (result.batting ?? []).map((b) => ({
          ...ZERO_BATTING,
          ...b,
          _key: newKey(),
        })),
      );
      setPitching(
        (result.pitching ?? []).map((p) => ({
          playerId: p.playerId,
          pitches: p.pitches ?? 0,
          notes: p.notes ?? null,
          _key: newKey(),
        })),
      );
      setOurScore(result.ourScore != null ? String(result.ourScore) : "");
      setOpponentScore(
        result.opponentScore != null ? String(result.opponentScore) : "",
      );
      setImagePaths(result.imagePaths ?? []);
      setStep("preview");
      toast({
        title: `Extracted ${result.batting.length} batting line(s)`,
        description:
          result.pitching.length > 0
            ? `${result.pitching.length} pitcher(s) detected. Edit anything below before saving.`
            : "No pitch counts detected. You can add them manually before saving.",
      });
    } catch (err) {
      toast({
        title: "AI extraction failed",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    }
  };

  const updateBatting = (
    key: string,
    field: keyof BattingLine,
    value: number,
  ) => {
    setBatting((prev) =>
      prev.map((r) => (r._key === key ? { ...r, [field]: value } : r)),
    );
  };

  const updatePitching = (key: string, field: "playerId" | "pitches", value: number) => {
    setPitching((prev) =>
      prev.map((r) => (r._key === key ? { ...r, [field]: value } : r)),
    );
  };

  const removeBattingRow = (key: string) =>
    setBatting((prev) => prev.filter((r) => r._key !== key));
  const removePitchingRow = (key: string) =>
    setPitching((prev) => prev.filter((r) => r._key !== key));

  const addBattingRow = () => {
    setBatting((prev) => [...prev, { ...ZERO_BATTING, _key: newKey() }]);
  };
  const addPitchingRow = () => {
    const firstPitcher = pitchers[0]?.id ?? sortedPlayers[0]?.id ?? 0;
    setPitching((prev) => [
      ...prev,
      { playerId: firstPitcher, pitches: 0, notes: null, _key: newKey() },
    ]);
  };

  const saveAll = async () => {
    // Drop incomplete rows. A row with playerId=0 is one the AI couldn't
    // match and the coach hasn't picked yet — saving it would 400.
    const validBatting = batting.filter((r) => r.playerId > 0);
    const validPitching = pitching.filter((r) => r.playerId > 0 && r.pitches > 0);
    if (validBatting.some((r) => !playersById.has(r.playerId))) {
      toast({
        title: "One or more rows are missing a player",
        description: "Pick a roster player for every batting row.",
        variant: "destructive",
      });
      return;
    }
    try {
      // Cap "last inning played" at >=1 and <= existing game length
      // (UI enforces, but defend-in-depth).
      const trimmedLast = Math.max(
        1,
        Math.min(gameInnings, Math.floor(lastInning) || gameInnings),
      );
      // 1. Save the box score FIRST. If this fails we abort before
      //    touching game.innings — shortening the game cascades into
      //    destructive trims of lineup entries, locks, and AI pins,
      //    which we don't want to apply unless the box score is
      //    actually persisted.
      await save.mutateAsync({
        id: gameId,
        data: {
          batting: validBatting.map(({ _key, ...rest }) => rest),
          pitching: validPitching.map(({ _key, ...rest }) => rest),
          ourScore: ourScore.trim() === "" ? null : Number(ourScore),
          opponentScore: opponentScore.trim() === "" ? null : Number(opponentScore),
          imagePaths,
          markCompleted: true,
        },
      });
      // 2. Now (best-effort) shorten the game. If this fails the box
      //    score is still saved; the coach can re-edit innings from
      //    the game card. We surface the error in a toast below.
      let trimError: unknown = null;
      if (trimmedLast < gameInnings) {
        try {
          await updateGame.mutateAsync({
            id: gameId,
            data: { innings: trimmedLast },
          });
        } catch (err) {
          trimError = err;
        }
      }
      // Invalidate everything that depends on per-game stats / scores.
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetBoxScoreQueryKey(gameId) }),
        qc.invalidateQueries({ queryKey: getGetGameQueryKey(gameId) }),
        qc.invalidateQueries({ queryKey: getGetGameLineupQueryKey(gameId) }),
        qc.invalidateQueries({ queryKey: getListGamesQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetGamePitchCountsQueryKey(gameId) }),
        qc.invalidateQueries({ queryKey: ["/api/batting"] }),
      ]);
      toast({
        title: "Box score saved",
        description: `${validBatting.length} batting line(s), ${validPitching.length} pitcher(s).${
          trimmedLast < gameInnings && !trimError
            ? ` Game shortened to ${trimmedLast} inning${trimmedLast === 1 ? "" : "s"}.`
            : ""
        }`,
      });
      if (trimError) {
        toast({
          title: "Couldn't shorten the game",
          description:
            trimError instanceof Error
              ? trimError.message
              : "The box score saved, but updating the inning count failed. Edit it from the game card.",
          variant: "destructive",
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    }
  };

  const onRemoveImport = async () => {
    if (!confirm("Remove this game's imported box score? Pitch counts and the final score are kept.")) return;
    try {
      // The DELETE endpoint returns the snapshot (lines + pitch
      // counts + scores + import flag) so we can hand it back to
      // the matching /restore endpoint if the coach taps Undo.
      // Bypass the generated mutation here because it ignores the
      // body — we need to capture the snapshot ourselves.
      const resp = await fetch(`${BASE}/api/games/${gameId}/box-score`, {
        method: "DELETE",
      });
      if (!resp.ok) throw new Error(`${resp.status}`);
      const snapshot = await resp.json();
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetBoxScoreQueryKey(gameId) }),
        qc.invalidateQueries({ queryKey: getGetGameQueryKey(gameId) }),
        qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetGamePitchCountsQueryKey(gameId) }),
        qc.invalidateQueries({ queryKey: ["/api/batting"] }),
      ]);
      showUndoToast(toast, {
        title: "Box score removed",
        onUndo: async () => {
          try {
            await postJson(`/api/games/${gameId}/box-score/restore`, snapshot);
            await Promise.all([
              qc.invalidateQueries({ queryKey: getGetBoxScoreQueryKey(gameId) }),
              qc.invalidateQueries({ queryKey: getGetGameQueryKey(gameId) }),
              qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() }),
              qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() }),
              qc.invalidateQueries({ queryKey: getGetGamePitchCountsQueryKey(gameId) }),
              qc.invalidateQueries({ queryKey: ["/api/batting"] }),
            ]);
            toast({ title: "Box score restored" });
          } catch {
            toast({ title: "Couldn't undo", variant: "destructive" });
          }
        },
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Failed to remove",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    }
  };

  const importedAt = state?.importedAt ? new Date(state.importedAt) : null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[calc(100vw-1rem)] max-h-[95vh] sm:max-h-[90vh] overflow-y-auto p-3 sm:p-6">
        <DialogHeader>
          <DialogTitle>Import box score</DialogTitle>
          <DialogDescription>
            Upload phone screenshots of your scorebook (GameChanger or any). The
            AI will pull out batting and pitching lines for you to review before
            saving.
          </DialogDescription>
        </DialogHeader>

        {importedAt && (
          <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 text-amber-700 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-amber-900">
                Already imported on {format(importedAt, "MMM d, yyyy 'at' h:mm a")}.
                Saving will replace the prior batting lines for this game (no
                double-counting).
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemoveImport}
              disabled={remove.isPending}
              className="text-amber-900 hover:text-amber-950"
            >
              Remove import
            </Button>
          </div>
        )}

        {step === "upload" && (
          <div className="space-y-4">
            <div className="rounded-md border-2 border-dashed border-muted-foreground/30 p-6 text-center">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                PNG, JPEG, WebP, or PDF — up to 4 files, 6 MB each.
              </p>
              <Input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED}
                multiple
                onChange={(e) => onPickFiles(e.target.files)}
                className="max-w-sm mx-auto"
              />
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded border p-2 text-sm"
                  >
                    <span className="truncate">
                      {f.name}{" "}
                      <span className="text-muted-foreground">
                        ({(f.size / 1024 / 1024).toFixed(2)} MB)
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Escape hatch — coach has no screenshots and just wants
                to record the final score (and optionally shorten the
                game). Jumps to the editable preview with no AI call;
                they can still add batting/pitching rows by hand. */}
            <p className="text-center text-xs text-muted-foreground">
              No screenshots?{" "}
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => {
                  setBatting([]);
                  setPitching([]);
                  setStep("preview");
                }}
                data-testid="button-skip-screenshots"
              >
                Enter the score manually
              </button>
              .
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={runExtract}
                disabled={files.length === 0 || extract.isPending}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {extract.isPending ? "Reading…" : "Extract with AI"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-6">
            {imagePaths.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">Your screenshots</h3>
                  <span className="text-xs text-muted-foreground">
                    Tap an image to view full size
                  </span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {imagePaths.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setLightboxIdx(i)}
                      className="relative shrink-0 rounded border bg-muted hover:ring-2 hover:ring-primary focus:outline-none focus:ring-2 focus:ring-primary"
                      title={`Screenshot ${i + 1}`}
                    >
                      <img
                        src={`${BASE}/api/games/${gameId}/box-score/images/${i}`}
                        alt={`Box score screenshot ${i + 1}`}
                        className="h-32 w-auto rounded object-contain bg-background"
                        loading="lazy"
                      />
                      <span className="absolute bottom-1 right-1 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium">
                        {i + 1}/{imagePaths.length}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="grid grid-cols-2 gap-4 rounded border p-3 bg-muted/40">
              <div>
                <Label className="text-xs">Our score</Label>
                <Input
                  type="number"
                  min={0}
                  value={ourScore}
                  onChange={(e) => setOurScore(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Opponent score</Label>
                <Input
                  type="number"
                  min={0}
                  value={opponentScore}
                  onChange={(e) => setOpponentScore(e.target.value)}
                  className="mt-1"
                />
              </div>
              {/* Game-ended-early picker — replaces the old standalone
                  "Game Ended Early" button. Default = full scheduled
                  length; pick lower to shorten on save. Only shown
                  when shortening is actually possible (innings > 1). */}
              {gameInnings > 1 && (
                <div className="col-span-2">
                  <Label className="text-xs">Last inning played</Label>
                  <Select
                    value={String(lastInning)}
                    onValueChange={(v) => setLastInning(Number(v))}
                  >
                    <SelectTrigger className="mt-1" data-testid="select-last-inning-played">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: gameInnings }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          Inning {n}
                          {n === gameInnings ? " (full game)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {lastInning < gameInnings && (
                    <p className="mt-1 text-xs text-amber-700">
                      Saving will shorten this game from {gameInnings} to {lastInning} inning
                      {lastInning === 1 ? "" : "s"} — entries past inning {lastInning} will be removed.
                    </p>
                  )}
                </div>
              )}
            </div>

            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">Batting</h3>
                <Button variant="outline" size="sm" onClick={addBattingRow}>
                  <Plus className="h-3 w-3 mr-1" /> Add row
                </Button>
              </div>
              {batting.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No batting lines. Add one or upload more images.
                </p>
              ) : (
                <>
                {/*
                 * Mobile (<sm): stacked card per batter with a 4-col
                 * grid of compact stat inputs — the 12-column desktop
                 * table doesn't fit on a phone even with horizontal
                 * scroll, since each cell needs a tap-target.
                 */}
                <div className="space-y-2 sm:hidden">
                  {batting.map((r) => (
                    <div
                      key={r._key}
                      className="rounded border bg-background p-2 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <Select
                          value={r.playerId > 0 ? String(r.playerId) : ""}
                          onValueChange={(v) =>
                            updateBatting(r._key, "playerId", Number(v))
                          }
                        >
                          <SelectTrigger className="h-9 flex-1">
                            <SelectValue placeholder="Pick player" />
                          </SelectTrigger>
                          <SelectContent>
                            {sortedPlayers.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}
                                {p.number != null ? ` #${p.number}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeBattingRow(r._key)}
                          aria-label="Remove batter"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(
                          [
                            ["ab", "AB"],
                            ["runs", "R"],
                            ["hits", "H"],
                            ["rbi", "RBI"],
                            ["doubles", "2B"],
                            ["triples", "3B"],
                            ["hr", "HR"],
                            ["bb", "BB"],
                            ["k", "K"],
                            ["hbp", "HBP"],
                            ["sac", "SAC"],
                            ["sb", "SB"],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="block">
                            <span className="block text-[10px] uppercase text-muted-foreground text-center">
                              {label}
                            </span>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={r[key] ?? 0}
                              onChange={(e) =>
                                updateBatting(
                                  r._key,
                                  key,
                                  Math.max(0, Number(e.target.value) || 0),
                                )
                              }
                              className="h-9 text-center px-1"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop (sm+): full 12-column table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-muted/60 text-xs">
                        <th className="text-left p-1 min-w-[160px]">Player</th>
                        {(
                          [
                            "ab",
                            "runs",
                            "hits",
                            "doubles",
                            "triples",
                            "hr",
                            "rbi",
                            "bb",
                            "k",
                            "hbp",
                            "sac",
                            "sb",
                          ] as const
                        ).map((c) => (
                          <th key={c} className="p-1 text-center w-14 uppercase">
                            {c === "doubles"
                              ? "2B"
                              : c === "triples"
                                ? "3B"
                                : c === "hits"
                                  ? "H"
                                  : c}
                          </th>
                        ))}
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {batting.map((r) => (
                        <tr key={r._key} className="border-b">
                          <td className="p-1">
                            <Select
                              value={r.playerId > 0 ? String(r.playerId) : ""}
                              onValueChange={(v) =>
                                updateBatting(r._key, "playerId", Number(v))
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Pick player" />
                              </SelectTrigger>
                              <SelectContent>
                                {sortedPlayers.map((p) => (
                                  <SelectItem key={p.id} value={String(p.id)}>
                                    {p.name}
                                    {p.number != null ? ` #${p.number}` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          {(
                            [
                              "ab",
                              "runs",
                              "hits",
                              "doubles",
                              "triples",
                              "hr",
                              "rbi",
                              "bb",
                              "k",
                              "hbp",
                              "sac",
                              "sb",
                            ] as const
                          ).map((c) => (
                            <td key={c} className="p-1 text-center">
                              <Input
                                type="number"
                                min={0}
                                value={r[c] ?? 0}
                                onChange={(e) =>
                                  updateBatting(
                                    r._key,
                                    c,
                                    Math.max(0, Number(e.target.value) || 0),
                                  )
                                }
                                className="h-8 w-14 text-center px-1"
                              />
                            </td>
                          ))}
                          <td className="p-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeBattingRow(r._key)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">Pitching</h3>
                <Button variant="outline" size="sm" onClick={addPitchingRow}>
                  <Plus className="h-3 w-3 mr-1" /> Add pitcher
                </Button>
              </div>
              {pitching.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No pitch counts. Add one or skip.
                </p>
              ) : (
                <div className="space-y-2">
                  {pitching.map((r) => (
                    <div
                      key={r._key}
                      className="flex items-center gap-2 rounded border p-2"
                    >
                      <Select
                        value={r.playerId > 0 ? String(r.playerId) : ""}
                        onValueChange={(v) =>
                          updatePitching(r._key, "playerId", Number(v))
                        }
                      >
                        <SelectTrigger className="h-9 flex-1">
                          <SelectValue placeholder="Pick pitcher" />
                        </SelectTrigger>
                        <SelectContent>
                          {sortedPlayers.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.name}
                              {p.number != null ? ` #${p.number}` : ""}
                              {p.canPitch ? "" : " (not flagged P)"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div>
                        <Label className="text-xs">Pitches</Label>
                        <Input
                          type="number"
                          min={0}
                          value={r.pitches ?? 0}
                          onChange={(e) =>
                            updatePitching(
                              r._key,
                              "pitches",
                              Math.max(0, Number(e.target.value) || 0),
                            )
                          }
                          className="h-9 w-24 text-center"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removePitchingRow(r._key)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <DialogFooter className="flex flex-wrap gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="ghost"
                onClick={() => {
                  setStep("upload");
                  setFiles([]);
                }}
              >
                Re-upload screenshots
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={saveAll} disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save box score"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
      {/*
       * Lightbox — click a screenshot thumbnail to view it full size.
       * Closes on backdrop tap or Escape (handled by Dialog's default).
       */}
      {lightboxIdx != null && imagePaths[lightboxIdx] && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setLightboxIdx(null);
          }}
        >
          <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto p-2">
            <DialogHeader className="sr-only">
              <DialogTitle>Box-score screenshot {lightboxIdx + 1}</DialogTitle>
            </DialogHeader>
            <img
              src={`${BASE}/api/games/${gameId}/box-score/images/${lightboxIdx}`}
              alt={`Box score screenshot ${lightboxIdx + 1}`}
              className="w-full h-auto rounded"
            />
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
