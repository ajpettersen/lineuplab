import { useMemo, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  useGetGame,
  useGetGameLineup,
  useGenerateLineup,
  useSaveLineup,
  useUpdateGame,
  useListPlayers,
  getGetGameQueryKey,
  getGetGameLineupQueryKey,
  getListGamesQueryKey,
  getGetSeasonStatsQueryKey,
  getGetPlayerStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Wand2, Save, Trophy, CalendarDays, MapPin, ClipboardCopy, X, Sparkles, Copy as CopyIcon, History, Image as ImageIcon, Upload } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const FIELD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const INFIELD = new Set(["C", "1B", "2B", "3B", "SS"]);
const OUTFIELD = new Set(["LF", "CF", "RF"]);
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Category = "Pitching" | "Infield" | "Outfield" | "Bench";
function categoryFor(pos: string): Category {
  if (pos === "P") return "Pitching";
  if (INFIELD.has(pos)) return "Infield";
  if (OUTFIELD.has(pos)) return "Outfield";
  return "Bench";
}

function positionColor(pos: string) {
  // Refined palette: each position keeps a distinct hue (so coaches can scan
  // a column at a glance) but all sit at a similar saturation/lightness so
  // the grid feels harmonious instead of rainbow-y.
  const colors: Record<string, string> = {
    P: "bg-red-50 text-red-800 border border-red-200/70",
    C: "bg-orange-50 text-orange-800 border border-orange-200/70",
    "1B": "bg-amber-50 text-amber-800 border border-amber-200/70",
    "2B": "bg-lime-50 text-lime-800 border border-lime-200/70",
    "3B": "bg-emerald-50 text-emerald-800 border border-emerald-200/70",
    SS: "bg-cyan-50 text-cyan-800 border border-cyan-200/70",
    LF: "bg-sky-50 text-sky-800 border border-sky-200/70",
    CF: "bg-indigo-50 text-indigo-800 border border-indigo-200/70",
    RF: "bg-violet-50 text-violet-800 border border-violet-200/70",
    Bench: "bg-slate-100 text-slate-600 border border-slate-200/70",
  };
  return colors[pos] ?? "bg-muted text-muted-foreground border border-border";
}

