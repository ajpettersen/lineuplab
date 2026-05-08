import { useState } from "react";
import { Link } from "wouter";
import {
  useListPlayers,
  useCreatePlayer,
  useDeletePlayer,
  getListPlayersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { showUndoToast, restoreEntity } from "@/lib/undo-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UserPlus, Trash2, ChevronRight, CircleUser, Sparkles, Image as ImageIcon, Upload, X, AlertTriangle, Info, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permission";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const ALL_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ExtractedPlayer = {
  name: string;
  number: number | null;
  // Kept on the type so legacy AI extractor responses still parse, but the UI
  // no longer surfaces it — every position is implicitly playable. The server
  // merges any leftover values into preferredPositions on bulk-import.
  eligiblePositions: string[];
  preferredPositions: string[];
  canPitch: boolean;
  notes: string | null;
  include: boolean;
  // UI-only flag for "this name+number already exists on the roster". Drives
  // the inline badge in the preview table — must NOT leak into the notes
  // field that gets persisted to the player record.
  dup: boolean;
};

function ImportRosterDialog({
  open,
  onClose,
  existingPlayers,
}: {
  open: boolean;
  onClose: () => void;
  existingPlayers: ReadonlyArray<{ name: string; number?: number | null }>;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const existingKeys = new Set(
    existingPlayers.map((p) => `${p.name.trim().toLowerCase()}|${p.number ?? ""}`)
  );
  const isDuplicate = (name: string, number: number | null) =>
    existingKeys.has(`${name.trim().toLowerCase()}|${number ?? ""}`);
  const [mode, setMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedPlayer[] | null>(null);

  const reset = () => {
    setMode("text");
    setText("");
    setFile(null);
    setFilePreview(null);
    setExtracted(null);
    setExtracting(false);
    setSaving(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = (f: File | null) => {
    setFile(f);
    if (f && f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => setFilePreview(typeof reader.result === "string" ? reader.result : null);
      reader.readAsDataURL(f);
    } else {
      setFilePreview(null);
    }
  };

  const extract = async () => {
    setExtracting(true);
    try {
      let resp: Response;
      if (mode === "image") {
        if (!file) {
          toast({ title: "Please choose an image", variant: "destructive" });
          setExtracting(false);
          return;
        }
        const fd = new FormData();
        fd.append("file", file);
        resp = await fetch(`${BASE}/api/players/extract`, { method: "POST", body: fd });
      } else {
        if (!text.trim()) {
          toast({ title: "Please paste your roster", variant: "destructive" });
          setExtracting(false);
          return;
        }
        resp = await fetch(`${BASE}/api/players/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? "Extraction failed");
      }
      const { extracted: rows } = (await resp.json()) as {
        extracted: (Omit<ExtractedPlayer, "include" | "name"> & {
          name?: string;
          firstName?: string;
          lastName?: string;
        })[];
      };
      if (!rows || rows.length === 0) {
        toast({ title: "No players found in input", variant: "destructive" });
        setExtracting(false);
        return;
      }
      setExtracted(
        rows.map((r) => {
          // Prefer the new firstName/lastName fields from the AI extractor,
          // fall back to the old single-string `name` for older payloads.
          const name =
            r.firstName || r.lastName
              ? [r.firstName?.trim(), r.lastName?.trim()].filter(Boolean).join(" ")
              : (r.name ?? "");
          const number = r.number ?? null;
          const dup = isDuplicate(name, number);
          // The extractor used to return `eligiblePositions`; the new prompt
          // returns `preferredPositions` instead. Accept either for forward
          // and backward compatibility, treat both as "preferred".
          const positions = Array.isArray(r.preferredPositions)
            ? r.preferredPositions
            : Array.isArray(r.eligiblePositions)
              ? r.eligiblePositions
              : [];
          return {
            name,
            number,
            eligiblePositions: [],
            preferredPositions: positions,
            canPitch: !!r.canPitch,
            // Notes is the actual player.notes field that gets persisted.
            // Never stuff UI status here — that's what `dup` is for.
            notes: r.notes ?? null,
            // For duplicates we now MERGE the screenshot's preferred positions
            // into the existing player on the server (see /players/bulk).
            // Pre-include them so re-importing an updated roster picks up
            // the new positions automatically; the coach can still uncheck
            // individuals to skip.
            include: true,
            dup,
          };
        })
      );
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Extraction failed", variant: "destructive" });
    } finally {
      setExtracting(false);
    }
  };

  // Binary toggle on a position chip — on means "preferred". Eligibility
  // isn't a coach-managed concept anymore; every player can play anywhere.
  const togglePos = (idx: number, pos: string) => {
    setExtracted((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const cur = next[idx]!;
      const isPreferred = cur.preferredPositions.includes(pos);
      const preferred = isPreferred
        ? cur.preferredPositions.filter((p) => p !== pos)
        : [...cur.preferredPositions, pos];
      next[idx] = { ...cur, preferredPositions: preferred };
      return next;
    });
  };

  const setAllPositions = (idx: number, all: boolean) => {
    setExtracted((prev) =>
      prev
        ? prev.map((p, i) =>
            i === idx
              ? { ...p, preferredPositions: all ? [...ALL_POSITIONS] : [] }
              : p,
          )
        : prev,
    );
  };

  const updateRow = (idx: number, patch: Partial<ExtractedPlayer>) => {
    setExtracted((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch };
      return next;
    });
  };

  const importAll = async () => {
    if (!extracted) return;
    const toImport = extracted.filter((p) => p.include && p.name.trim());
    if (toImport.length === 0) {
      toast({ title: "No players selected to import", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch(`${BASE}/api/players/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          players: toImport.map((p) => ({
            name: p.name.trim(),
            number: p.number,
            // Server derives eligiblePositions from canPitch and merges any
            // leftover legacy values into preferred — we just send preferred.
            eligiblePositions: [],
            preferredPositions: p.preferredPositions,
            canPitch: p.canPitch,
            notes: p.notes,
          })),
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? "Import failed");
      }
      const { created = [], updated = [] } = (await resp.json()) as {
        created: unknown[];
        updated: unknown[];
        skipped?: { name: string; reason: string }[];
      };
      qc.invalidateQueries({ queryKey: getListPlayersQueryKey() });
      const parts: string[] = [];
      if (created.length > 0) {
        parts.push(`added ${created.length} new player${created.length === 1 ? "" : "s"}`);
      }
      if (updated.length > 0) {
        parts.push(
          `updated positions for ${updated.length} existing player${updated.length === 1 ? "" : "s"}`,
        );
      }
      const summary = parts.length > 0 ? parts.join(" · ") : "No changes";
      toast({
        title: summary.charAt(0).toUpperCase() + summary.slice(1),
      });
      handleClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Import failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const includedCount = extracted?.filter((p) => p.include).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Import Roster
          </DialogTitle>
          <DialogDescription>
            Paste your roster as text or upload a screenshot — we&apos;ll pull names, numbers, and positions for you to review.
          </DialogDescription>
        </DialogHeader>

        {!extracted ? (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "text" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("text")}
                data-testid="button-mode-text"
              >
                Paste Text
              </Button>
              <Button
                type="button"
                variant={mode === "image" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("image")}
                data-testid="button-mode-image"
              >
                <ImageIcon className="h-4 w-4 mr-1.5" />
                Upload Image
              </Button>
            </div>

            {mode === "text" ? (
              <div className="flex flex-col gap-1.5">
                <Label>Roster text</Label>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={`One player per line, e.g.:\n1 Smith, John P/SS\n23 Bobby Jones - 1B, 2B\n#7 Mike Davis OF\nAlex Lee #15 catcher`}
                  rows={10}
                  data-testid="input-import-text"
                />
                <p className="text-xs text-muted-foreground">
                  Most formats work — name, number, and positions in any order.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label>Roster image</Label>
                <label className="flex flex-col items-center justify-center gap-2 p-8 rounded-lg border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors">
                  {filePreview ? (
                    <img src={filePreview} alt="Roster preview" className="max-h-64 rounded-md" />
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {file ? file.name : "Click to upload a screenshot or photo"}
                      </span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                    data-testid="input-import-file"
                  />
                </label>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={extract} disabled={extracting} data-testid="button-extract">
                {extracting ? "Reading..." : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1.5" />
                    Extract with AI
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Found <span className="font-semibold text-foreground">{extracted.length}</span> player{extracted.length === 1 ? "" : "s"}. Review and adjust before importing.
              </p>
              <Button variant="outline" size="sm" onClick={() => setExtracted(null)}>
                Start over
              </Button>
            </div>

            <p className="text-xs text-muted-foreground -mb-1">
              Tap a position to mark it as a <span className="text-primary font-medium">preferred</span>{" "}
              spot — where this player ideally plays. Every player can play any
              position; preferred just biases the lineup generator.
            </p>

            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2 w-10"></th>
                    <th className="p-2">Name</th>
                    <th className="p-2 w-20">#</th>
                    <th className="p-2">Positions</th>
                    <th className="p-2 w-16 text-center">Pitch</th>
                    <th className="p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {extracted.map((row, i) => (
                    <tr key={i} className={`border-t ${row.include ? "" : "opacity-40"}`} data-testid={`row-extracted-${i}`}>
                      <td className="p-2 align-top">
                        <Checkbox
                          checked={row.include}
                          onCheckedChange={(v) => updateRow(i, { include: !!v })}
                          data-testid={`checkbox-include-${i}`}
                        />
                      </td>
                      <td className="p-2 align-top">
                        <Input
                          value={row.name}
                          onChange={(e) => updateRow(i, { name: e.target.value })}
                          className="h-8"
                          data-testid={`input-name-${i}`}
                        />
                        {row.dup && (
                          <span
                            className="inline-block mt-1 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                            data-testid={`badge-dup-${i}`}
                          >
                            Will update positions
                          </span>
                        )}
                        {row.notes && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{row.notes}</p>
                        )}
                      </td>
                      <td className="p-2 align-top">
                        <Input
                          type="number"
                          value={row.number ?? ""}
                          onChange={(e) =>
                            updateRow(i, {
                              number: e.target.value === "" ? null : parseInt(e.target.value),
                            })
                          }
                          className="h-8"
                          data-testid={`input-number-${i}`}
                        />
                      </td>
                      <td className="p-2 align-top">
                        <div className="flex flex-wrap items-center gap-1">
                          {(() => {
                            const allSelected =
                              row.preferredPositions.length === ALL_POSITIONS.length &&
                              ALL_POSITIONS.every((p) => row.preferredPositions.includes(p));
                            return (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setAllPositions(i, !allSelected)}
                                className="h-6 px-2 text-xs"
                                data-testid={`button-pos-all-${i}`}
                              >
                                {allSelected ? "Clear" : "All"}
                              </Button>
                            );
                          })()}
                          {ALL_POSITIONS.map((pos) => {
                            const preferred = row.preferredPositions.includes(pos);
                            return (
                              <button
                                key={pos}
                                type="button"
                                onClick={() => togglePos(i, pos)}
                                title={
                                  preferred
                                    ? `Click to remove ${pos} from preferred`
                                    : `Click to mark ${pos} as preferred`
                                }
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border transition-colors ${
                                  preferred
                                    ? "bg-primary text-primary-foreground border-primary ring-1 ring-primary/40"
                                    : "border-border text-muted-foreground hover:border-primary/50"
                                }`}
                                data-testid={`button-pos-${i}-${pos}`}
                                data-state={preferred ? "preferred" : "off"}
                              >
                                {preferred && <span aria-hidden>★</span>}
                                {pos}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="p-2 align-top text-center">
                        <Checkbox
                          checked={row.canPitch}
                          onCheckedChange={(v) => updateRow(i, { canPitch: !!v })}
                          data-testid={`checkbox-pitch-${i}`}
                        />
                      </td>
                      <td className="p-2 align-top">
                        <button
                          type="button"
                          onClick={() => setExtracted((prev) => prev?.filter((_, j) => j !== i) ?? null)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Remove row"
                          data-testid={`button-remove-${i}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={importAll} disabled={saving || includedCount === 0} data-testid="button-import">
                {saving ? "Importing..." : `Import ${includedCount} player${includedCount === 1 ? "" : "s"}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddPlayerDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const createPlayer = useCreatePlayer();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [number, setNumber] = useState("");
  const [preferred, setPreferred] = useState<string[]>([]);
  const [canPitch, setCanPitch] = useState(false);

  const togglePreferred = (pos: string) => {
    setPreferred((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]
    );
  };

  const handleSubmit = () => {
    const f = firstName.trim();
    const l = lastName.trim();
    if (!f) {
      toast({ title: "First name is required", variant: "destructive" });
      return;
    }
    if (!l) {
      toast({ title: "Last name is required", variant: "destructive" });
      return;
    }
    createPlayer.mutate(
      {
        data: {
          firstName: f,
          lastName: l,
          number: number ? parseInt(number) : null,
          // eligiblePositions is server-derived from canPitch — we send the
          // full list so the generated zod schema is satisfied; server overwrites it.
          eligiblePositions: ALL_POSITIONS,
          preferredPositions: preferred,
          canPitch,
          active: true,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPlayersQueryKey() });
          toast({ title: "Player added" });
          onClose();
          setFirstName("");
          setLastName("");
          setNumber("");
          setPreferred([]);
          setCanPitch(false);
        },
        onError: () => toast({ title: "Failed to add player", variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Player</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>First name</Label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Parker"
                data-testid="input-first-name"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Last name</Label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Handahl"
                data-testid="input-last-name"
              />
            </div>
            <div className="flex flex-col gap-1.5 w-20">
              <Label>Jersey #</Label>
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="—"
                type="number"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Both first and last names are required so box score imports can
            match GameChanger&apos;s &quot;F. Lastname&quot; format.
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Preferred Positions</Label>
              {(() => {
                const allSelected =
                  preferred.length === ALL_POSITIONS.length &&
                  ALL_POSITIONS.every((p) => preferred.includes(p));
                return (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() =>
                      setPreferred(allSelected ? [] : [...ALL_POSITIONS])
                    }
                    data-testid="button-preferred-toggle-all"
                  >
                    {allSelected ? "Clear all" : "Select all"}
                  </Button>
                );
              })()}
            </div>
            <p className="text-xs text-muted-foreground -mt-1">
              Tap positions this player likes or plays best. Optional — every
              player can play any position; this just biases the lineup
              generator.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {ALL_POSITIONS.map((pos) => (
                <label
                  key={pos}
                  className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer text-sm transition-colors ${
                    preferred.includes(pos)
                      ? "border-primary bg-primary/5 text-primary font-medium"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <Checkbox
                    checked={preferred.includes(pos)}
                    onCheckedChange={() => togglePreferred(pos)}
                  />
                  {pos}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="canPitch"
              checked={canPitch}
              onCheckedChange={(v) => setCanPitch(!!v)}
            />
            <Label htmlFor="canPitch">Can pitch</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createPlayer.isPending}>
            {createPlayer.isPending ? "Adding..." : "Add Player"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CoverageLevel = "uncovered" | "thin" | "covered";

function coverageLevel(count: number): CoverageLevel {
  if (count === 0) return "uncovered";
  if (count === 1) return "thin";
  return "covered";
}

const COVERAGE_STYLES: Record<
  CoverageLevel,
  { card: string; abbr: string; count: string; ring: string }
> = {
  uncovered: {
    card: "border-destructive/40 bg-destructive/10",
    abbr: "text-destructive",
    count: "text-destructive/90",
    ring: "ring-destructive/30",
  },
  thin: {
    card: "border-amber-500/40 bg-amber-500/10",
    abbr: "text-amber-500 dark:text-amber-400",
    count: "text-amber-600/90 dark:text-amber-300/90",
    ring: "ring-amber-500/30",
  },
  covered: {
    card: "border-emerald-500/40 bg-emerald-500/10",
    abbr: "text-emerald-600 dark:text-emerald-400",
    count: "text-emerald-700/90 dark:text-emerald-300/90",
    ring: "ring-emerald-500/30",
  },
};

const COVERAGE_TOOLTIP: Record<CoverageLevel, string> = {
  uncovered:
    "No one prefers this position. Consider training a player here.",
  thin: "Only one player prefers this position — no backup if they're absent.",
  covered: "Two or more players prefer this position.",
};

function PositionCoveragePanel({
  players,
}: {
  players: ReadonlyArray<{ preferredPositions: string[]; canPitch?: boolean }>;
}) {
  const coverage: Record<string, number> = Object.fromEntries(
    ALL_POSITIONS.map((p) => [p, 0]),
  );
  for (const player of players) {
    const positions = new Set(player.preferredPositions ?? []);
    // "Can pitch" flag is the source of truth for who can take the mound,
    // even if a coach hasn't added "P" to their preferred positions list.
    // Surface them in the P coverage tally so the depth indicator matches
    // who would actually be eligible to pitch.
    if (player.canPitch) positions.add("P");
    for (const pos of positions) {
      if (pos in coverage) coverage[pos]++;
    }
  }

  const problems = ALL_POSITIONS.filter((p) => (coverage[p] ?? 0) < 2);
  const allCovered = problems.length === 0;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base font-semibold">
            Position coverage
          </CardTitle>
          <div className="flex items-center gap-2 text-sm">
            {allCovered ? (
              <>
                <ShieldCheck className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                <span className="text-muted-foreground">
                  All positions covered
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                <span className="text-muted-foreground">
                  Needs depth at:{" "}
                  {problems.map((pos, i) => {
                    const level = coverageLevel(coverage[pos] ?? 0);
                    const styles = COVERAGE_STYLES[level];
                    return (
                      <span key={pos}>
                        <span
                          className={`font-semibold ${styles.abbr}`}
                          data-testid={`coverage-summary-${pos}`}
                        >
                          {pos}
                        </span>
                        {i < problems.length - 1 ? ", " : ""}
                      </span>
                    );
                  })}
                </span>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <TooltipProvider delayDuration={200}>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2">
            {ALL_POSITIONS.map((pos) => {
              const count = coverage[pos] ?? 0;
              const level = coverageLevel(count);
              const styles = COVERAGE_STYLES[level];
              return (
                <Tooltip key={pos}>
                  <TooltipTrigger asChild>
                    <div
                      className={`flex flex-col items-center justify-center rounded-md border px-2 py-2 transition-colors ${styles.card}`}
                      data-testid={`coverage-card-${pos}`}
                      data-level={level}
                    >
                      <div
                        className={`text-base font-bold leading-none ${styles.abbr}`}
                      >
                        {pos}
                      </div>
                      <div
                        className={`mt-1 text-xs font-medium ${styles.count} flex items-center gap-1`}
                      >
                        {level === "uncovered" && (
                          <AlertTriangle
                            className="h-3 w-3"
                            aria-hidden
                          />
                        )}
                        {level === "thin" && (
                          <Info className="h-3 w-3" aria-hidden />
                        )}
                        <span>
                          {pos} / {count}
                        </span>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {COVERAGE_TOOLTIP[level]}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}

export default function Players() {
  const { data: players = [], isLoading } = useListPlayers();
  const deletePlayer = useDeletePlayer();
  const qc = useQueryClient();
  const { toast } = useToast();
  // Roster mutations are head-coach-only ('full' tier). Assistant
  // coaches and view-only members can browse the roster but not add,
  // edit, or delete players. Server enforces independently.
  const { can } = usePermission();
  const canEditRoster = can("full");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const handleDelete = () => {
    if (!deleteId) return;
    const idToDelete = deleteId;
    deletePlayer.mutate(
      { id: idToDelete },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPlayersQueryKey() });
          showUndoToast(toast, {
            title: "Player removed",
            onUndo: async () => {
              try {
                await restoreEntity("players", idToDelete);
                qc.invalidateQueries({ queryKey: getListPlayersQueryKey() });
                toast({ title: "Player restored" });
              } catch {
                toast({ title: "Couldn't undo", variant: "destructive" });
              }
            },
          });
          setDeleteId(null);
        },
        onError: () => toast({ title: "Failed to delete player", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow text-primary/70">Team</div>
          <h1 className="page-title text-foreground mt-1">Roster</h1>
          <p className="text-muted-foreground mt-2 text-sm">{players.length} players</p>
        </div>
        {/* Add/import are roster mutations — hidden from non-full
            tiers. View-only and partial coaches can still browse the
            roster, just not edit it. */}
        {canEditRoster && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="button-open-import">
              <Sparkles className="h-4 w-4 mr-2" />
              Import Roster
            </Button>
            <Button onClick={() => setAddOpen(true)} data-testid="button-add-player">
              <UserPlus className="h-4 w-4 mr-2" />
              Add Player
            </Button>
          </div>
        )}
      </div>

      {!isLoading && players.length >= 1 && (
        <PositionCoveragePanel players={players} />
      )}

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : players.length === 0 ? (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-3 text-center">
            <CircleUser className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              {canEditRoster
                ? "No players yet. Add your first player to get started."
                : "No players on the roster yet. The head coach hasn't added anyone."}
            </p>
            {canEditRoster && (
              <Button onClick={() => setAddOpen(true)} data-testid="button-add-player-empty">
                <UserPlus className="h-4 w-4 mr-2" /> Add Player
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {players.map((p) => (
            <Card key={p.id} className="border-border hover:border-primary/30 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <Link href={`/players/${p.id}`}>
                    <div className="flex-1 cursor-pointer group">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground font-mono w-6">
                          {p.number != null ? `#${p.number}` : ""}
                        </span>
                        <span className="font-semibold group-hover:text-primary transition-colors">
                          {p.name}
                        </span>
                        {!p.active && (
                          <Badge variant="outline" className="text-xs">Inactive</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2 ml-8">
                        {p.preferredPositions.length > 0 ? (
                          p.preferredPositions.map((pos) => (
                            <Badge
                              key={pos}
                              variant="default"
                              className="text-xs px-1.5 py-0"
                            >
                              {pos}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            no preferred positions
                          </span>
                        )}
                        {p.canPitch && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 text-primary border-primary/40">
                            Pitcher
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1">
                    <Link href={`/players/${p.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    {canEditRoster && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(p.id)}
                        data-testid={`button-delete-player-${p.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddPlayerDialog open={addOpen} onClose={() => setAddOpen(false)} />

      <ImportRosterDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        existingPlayers={players}
      />

      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove player?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the player and all their lineup history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