export default function GameDetail() {
  const [, params] = useRoute("/games/:id");
  const id = parseInt(params?.id ?? "0");
  const { data: game, isLoading: gameLoading } = useGetGame(id, {
    query: { enabled: !!id, queryKey: getGetGameQueryKey(id) },
  });
  const { data: lineup = [], isLoading: lineupLoading } = useGetGameLineup(id, {
    query: { enabled: !!id, queryKey: getGetGameLineupQueryKey(id) },
  });
  const { data: players = [] } = useListPlayers();
  const generateLineup = useGenerateLineup();
  const saveLineup = useSaveLineup();
  const updateGame = useUpdateGame();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<number[]>([]);
  const [previewLineup, setPreviewLineup] = useState<typeof lineup | null>(null);
  // "Copy from previous game" picker state.
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyGames, setCopyGames] = useState<Array<{
    id: number;
    opponent: string;
    gameDate: string;
    innings: number;
    status: string;
    entryCount: number;
  }> | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyApplyingId, setCopyApplyingId] = useState<number | null>(null);
  // "From Screenshot" upload-and-extract state.
  const [imageOpen, setImageOpen] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageExtracting, setImageExtracting] = useState(false);
  // Edits to a saved lineup (ad-hoc position swaps) live here until saved.
  const [editedLineup, setEditedLineup] = useState<typeof lineup | null>(null);
  // Click-to-swap selection: the entry id of the player picked first.
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [ourScore, setOurScore] = useState("");
  const [opponentScore, setOpponentScore] = useState("");
  // Drag-and-drop state: which entry is currently being dragged + its inning,
  // so droppable cells in the same inning can highlight as valid drop targets.
  const [activeDrag, setActiveDrag] = useState<{ entryId: number; inning: number } | null>(null);

  // AI Assistant search bar state.
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  // Monotonically-increasing request id so a stale response from an earlier
  // submission can't clobber the state set by a newer one.
  const aiRequestIdRef = useRef(0);
  const sensors = useSensors(
    // Distance constraint lets a click pass through to the underlying button
    // (so tap-to-select still works) while a small movement triggers a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Touch needs a hold delay so the page can still scroll vertically.
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const openGenerate = () => {
    setSelectedPlayerIds(players.filter((p) => p.active).map((p) => p.id));
    setPreviewLineup(null);
    setGenerateOpen(true);
  };

  const openCopy = async () => {
    if (editedLineup || previewLineup) {
      const what = editedLineup ? "unsaved lineup edits" : "an unsaved lineup preview";
      const ok = window.confirm(
        `You have ${what}. Loading a previous lineup will replace them. Continue?`,
      );
      if (!ok) return;
      setEditedLineup(null);
      setPreviewLineup(null);
      setSelectedEntryId(null);
    }
    setCopyOpen(true);
    setCopyLoading(true);
    setCopyGames(null);
    try {
      const resp = await fetch(`${BASE}/api/games/with-lineups`);
      if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
      const data = await resp.json();
      // Exclude the current game — copying from yourself is meaningless.
      setCopyGames(data.filter((g: { id: number }) => g.id !== id));
    } catch {
      toast({ title: "Failed to load past games", variant: "destructive" });
      setCopyOpen(false);
    } finally {
      setCopyLoading(false);
    }
  };

  const applyCopyFrom = async (sourceGameId: number) => {
    if (!game) return;
    setCopyApplyingId(sourceGameId);
    try {
      const resp = await fetch(`${BASE}/api/games/${sourceGameId}/lineup`);
      if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
      const sourceEntries: typeof lineup = await resp.json();

      // Only keep entries for players who still exist AND are active in the
      // current roster. The lineup grid otherwise filters them out and we'd
      // end up with a misleading empty-looking preview.
      const activeIds = new Set(players.filter((p) => p.active).map((p) => p.id));
      const droppedPlayers = new Set<string>();
      const kept = sourceEntries.filter((e) => {
        if (activeIds.has(e.playerId)) return true;
        droppedPlayers.add(e.playerName);
        return false;
      });

      // Truncate or stretch innings to match the current game.
      const trimmed = kept.filter((e) => e.inning <= game.innings);
      const sourceInnings = sourceEntries.reduce((m, e) => Math.max(m, e.inning), 0);
      const stretched: typeof lineup = trimmed.map((e, idx) => ({
        ...e,
        id: -(idx + 1), // negative ids mark this as an unsaved preview
        gameId: id,
      }));

      setPreviewLineup(stretched);
      setCopyOpen(false);
      const warnings: string[] = [];
      if (droppedPlayers.size > 0) {
        warnings.push(
          `${droppedPlayers.size} player${droppedPlayers.size === 1 ? "" : "s"} not on current roster were dropped`,
        );
      }
      if (sourceInnings > game.innings) {
        warnings.push(`only first ${game.innings} innings copied (source had ${sourceInnings})`);
      } else if (sourceInnings < game.innings) {
        warnings.push(`source had ${sourceInnings} innings — innings ${sourceInnings + 1}–${game.innings} are empty`);
      }
      toast({
        title: "Lineup loaded — review and save",
        description: warnings.join(". ") || undefined,
      });
    } catch {
      toast({ title: "Failed to load that lineup", variant: "destructive" });
    } finally {
      setCopyApplyingId(null);
    }
  };

  const resetImageState = () => {
    setImageDataUrl(null);
    setImageMime(null);
    setImageBase64(null);
    setImageFileName(null);
    setImageError(null);
  };

  const openImage = () => {
    if (editedLineup || previewLineup) {
      const what = editedLineup ? "unsaved lineup edits" : "an unsaved lineup preview";
      const ok = window.confirm(
        `You have ${what}. Importing from a screenshot will replace them. Continue?`,
      );
      if (!ok) return;
      setEditedLineup(null);
      setPreviewLineup(null);
      setSelectedEntryId(null);
    }
    resetImageState();
    setImageOpen(true);
  };

  // Read a File into a base64 data URL we can preview AND ship to the server.
  const ingestImageFile = (file: File) => {
    setImageError(null);
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
      setImageError(`Unsupported file type "${file.type || "unknown"}". Use PNG, JPEG, or WebP.`);
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setImageError(`Image is too large (${Math.round(file.size / 1024 / 1024)} MB). Max is 6 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setImageError("Could not read that file.");
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const commaAt = dataUrl.indexOf(",");
      if (commaAt < 0) {
        setImageError("Could not read that file.");
        return;
      }
      setImageDataUrl(dataUrl);
      setImageMime(file.type === "image/jpg" ? "image/jpeg" : file.type);
      setImageBase64(dataUrl.slice(commaAt + 1));
      setImageFileName(file.name || "screenshot");
    };
    reader.readAsDataURL(file);
  };

  const handleImagePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          ingestImageFile(file);
          return;
        }
      }
    }
  };

  const handleImageDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) ingestImageFile(file);
  };

  const extractFromImage = async () => {
    if (!imageBase64 || !imageMime) {
      setImageError("Pick an image first.");
      return;
    }
    setImageExtracting(true);
    setImageError(null);
    try {
      const resp = await fetch(`${BASE}/api/games/${id}/lineup/from-image`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64, mimeType: imageMime }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setImageError(data.error || `Request failed (${resp.status})`);
        return;
      }
      const lineup: typeof previewLineup = data.lineup ?? [];
      const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
      if (!lineup || lineup.length === 0) {
        setImageError(
          warnings[0] || "I couldn't read a lineup from that image. Try a clearer screenshot.",
        );
        return;
      }
      setPreviewLineup(lineup);
      setImageOpen(false);
      resetImageState();
      toast({
        title: `Imported ${lineup.length} entries — review and save`,
        description: warnings.length ? warnings.join(" · ") : undefined,
      });
    } catch {
      setImageError("The import service is unavailable. Try again in a moment.");
    } finally {
      setImageExtracting(false);
    }
  };

  const handleGenerate = () => {
    if (selectedPlayerIds.length === 0) {
      toast({ title: "Select at least one player", variant: "destructive" });
      return;
    }
    if (editedLineup) {
      const ok = window.confirm(
        "You have unsaved lineup edits. Generating a new lineup will discard them. Continue?",
      );
      if (!ok) return;
      setEditedLineup(null);
      setSelectedEntryId(null);
    }
    generateLineup.mutate(
      {
        id,
        data: {
          availablePlayerIds: selectedPlayerIds,
          innings: game?.innings ?? 6,
          constraints: {
            maxInningsPerPosition: 2,
            maxInningsBench: 2,
            ensureAllPositions: true,
            pitcherRotation: false,
          },
        },
      },
      {
        onSuccess: (result) => {
          setPreviewLineup(result);
          toast({ title: "Lineup generated — review and save" });
        },
        onError: () => toast({ title: "Failed to generate lineup", variant: "destructive" }),
      }
    );
  };

  const handleAskAi = async () => {
    const message = aiInput.trim();
    if (!message) return;
    if (editedLineup || previewLineup) {
      const what = editedLineup ? "unsaved lineup edits" : "an unsaved lineup preview";
      const ok = window.confirm(
        `You have ${what}. Asking the assistant to regenerate may replace them. Continue?`,
      );
      if (!ok) return;
    }
    const myRequestId = ++aiRequestIdRef.current;
    setAiLoading(true);
    setAiAnswer(null);
    try {
      const resp = await fetch(`${BASE}/api/games/${id}/ai-assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${resp.status})`);
      }
      const data = await resp.json();
      // Drop stale responses: the user already submitted a newer question.
      if (myRequestId !== aiRequestIdRef.current) return;
      if (data.kind === "answer") {
        setAiAnswer(data.text);
      } else if (data.kind === "regenerate") {
        setEditedLineup(null);
        setSelectedEntryId(null);
        setPreviewLineup(data.lineup);
        setAiAnswer(data.explanation);
        setAiInput("");
      } else {
        throw new Error("Unexpected response from assistant");
      }
    } catch (err) {
      if (myRequestId !== aiRequestIdRef.current) return;
      toast({
        title: "Couldn't get a response",
        description: err instanceof Error ? err.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      if (myRequestId === aiRequestIdRef.current) setAiLoading(false);
    }
  };

  const handleSaveLineup = (lineupToSave: typeof lineup) => {
    saveLineup.mutate(
      {
        id,
        data: {
          entries: lineupToSave.map((e) => ({
            playerId: e.playerId,
            inning: e.inning,
            position: e.position,
            battingOrder: e.battingOrder ?? null,
          })),
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGameLineupQueryKey(id) });
          qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() });
          toast({ title: "Lineup saved" });
          setGenerateOpen(false);
          setPreviewLineup(null);
          setEditedLineup(null);
          setSelectedEntryId(null);
        },
        onError: () => toast({ title: "Failed to save lineup", variant: "destructive" }),
      }
    );
  };

  /**
   * Apply a player move within an inning. Used by both click-to-swap and drag-and-drop.
   * Returns true if the lineup was changed, false if the move was a no-op or rejected.
   *
   * Semantics:
   *   field  -> empty field cell : move source there
   *   field  -> field player     : SWAP positions (both stay on the field)
   *   field  -> bench player     : SWAP (source onto bench, bench player onto field)
   *   field  -> bench area       : source goes to bottom of bench
   *   bench  -> empty field cell : move bench player to that field pos
   *   bench  -> field player     : source takes target's pos; target goes to bench bottom
   *   bench  -> bench player     : no-op
   *   bench  -> bench area       : no-op
   */
  type MoveTarget =
    | { kind: "tile"; entryId: number; inning: number; position: string }
    | { kind: "emptyField"; inning: number; position: string }
    | { kind: "benchArea"; inning: number };

  const applyMove = (sourceEntryId: number, target: MoveTarget): boolean => {
    const current = previewLineup ?? editedLineup ?? lineup;
    const sourceEntry = current.find((e) => e.id === sourceEntryId);
    if (!sourceEntry) return false;
    if (sourceEntry.inning !== target.inning) {
      toast({
        title: "Pick a cell in the same inning",
        description: "Players can only be moved within the same inning.",
        variant: "destructive",
      });
      return false;
    }

    let next: typeof current;
    if (target.kind === "tile") {
      if (target.entryId === sourceEntry.id) return false;
      const targetEntry = current.find((e) => e.id === target.entryId);
      if (!targetEntry) return false;
      if (sourceEntry.position === "Bench" && targetEntry.position === "Bench") return false;
      if (targetEntry.position === "Bench") {
        // Field source onto bench player → swap (preserve field slot occupancy).
        next = current.map((e) => {
          if (e.id === sourceEntry.id) return { ...e, position: "Bench" };
          if (e.id === targetEntry.id) return { ...e, position: sourceEntry.position };
          return e;
        });
      } else if (sourceEntry.position === "Bench") {
        // Bench source onto field player → source takes the field pos,
        // target moves to the bottom of the bench.
        next = current
          .filter((e) => e.id !== targetEntry.id)
          .map((e) =>
            e.id === sourceEntry.id ? { ...e, position: targetEntry.position } : e,
          )
          .concat([{ ...targetEntry, position: "Bench" }]);
      } else {
        // Field source onto field target → straight swap; both stay on the field.
        const sourcePos = sourceEntry.position;
        const targetPos = targetEntry.position;
        next = current.map((e) => {
          if (e.id === sourceEntry.id) return { ...e, position: targetPos };
          if (e.id === targetEntry.id) return { ...e, position: sourcePos };
          return e;
        });
      }
    } else if (target.kind === "emptyField") {
      next = current.map((e) =>
        e.id === sourceEntry.id ? { ...e, position: target.position } : e,
      );
    } else {
      // benchArea: send source to bottom of bench (no-op if already on bench).
      if (sourceEntry.position === "Bench") return false;
      next = current
        .filter((e) => e.id !== sourceEntry.id)
        .concat([{ ...sourceEntry, position: "Bench" }]);
    }

    if (previewLineup) setPreviewLineup(next);
    else setEditedLineup(next);
    return true;
  };

  // Tap-to-select fallback (kept alongside drag-and-drop for accessibility / quick taps).
  const handleCellClick = (target: { entryId?: number; inning: number; position: string }) => {
    if (selectedEntryId == null) {
      if (target.entryId != null) setSelectedEntryId(target.entryId);
      return;
    }
    if (target.entryId === selectedEntryId) {
      setSelectedEntryId(null);
      return;
    }
    const moveTarget: MoveTarget =
      target.entryId != null
        ? { kind: "tile", entryId: target.entryId, inning: target.inning, position: target.position }
        : { kind: "emptyField", inning: target.inning, position: target.position };
    const ok = applyMove(selectedEntryId, moveTarget);
    if (!ok && target.entryId != null) {
      // Re-anchor selection on the freshly tapped player when the move was rejected
      // (e.g. cross-inning) — matches the previous behavior.
      setSelectedEntryId(target.entryId);
    } else {
      setSelectedEntryId(null);
    }
  };

  const handleDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (!id.startsWith("player-")) return;
    const entryId = parseInt(id.slice("player-".length), 10);
    const current = previewLineup ?? editedLineup ?? lineup;
    const entry = current.find((x) => x.id === entryId);
    if (entry) setActiveDrag({ entryId, inning: entry.inning });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    setSelectedEntryId(null);
    if (!e.over) return;
    const sourceId = String(e.active.id);
    if (!sourceId.startsWith("player-")) return;
    const sourceEntryId = parseInt(sourceId.slice("player-".length), 10);
    const target = e.over.data.current as MoveTarget | undefined;
    if (!target) return;
    applyMove(sourceEntryId, target);
  };

  const handleDragCancel = () => {
    setActiveDrag(null);
  };

  const handleCopyLineup = async () => {
    const data = previewLineup ?? editedLineup ?? lineup;
    if (data.length === 0) {
      toast({ title: "Nothing to copy yet", variant: "destructive" });
      return;
    }
    const inningCount = game?.innings ?? 6;
    const header = ["Inning", ...FIELD_POSITIONS, "Bench"].join("\t");
    const rows = Array.from({ length: inningCount }, (_, i) => i + 1).map((inning) => {
      const cells = FIELD_POSITIONS.map((pos) => {
        const e = data.find((x) => x.inning === inning && x.position === pos);
        return e ? e.playerName : "";
      });
      const bench = data
        .filter((x) => x.inning === inning && x.position === "Bench")
        .map((x) => x.playerName)
        .join(", ");
      return [String(inning), ...cells, bench].join("\t");
    });
    const tsv = [header, ...rows].join("\n");
    const showSuccess = () =>
      toast({ title: "Lineup copied", description: "Paste it into Google Sheets." });
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tsv);
        showSuccess();
        return;
      }
      throw new Error("Clipboard API unavailable");
    } catch {
      // Fallback: hidden textarea + execCommand (works in non-secure contexts / older browsers)
      try {
        const ta = document.createElement("textarea");
        ta.value = tsv;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.left = "-1000px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) {
          showSuccess();
          return;
        }
      } catch {
        // fall through to toast
      }
      toast({ title: "Copy failed — clipboard not available", variant: "destructive" });
    }
  };

  const discardEdits = () => {
    setEditedLineup(null);
    setSelectedEntryId(null);
  };

  const handleMarkComplete = () => {
    updateGame.mutate(
      {
        id,
        data: {
          status: "completed",
          ourScore: parseInt(ourScore) || 0,
          opponentScore: parseInt(opponentScore) || 0,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGameQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          toast({ title: "Game marked as completed" });
          setCompleteOpen(false);
        },
        onError: () => toast({ title: "Failed to update game", variant: "destructive" }),
      }
    );
  };

  const innings = game?.innings ?? 6;
  const displayLineup = previewLineup ?? editedLineup ?? lineup;
  // Map (inning, position) -> entry, so cells know their entry id for swap.
  // Bench rows are NOT included here — bench is rendered as its own list.
  const cellByInningPos: Record<number, Record<string, typeof displayLineup[number]>> = {};
  for (const entry of displayLineup) {
    if (!cellByInningPos[entry.inning]) cellByInningPos[entry.inning] = {};
    if (entry.position !== "Bench") {
      cellByInningPos[entry.inning][entry.position] = entry;
    }
  }
  const selectedEntry = selectedEntryId != null
    ? displayLineup.find((e) => e.id === selectedEntryId)
    : undefined;

  const draggedEntry = activeDrag != null
    ? displayLineup.find((e) => e.id === activeDrag.entryId)
    : undefined;

  // Per-player innings count by category, for the "Innings by Position" tally below.
  // Counted at most once per (player, inning) so totals never exceed the game's
  // innings even if upstream data accidentally lists a player twice in one inning.
  const tallyRows = useMemo(() => {
    const map = new Map<
      number,
      { playerId: number; playerName: string; Pitching: number; Infield: number; Outfield: number; Bench: number }
    >();
    const seen = new Set<string>();
    for (const e of displayLineup) {
      const key = `${e.playerId}:${e.inning}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let row = map.get(e.playerId);
      if (!row) {
        row = { playerId: e.playerId, playerName: e.playerName, Pitching: 0, Infield: 0, Outfield: 0, Bench: 0 };
        map.set(e.playerId, row);
      }
      row[categoryFor(e.position)] += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.playerName.localeCompare(b.playerName));
  }, [displayLineup]);

  if (gameLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-64 bg-muted rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Game not found.</p>
        <Link href="/games"><Button variant="link">Back to Schedule</Button></Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link href="/games">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Schedule
          </Button>
        </Link>
      </div>

      {/* Game Header */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold">vs. {game.opponent}</h1>
                {game.status === "completed" ? (
                  <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>
                ) : game.status === "cancelled" ? (
                  <Badge variant="outline">Cancelled</Badge>
                ) : (
                  <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Upcoming</Badge>
                )}
              </div>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {format(new Date(game.gameDate), "EEEE, MMMM d, yyyy · h:mm a")}
                </span>
                {game.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {game.location}
                  </span>
                )}
                <span>{game.innings} innings</span>
              </div>
              {game.status === "completed" && game.ourScore != null && (
                <div className="mt-2 flex items-center gap-3">
                  <span className={`text-xl font-bold px-3 py-1 rounded ${(game.ourScore > (game.opponentScore ?? 0)) ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                    {game.ourScore > (game.opponentScore ?? 0) ? "W" : "L"} {game.ourScore} - {game.opponentScore}
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {game.status === "upcoming" && (
                <Button variant="outline" onClick={() => setCompleteOpen(true)}>
                  <Trophy className="h-4 w-4 mr-2" />
                  Mark Complete
                </Button>
              )}
              {game.status !== "cancelled" && (
                <>
                  <Button variant="outline" onClick={openImage} data-testid="button-from-screenshot">
                    <ImageIcon className="h-4 w-4 mr-2" />
                    From Screenshot
                  </Button>
                  <Button variant="outline" onClick={openCopy} data-testid="button-copy-from-previous">
                    <CopyIcon className="h-4 w-4 mr-2" />
                    Copy from Previous
                  </Button>
                  <Button onClick={openGenerate} data-testid="button-generate-lineup">
                    <Wand2 className="h-4 w-4 mr-2" />
                    {lineup.length > 0 ? "Replace Lineup" : "Generate Lineup"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Assistant search bar */}
      <Card>
        <CardContent className="p-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!aiLoading) handleAskAi();
            }}
          >
            <Sparkles className="h-4 w-4 text-purple-500 shrink-0 ml-1" />
            <Input
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              placeholder='Ask the assistant — e.g. "Why is Henry on the bench in inning 2?" or "Put Henry at catcher for the first 3 innings"'
              disabled={aiLoading}
              data-testid="input-ai-assistant"
              className="flex-1"
            />
            <Button
              type="submit"
              size="sm"
              disabled={aiLoading || !aiInput.trim()}
              data-testid="button-ai-ask"
            >
              {aiLoading ? "Thinking…" : "Ask"}
            </Button>
          </form>
          {aiAnswer && (
            <div
              className="mt-3 p-3 rounded-md bg-purple-50 border border-purple-200 text-sm text-purple-900 flex items-start justify-between gap-3"
              data-testid="ai-answer"
            >
              <div className="flex items-start gap-2 flex-1">
                <Sparkles className="h-4 w-4 mt-0.5 text-purple-500 shrink-0" />
                <p className="leading-snug">{aiAnswer}</p>
              </div>
              <button
                type="button"
                onClick={() => setAiAnswer(null)}
                className="text-purple-400 hover:text-purple-700 shrink-0"
                aria-label="Dismiss assistant message"
                data-testid="button-ai-dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lineup Grid */}
      {previewLineup && (
        <div className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg" data-testid="banner-preview">
          <span className="text-sm text-yellow-800 font-medium">Preview — lineup not saved yet</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setPreviewLineup(null); setSelectedEntryId(null); }}>Discard</Button>
            <Button size="sm" onClick={() => handleSaveLineup(previewLineup)} disabled={saveLineup.isPending} data-testid="button-save-preview">
              <Save className="h-4 w-4 mr-1" />
              {saveLineup.isPending ? "Saving..." : "Save Lineup"}
            </Button>
          </div>
        </div>
      )}
      {!previewLineup && editedLineup && (
        <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg" data-testid="banner-edited">
          <span className="text-sm text-amber-800 font-medium">Unsaved changes — you've moved players around</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={discardEdits} data-testid="button-discard-edits">Discard</Button>
            <Button size="sm" onClick={() => handleSaveLineup(editedLineup)} disabled={saveLineup.isPending} data-testid="button-save-edits">
              <Save className="h-4 w-4 mr-1" />
              {saveLineup.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0 gap-3">
          <div>
            <CardTitle className="text-base">
              {displayLineup.length > 0 ? "Defensive Lineup" : "No Lineup Yet"}
            </CardTitle>
            {displayLineup.length > 0 && game.status === "completed" && !previewLineup && !editedLineup && (
              <p className="text-xs text-muted-foreground mt-1" data-testid="text-recorded-hint">
                Recorded lineup — tap a player or drag to update what actually happened. Season stats reflect any changes you save.
              </p>
            )}
          </div>
          {displayLineup.length > 0 && (
            <div className="flex items-center gap-2">
              {selectedEntry && (
                <span className="text-xs text-muted-foreground hidden sm:inline" data-testid="text-swap-hint">
                  Moving <span className="font-medium text-foreground">{selectedEntry.playerName.split(" ")[0]}</span> — tap a cell in inning {selectedEntry.inning}
                  <button
                    type="button"
                    className="ml-2 inline-flex items-center text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedEntryId(null)}
                    title="Cancel swap"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              <Button variant="outline" size="sm" onClick={handleCopyLineup} data-testid="button-copy-lineup">
                <ClipboardCopy className="h-4 w-4 mr-1.5" />
                Copy
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {lineupLoading ? (
            <div className="h-40 bg-muted animate-pulse rounded" />
          ) : displayLineup.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Wand2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>No lineup generated yet.</p>
              <div className="flex gap-2 justify-center mt-3 flex-wrap">
                <Button variant="outline" onClick={openImage}>
                  <ImageIcon className="h-4 w-4 mr-2" />
                  From Screenshot
                </Button>
                <Button variant="outline" onClick={openCopy}>
                  <CopyIcon className="h-4 w-4 mr-2" />
                  Copy from Previous
                </Button>
                <Button onClick={openGenerate}>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Generate Lineup
                </Button>
              </div>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-y-1.5">
                  <thead>
                    <tr>
                      <th className="text-left py-2 pr-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-16">Inning</th>
                      {FIELD_POSITIONS.map((pos) => (
                        <th key={pos} className="text-center py-2 px-1 w-20">
                          <span className="inline-block px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-[11px] font-bold tracking-wide">
                            {pos}
                          </span>
                        </th>
                      ))}
                      <th className="text-center py-2 px-1 w-28">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
                          Bench
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: innings }, (_, i) => i + 1).map((inning) => {
                      const isHotInning =
                        selectedEntry?.inning === inning || activeDrag?.inning === inning;
                      const benchEntries = displayLineup.filter(
                        (e) => e.inning === inning && e.position === "Bench",
                      );
                      // Each inning is a soft "row card" — alternating subtle
                      // background plus rounded ends so it feels like a stack
                      // of cards instead of a grid of cells.
                      const rowBg = isHotInning
                        ? "bg-primary/5"
                        : inning % 2 === 0
                          ? "bg-muted/40"
                          : "bg-card";
                      return (
                        <tr key={inning} className={`${rowBg} transition-colors`}>
                          <td className="py-2 pl-3 pr-2 rounded-l-xl">
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-sm">
                              {inning}
                            </span>
                          </td>
                          {FIELD_POSITIONS.map((pos) => {
                            const entry = cellByInningPos[inning]?.[pos];
                            return (
                              <td key={pos} className="py-2 px-1 text-center">
                                <FieldCell
                                  inning={inning}
                                  position={pos}
                                  entry={entry}
                                  selectedEntryId={selectedEntryId}
                                  isHotInning={isHotInning}
                                  draggedEntryId={activeDrag?.entryId ?? null}
                                  onTileClick={(id) =>
                                    handleCellClick({ entryId: id, inning, position: pos })
                                  }
                                  onEmptyClick={() =>
                                    handleCellClick({ inning, position: pos })
                                  }
                                />
                              </td>
                            );
                          })}
                          <td className="py-2 px-1 pr-2 text-center align-top rounded-r-xl border-l border-border/40">
                            <BenchArea
                              inning={inning}
                              entries={benchEntries}
                              selectedEntryId={selectedEntryId}
                              isHotInning={isHotInning}
                              draggedEntryId={activeDrag?.entryId ?? null}
                              onTileClick={(id) =>
                                handleCellClick({ entryId: id, inning, position: "Bench" })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <DragOverlay dropAnimation={null}>
                {draggedEntry ? (
                  <div
                    className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${positionColor(draggedEntry.position)} shadow-lg ring-2 ring-primary cursor-grabbing`}
                  >
                    {draggedEntry.playerName.split(" ")[0]}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </CardContent>
      </Card>

      {/* Innings by Position tally */}
      {displayLineup.length > 0 && (
        <Card data-testid="card-tally">
          <CardHeader>
            <CardTitle className="text-base">Innings by Position</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs">
                    <th className="text-left py-2 pr-3 font-medium">Player</th>
                    <th className="text-center py-2 px-2 font-medium">Pitching</th>
                    <th className="text-center py-2 px-2 font-medium">Infield</th>
                    <th className="text-center py-2 px-2 font-medium">Outfield</th>
                    <th className="text-center py-2 px-2 font-medium">Bench</th>
                    <th className="text-center py-2 pl-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {tallyRows.map((row) => {
                    const total = row.Pitching + row.Infield + row.Outfield + row.Bench;
                    return (
                      <tr
                        key={row.playerId}
                        className="border-t border-border/50"
                        data-testid={`tally-row-${row.playerId}`}
                      >
                        <td className="py-1.5 pr-3 font-medium">{row.playerName}</td>
                        <td className="text-center py-1.5 px-2" data-testid={`tally-${row.playerId}-pitching`}>
                          {row.Pitching > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-xs font-semibold">
                              {row.Pitching}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="text-center py-1.5 px-2" data-testid={`tally-${row.playerId}-infield`}>
                          {row.Infield > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs font-semibold">
                              {row.Infield}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="text-center py-1.5 px-2" data-testid={`tally-${row.playerId}-outfield`}>
                          {row.Outfield > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-xs font-semibold">
                              {row.Outfield}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="text-center py-1.5 px-2" data-testid={`tally-${row.playerId}-bench`}>
                          {row.Bench > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-semibold">
                              {row.Bench}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="text-center py-1.5 pl-2 font-semibold text-muted-foreground">
                          {total}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Pitching: P · Infield: C, 1B, 2B, 3B, SS · Outfield: LF, CF, RF
            </p>
          </CardContent>
        </Card>
      )}

      {/* Generate Dialog */}
      <Dialog open={generateOpen} onOpenChange={(o) => !o && setGenerateOpen(false)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Lineup</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Select players available for this game. The lineup will rotate positions fairly.
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <Label className="text-sm">Available Players</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-primary"
                    onClick={() => setSelectedPlayerIds(players.filter((p) => p.active).map((p) => p.id))}
                  >
                    Select all
                  </button>
                  <span className="text-xs text-muted-foreground">·</span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground"
                    onClick={() => setSelectedPlayerIds([])}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {players.filter((p) => p.active).map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                    selectedPlayerIds.includes(p.id)
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <Checkbox
                    checked={selectedPlayerIds.includes(p.id)}
                    onCheckedChange={(v) =>
                      setSelectedPlayerIds((prev) =>
                        v ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                      )
                    }
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{p.name}</span>
                    {p.number != null && <span className="text-xs text-muted-foreground ml-1.5">#{p.number}</span>}
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {p.eligiblePositions.slice(0, 3).map((pos) => (
                      <span key={pos} className="text-xs text-muted-foreground">{pos}</span>
                    ))}
                  </div>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>Cancel</Button>
            {previewLineup ? (
              <Button onClick={() => handleSaveLineup(previewLineup)} disabled={saveLineup.isPending}>
                <Save className="h-4 w-4 mr-1" />
                {saveLineup.isPending ? "Saving..." : "Save This Lineup"}
              </Button>
            ) : (
              <Button onClick={handleGenerate} disabled={generateLineup.isPending}>
                <Wand2 className="h-4 w-4 mr-1" />
                {generateLineup.isPending ? "Generating..." : "Generate"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* From Screenshot Dialog */}
      <Dialog
        open={imageOpen}
        onOpenChange={(o) => {
          if (!o) {
            setImageOpen(false);
            resetImageState();
          }
        }}
      >
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Import Lineup from Screenshot
            </DialogTitle>
          </DialogHeader>
          <div
            className="flex flex-col gap-3"
            onPaste={handleImagePaste}
            tabIndex={-1}
          >
            <p className="text-sm text-muted-foreground">
              Upload a photo or screenshot of a lineup (from another app, a printed lineup card, or a hand-drawn grid). I'll read it and match each player to your active roster, then show you a preview to review and save.
            </p>

            {!imageDataUrl ? (
              <label
                className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
                onDrop={handleImageDrop}
                onDragOver={(e) => e.preventDefault()}
                data-testid="dropzone-image"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">Click, drop, or paste an image</span>
                <span className="text-xs text-muted-foreground">PNG, JPEG, or WebP — up to 6 MB</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  data-testid="input-image-file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) ingestImageFile(f);
                    // Reset so picking the same file again still triggers onChange.
                    e.target.value = "";
                  }}
                />
              </label>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="rounded-lg border border-border overflow-hidden bg-muted">
                  <img
                    src={imageDataUrl}
                    alt={imageFileName ?? "Lineup screenshot"}
                    className="block w-full max-h-[280px] object-contain bg-white"
                    data-testid="img-preview"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground truncate">{imageFileName}</span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    onClick={resetImageState}
                    data-testid="button-clear-image"
                  >
                    <X className="h-3 w-3" /> Clear
                  </button>
                </div>
              </div>
            )}

            {imageError && (
              <div
                className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2.5"
                data-testid="text-image-error"
              >
                {imageError}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Tip: the clearer the image, the better. Names matched against your active roster — anything we can't match will leave the slot blank for you to fill in.
            </p>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setImageOpen(false)}>Cancel</Button>
            <Button
              onClick={extractFromImage}
              disabled={!imageBase64 || imageExtracting}
              data-testid="button-extract-image"
            >
              <Sparkles className="h-4 w-4 mr-1" />
              {imageExtracting ? "Reading lineup…" : "Read Lineup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy From Previous Dialog */}
      <Dialog open={copyOpen} onOpenChange={(o) => !o && setCopyOpen(false)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Copy from a Previous Game
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Pick a past game and we'll preview its lineup here as a starting point.
              Players who aren't on your current active roster will be dropped — you can review and save before anything is committed.
            </p>
            {copyLoading ? (
              <div className="space-y-2">
                <div className="h-14 bg-muted animate-pulse rounded-md" />
                <div className="h-14 bg-muted animate-pulse rounded-md" />
                <div className="h-14 bg-muted animate-pulse rounded-md" />
              </div>
            ) : !copyGames || copyGames.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground" data-testid="text-copy-empty">
                No other games have a saved lineup yet.
              </div>
            ) : (
              <div className="flex flex-col gap-2" data-testid="list-copy-games">
                {copyGames.map((g) => {
                  const inningMismatch = game && g.innings !== game.innings;
                  return (
                    <button
                      type="button"
                      key={g.id}
                      onClick={() => applyCopyFrom(g.id)}
                      disabled={copyApplyingId !== null}
                      className="text-left p-3 rounded-md border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors disabled:opacity-60 disabled:cursor-wait"
                      data-testid={`button-copy-game-${g.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">vs. {g.opponent}</span>
                        {g.status === "completed" ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-[10px] px-1.5 py-0">Played</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Upcoming</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span>{format(new Date(g.gameDate), "EEE, MMM d, yyyy")}</span>
                        <span>{g.innings} innings{inningMismatch && ` (yours: ${game?.innings})`}</span>
                        {copyApplyingId === g.id && <span className="text-primary">Loading…</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Game Dialog */}
      <Dialog open={completeOpen} onOpenChange={(o) => !o && setCompleteOpen(false)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Mark Game Complete</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Our Score</Label>
                <Input
                  type="number"
                  min="0"
                  value={ourScore}
                  onChange={(e) => setOurScore(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Opponent Score</Label>
                <Input
                  type="number"
                  min="0"
                  value={opponentScore}
                  onChange={(e) => setOpponentScore(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteOpen(false)}>Cancel</Button>
            <Button onClick={handleMarkComplete} disabled={updateGame.isPending}>
              {updateGame.isPending ? "Saving..." : "Mark Complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Drag-and-drop sub-components ─────────────────────────────────────────────

type Entry = {
  id: number;
  playerId: number;
  playerName: string;
  inning: number;
  position: string;
};

interface PlayerTileProps {
  entry: Entry;
  positionForColor: string;
  isSelected: boolean;
  isHotInning: boolean;
  isBeingDragged: boolean;
  onClick: (entryId: number) => void;
  testId: string;
}

/** Draggable colored chip representing a single player in a lineup cell. */
function PlayerTile({
  entry,
  positionForColor,
  isSelected,
  isHotInning,
  isBeingDragged,
  onClick,
  testId,
}: PlayerTileProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `player-${entry.id}`,
  });
  const ringClasses = isSelected
    ? "ring-2 ring-primary ring-offset-1"
    : isHotInning
      ? "ring-1 ring-primary/40"
      : "";
  // Hide the original tile while it's flying around in the DragOverlay so we
  // don't see two copies of the same chip.
  const hideOriginal = isDragging || isBeingDragged;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onClick(entry.id)}
      className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap min-w-[3rem] shadow-sm transition-all ${positionColor(positionForColor)} ${ringClasses} ${hideOriginal ? "opacity-30" : ""} touch-none cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-px`}
      data-testid={testId}
      data-entry-id={entry.id}
      data-selected={isSelected ? "true" : "false"}
      title={`${entry.playerName} — drag to move (or tap to select)`}
      {...listeners}
      {...attributes}
    >
      {entry.playerName.split(" ")[0]}
    </button>
  );
}

interface FieldCellProps {
  inning: number;
  position: string;
  entry: Entry | undefined;
  selectedEntryId: number | null;
  isHotInning: boolean;
  draggedEntryId: number | null;
  onTileClick: (entryId: number) => void;
  onEmptyClick: () => void;
}

/** A single non-bench position cell. Always droppable; renders a tile if filled. */
function FieldCell({
  inning,
  position,
  entry,
  selectedEntryId,
  isHotInning,
  draggedEntryId,
  onTileClick,
  onEmptyClick,
}: FieldCellProps) {
  const dropId = `field-${inning}-${position}`;
  const dropData = entry
    ? { kind: "tile" as const, entryId: entry.id, inning, position }
    : { kind: "emptyField" as const, inning, position };
  const { isOver, setNodeRef } = useDroppable({ id: dropId, data: dropData });
  const showEmptyHint = !entry && (isHotInning || isOver);
  const overRing = isOver && isHotInning ? "ring-2 ring-primary ring-offset-1 bg-primary/5" : "";
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[2.25rem] flex items-center justify-center rounded transition-colors ${overRing}`}
    >
      {entry ? (
        <PlayerTile
          entry={entry}
          positionForColor={position}
          isSelected={entry.id === selectedEntryId}
          isHotInning={isHotInning}
          isBeingDragged={entry.id === draggedEntryId}
          onClick={onTileClick}
          testId={`cell-${inning}-${position}`}
        />
      ) : showEmptyHint ? (
        <button
          type="button"
          onClick={onEmptyClick}
          className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap min-w-[3rem] border border-dashed border-primary/60 text-primary hover:bg-primary/10"
          data-testid={`cell-${inning}-${position}-empty`}
          title="Drop or tap to move here"
        >
          +
        </button>
      ) : (
        <span className="text-muted-foreground/40 text-xs">—</span>
      )}
    </div>
  );
}

interface BenchAreaProps {
  inning: number;
  entries: Entry[];
  selectedEntryId: number | null;
  isHotInning: boolean;
  draggedEntryId: number | null;
  onTileClick: (entryId: number) => void;
}

/** Bench column for an inning. The whole area is one big drop zone. */
function BenchArea({
  inning,
  entries,
  selectedEntryId,
  isHotInning,
  draggedEntryId,
  onTileClick,
}: BenchAreaProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `bench-${inning}`,
    data: { kind: "benchArea" as const, inning },
  });
  const overRing = isOver && isHotInning ? "ring-2 ring-primary bg-primary/5" : "";
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[2.25rem] rounded transition-colors px-1 py-1 ${overRing} ${isHotInning && entries.length === 0 ? "border border-dashed border-primary/40" : ""}`}
      data-testid={`bench-${inning}`}
    >
      <div className="flex flex-wrap gap-1 justify-center">
        {entries.map((e) => (
          <PlayerTile
            key={e.id}
            entry={e}
            positionForColor="Bench"
            isSelected={e.id === selectedEntryId}
            isHotInning={isHotInning}
            isBeingDragged={e.id === draggedEntryId}
            onClick={onTileClick}
            testId={`cell-${inning}-Bench-${e.id}`}
          />
        ))}
        {isHotInning && entries.length === 0 && (
          <span className="text-xs text-primary/70">drop on bench</span>
        )}
      </div>
    </div>
  );
}
