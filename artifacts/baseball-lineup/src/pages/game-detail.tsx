import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRoute, Link } from "wouter";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useGetGame,
  useGetGameLineup,
  useGenerateLineup,
  useSaveLineup,
  useUpdateGame,
  useListPlayers,
  useSnapshotPlan,
  useClearPlanSnapshot,
  useGetPreferences,
  useGetTournament,
  getGetGameQueryKey,
  getGetGameLineupQueryKey,
  getListGamesQueryKey,
  getGetSeasonStatsQueryKey,
  getGetPlayerStatsQueryKey,
  getGetTournamentQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "@/lib/confirm";
import { SavedIndicator } from "@/components/saved-indicator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, GripVertical, Wand2, Save, Trophy, CalendarDays, MapPin, ClipboardCopy, X, Sparkles, Copy as CopyIcon, History, Image as ImageIcon, Upload, Lock as LockIcon, Plus, Printer, Camera, Eye, Trash2, Users, Tv, AlertCircle, MousePointerClick, Pencil, Settings2, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";
import { AiAssistantPanel } from "@/components/game-detail/ai-assistant-panel";
import { type Entry } from "@/components/game-detail/types";
import {
  POSITION_DISPLAY_ORDER,
  TALLY_CATEGORIES,
  categoryForPos,
  positionColor,
  safeFormatDate,
} from "@/components/game-detail/utils";
import { PlayerTile } from "@/components/game-detail/player-tile";
import { FieldCell } from "@/components/game-detail/field-cell";
import { BenchArea } from "@/components/game-detail/bench-area";
import { SortableBattingRow } from "@/components/game-detail/sortable-batting-row";
import { usePermission } from "@/hooks/use-permission";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { effectiveStatus } from "@/lib/game-status";
import { PitchCountsCard } from "@/components/pitch-counts-card";
import { SelectPositionsDialog } from "@/components/select-positions-dialog";
import { BoxScoreImportDialog } from "@/components/box-score-import-dialog";
import { EditGameDialog } from "@/components/edit-game-dialog";
import { DepthChartReference, DepthChartIcon } from "@/pages/depth-chart";
import { BoxScoreDisplayCard } from "@/components/box-score-display-card";
import { FileText } from "lucide-react";
import { formatPlayerNameShort } from "@/lib/player-name";
import { shortenTeamName, formatOpponentForMatchup } from "@/lib/team-name";
import { sportPositionCodes, type SportId } from "@workspace/sport-profiles";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function GameDetail() {
  const [, params] = useRoute("/games/:id");
  const id = parseInt(params?.id ?? "0");
  const { data: game, isLoading: gameLoading } = useGetGame(id, {
    query: { enabled: !!id, queryKey: getGetGameQueryKey(id) },
  });
  const {
    data: lineup = [],
    isLoading: lineupLoading,
    dataUpdatedAt: lineupFetchedAt,
  } = useGetGameLineup(id, {
    query: { enabled: !!id, queryKey: getGetGameLineupQueryKey(id) },
  });
  // Promise-based confirm() — replaces the half-dozen native
  // `window.confirm` calls scattered through this page. Centralized
  // dialog lives in <ConfirmProvider> at the app root.
  const confirm = useConfirm();
  // Tracks the most recent successful saveLineup mutation so the
  // header SavedIndicator can show "Saved Xs ago". Initialized to
  // null and seeded from the lineup query's `dataUpdatedAt` below so
  // the page shows a sensible age on first load (not "just now" for
  // data that's actually hours old).
  const [lastLineupSavedAt, setLastLineupSavedAt] = useState<number | null>(null);
  const { data: players = [] } = useListPlayers();
  // Read coach preferences so the Generate flow can honor "always lock
  // pitchers and catchers" — see the AlertDialog flow on `openGenerate`
  // below. We track `prefsLoading` explicitly so an early click on
  // "Generate Lineup" (before the prefs query resolves) doesn't silently
  // bypass the gate or fire it incorrectly.
  const { data: prefs, isLoading: prefsLoading } = useGetPreferences();
  // For tournament games we fetch the parent tournament so we can surface a
  // pitch-budget callout above the lineup ("Two pitchers are nearly out for
  // today"). Same data already powers PitchCountsCard — this just hoists a
  // summary up to where the equity insights live.
  const tournamentIdForCallout = game?.tournamentId ?? null;
  const tournamentForCallout = useGetTournament(tournamentIdForCallout ?? 0, {
    query: {
      enabled: tournamentIdForCallout != null,
      queryKey: getGetTournamentQueryKey(tournamentIdForCallout ?? 0),
    },
  });
  const generateLineup = useGenerateLineup();
  const saveLineup = useSaveLineup();
  // Lineup edits require partial+. View-only coaches can browse the
  // game (read the lineup, see scores, watch the field display) but
  // can't generate, edit, or save. Server enforces independently.
  const { can } = usePermission();
  const canEditLineup = can("partial");
  const updateGame = useUpdateGame();
  const snapshotPlan = useSnapshotPlan();
  const clearPlanSnapshot = useClearPlanSnapshot();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { teamName, battingStyle, activeFieldPositions, showSelectPositions, sport, sportProfile } = useTeamSettings();
  // Two new dialogs introduced for the post-game photo override flow:
  // - replaceConfirmOpen: shown after a photo is parsed AND a saved lineup
  //   already exists, asking whether to keep the original as a plan snapshot.
  // - viewPlanOpen: shown when the coach clicks "View Original Plan" to see
  //   the snapshot that was taken before the override.
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [pendingPhotoLineup, setPendingPhotoLineup] = useState<typeof lineup | null>(null);
  const [viewPlanOpen, setViewPlanOpen] = useState(false);

  const [generateOpen, setGenerateOpen] = useState(false);
  // Fairness dial value shown in the Generate Lineup dialog. Seeded from the
  // saved `global_equity_weight` constraint when the dialog opens. Persisted
  // back to that same constraint on Generate so the next game remembers it.
  const [equityValue, setEquityValue] = useState<number>(50);
  // Tracks whether the user has touched the slider since the dialog opened.
  // Prevents a slow seed-fetch from clobbering an in-progress drag.
  const equityTouchedRef = useRef(false);
  // Monotonically-increasing token so a stale seed-fetch from an earlier dialog
  // open can't apply its result after a newer open (or after the user moved the
  // slider).
  const equitySeedTokenRef = useRef(0);
  // Disables the Generate button while we persist the dial + before the
  // mutation flips `isPending`, closing the double-submit window.
  const [generating, setGenerating] = useState(false);
  // Confirmation dialog shown when the coach has the "always lock pitchers
  // and catchers" preference on but hasn't placed P/C locks for every
  // inning. Holds the list of innings still missing locks so we can list
  // them in the prompt body. `null` = dialog closed.
  const [lockPromptInnings, setLockPromptInnings] = useState<{
    p: number[];
    c: number[];
  } | null>(null);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<number[]>([]);
  // "Edit Available Players" dialog: lets the coach toggle players in/out of
  // an EXISTING lineup (e.g. someone got hurt mid-warmup). Separate from the
  // Generate dialog's selection so opening one doesn't stomp the other.
  const [availableOpen, setAvailableOpen] = useState(false);
  const [availableSelectedIds, setAvailableSelectedIds] = useState<number[]>(
    [],
  );
  // "Add player to empty slot" picker: when the coach taps an empty field
  // cell with no player currently selected, we open a dialog so they can
  // pick from the roster instead of needing to drag.
  const [addSlotTarget, setAddSlotTarget] = useState<{
    inning: number;
    position: string;
  } | null>(null);
  const [previewLineup, setPreviewLineup] = useState<typeof lineup | null>(null);
  // Single popup that fronts the three "where does this lineup come from"
  // entry points (AI generate / upload screenshot / copy previous game).
  // Friend feedback was that three primary buttons sitting next to each
  // other was visually noisy and made the page feel cluttered — funneling
  // them through one CTA cleans up the lineup card header.
  const [lineupActionsOpen, setLineupActionsOpen] = useState(false);
  // Mobile-only "Tools & insights" disclosure. Coaches reported having
  // to scroll past AI Assistant + Position Locks + Equity Insights +
  // Pitch budget watch + tap hint to reach the actual lineup grid on
  // an iPhone (in both portrait AND landscape — landscape is even
  // worse because vertical real estate is tighter). Default-collapsed
  // on mobile lifts the grid up so editing is the first thing in
  // view; coaches who want the secondary tools can tap once to expand.
  // Desktop / tablet (`sm:` and up) renders everything inline as
  // before — these tools have plenty of room there.
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  // Active tab among the four "what do you want to look at for this game"
  // panels: defensive lineup grid, batting order, innings tally, pitch
  // counts. Defaults to defense; deep-links from the dashboard's pitch
  // counts task (`#pitch-counts-card`) jump straight to the pitching tab.
  const [lineupTab, setLineupTab] = useState<
    "defense" | "batting" | "innings" | "pitching"
  >(() => {
    if (typeof window !== "undefined" && window.location.hash === "#pitch-counts-card") {
      return "pitching";
    }
    return "defense";
  });
  useEffect(() => {
    const onHash = () => {
      // Only honor the pitch-counts deep-link when the sport actually
      // exposes a pitching panel (baseball). Basketball has no pitch
      // counts tab, so jumping there would land on a hidden panel.
      if (
        window.location.hash === "#pitch-counts-card" &&
        sportProfile.features.pitchCounts
      ) {
        setLineupTab("pitching");
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [sportProfile.features.pitchCounts]);
  // Safety net: if the active tab isn't available for this sport (e.g. a
  // basketball team deep-linked to #pitch-counts-card, or batting order is
  // hidden), fall back to the always-present defense/lineup tab.
  useEffect(() => {
    if (lineupTab === "pitching" && !sportProfile.features.pitchCounts) {
      setLineupTab("defense");
    } else if (lineupTab === "batting" && !sportProfile.features.battingOrder) {
      setLineupTab("defense");
    }
  }, [lineupTab, sportProfile.features.pitchCounts, sportProfile.features.battingOrder]);
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
  // Mobile defense view mode + active inning. Coaches mid-game don't want a
  // tiny transposed grid showing every inning at once on a phone — they want
  // to focus on ONE inning, swap a kid, then bump to the next. "single" is
  // the phone default; "all" falls back to the original compressed grid for
  // coaches who want the season-pacing view.
  const [mobileDefenseView, setMobileDefenseView] = useState<"single" | "all">("single");
  const [mobileActiveInning, setMobileActiveInning] = useState(1);
  // Auto-opens on arrival when the URL carries `?complete=1` so the
  // dashboard "Score it" task can drop the coach straight into the
  // final-score entry dialog for a game missing its score.
  const [completeOpen, setCompleteOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("complete") === "1";
  });
  const [editGameOpen, setEditGameOpen] = useState(false);
  const [depthChartOpen, setDepthChartOpen] = useState(false);
  const [boxScoreOpen, setBoxScoreOpen] = useState(false);
  // Box-score offer. On arrival from the field-display "Mark complete &
  // finish" flow (`?openBoxScore=1`) we no longer drop the coach straight
  // into the upload screen — instead we ASK first whether they want to
  // load a box score for pitch counting + batting stats. "Yes" opens the
  // importer; "No" just dismisses. We only honor the flag once on first
  // mount so closing the prompt (or the importer) doesn't re-trigger it.
  // The query string is left in place; it's harmless.
  const [boxScorePromptOpen, setBoxScorePromptOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    // Score entry takes precedence — if both deep-link params somehow
    // arrive together, don't stack two modals on mount.
    if (params.get("complete") === "1") return false;
    return params.get("openBoxScore") === "1";
  });
  // "Game ended early" flow — coach picks the last inning that was actually
  // played (e.g. 10-run rule) and the server trims the game length plus any
  // saved lineup data past that inning.
  const [endEarlyOpen, setEndEarlyOpen] = useState(false);
  const [endEarlyLastInning, setEndEarlyLastInning] = useState<string>("");
  const [ourScore, setOurScore] = useState("");
  const [opponentScore, setOpponentScore] = useState("");
  // Drag-and-drop state: which entry is currently being dragged + its inning,
  // so droppable cells in the same inning can highlight as valid drop targets.
  const [activeDrag, setActiveDrag] = useState<{ entryId: number; inning: number } | null>(null);

  // Position locks (per-game persistent pins). Each row is a single
  // (playerId, inning, position); an "all innings" lock is N rows behind
  // the scenes but the UI groups them visually.
  type Lock = {
    id: number;
    gameId: number;
    playerId: number;
    playerName: string;
    inning: number;
    position: string;
  };
  const [locks, setLocks] = useState<Lock[]>([]);
  const [locksLoading, setLocksLoading] = useState(false);
  const [addLockOpen, setAddLockOpen] = useState(false);
  const [lockPlayerId, setLockPlayerId] = useState<string>("");
  const [lockPosition, setLockPosition] = useState<string>("");
  // Set of 1-based inning numbers the user has selected. Empty = nothing
  // selected yet (validated on submit). The "All innings" checkbox in the
  // dialog is derived from the size of this set rather than a separate flag.
  const [lockInnings, setLockInnings] = useState<Set<number>>(new Set());
  const [lockSubmitting, setLockSubmitting] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  // AI Assistant search bar state.
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  // How many AI-driven pins are remembered for this game (so the AI honors
  // earlier instructions on subsequent turns). Refreshed after each AI call
  // and via "Reset AI memory".
  const [aiMemoryCount, setAiMemoryCount] = useState(0);
  const [aiMemoryClearing, setAiMemoryClearing] = useState(false);
  // Monotonically-increasing request id so a stale response from an earlier
  // submission can't clobber the state set by a newer one.
  const aiRequestIdRef = useRef(0);
  // Refs that mirror the latest lineup state. The AI request takes a few
  // seconds; if the coach edits the lineup while waiting, the response
  // handler must apply removals against the LATEST state (not a stale
  // closure capture from when the request was kicked off), otherwise a
  // remove response can silently overwrite newer local edits.
  const previewLineupRef = useRef<typeof previewLineup>(null);
  const editedLineupRef = useRef<typeof editedLineup>(null);
  const lineupRef = useRef<typeof lineup>([] as typeof lineup);
  // Per-session dismissal for the equity insights popup. Reset whenever a
  // new lineup arrives (new save / preview / regenerate) so the coach sees
  // it again with fresh advice.
  const [equityDismissed, setEquityDismissed] = useState(false);
  // Detect coarse-pointer (touch) devices once on mount. We still mount the
  // sensors on touch — but with a long-press activation (delay+tolerance)
  // so a normal scroll doesn't accidentally start a drag. The tap-to-select
  // flow (handleCellClick) remains as a fallback for coaches who prefer it.
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setIsCoarsePointer(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  // Per-session dismissal for the "tap to swap" hint banner shown to mobile
  // coaches. Re-shows on a new session so a coach who closed it weeks ago
  // sees it again next time.
  const [tapHintDismissed, setTapHintDismissed] = useState(false);
  // Sensors: switched off PointerSensor (which had reliability issues
  // across browsers — drops would intermittently report `over: null`
  // even when the cursor was clearly over a target cell) to the
  // explicit MouseSensor + TouchSensor combo, which is dnd-kit's
  // default-recommended setup.
  // - MouseSensor: 5px activation distance — a click still passes
  //   through so tap-to-select works, a small movement starts a drag.
  // - TouchSensor: 200ms long-press + 8px tolerance. A normal scroll
  //   gesture (move within the first 200ms) is preserved; holding
  //   still for 200ms grabs the chip. This unblocks iPad coaches who
  //   previously had no drag at all.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );
  // Collision detection: pointerWithin first (cursor must be inside the
  // droppable rect — most precise, exactly matches "I dropped on THIS
  // cell"), then closestCenter as a fallback for the small case where
  // the cursor sits in the row gap between cells. This combo is dnd-kit's
  // recommended pattern for dense grids — pure closestCenter alone could
  // pick an adjacent inning's cell when the user releases near the edge.
  const fieldCollisionDetection: CollisionDetection = (args) => {
    const pointer = pointerWithin(args);
    return pointer.length > 0 ? pointer : closestCenter(args);
  };
  // Tracks when the most recent drag ended. A few ms after a drop, browsers
  // fire a synthetic click on whatever was under the pointer — that would
  // re-open the "add player" picker right on top of the move you just made.
  // We swallow clicks that arrive within this window.
  const lastDragEndAtRef = useRef<number>(0);

  // Load locks for this game whenever the id changes.
  const refetchLocks = async (): Promise<Lock[]> => {
    if (!id) return [];
    setLocksLoading(true);
    try {
      const resp = await fetch(`${BASE}/api/games/${id}/locks`);
      if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
      const data: Lock[] = await resp.json();
      setLocks(data);
      return data;
    } catch {
      // Don't toast on background load failures — surface only on user action.
      return [];
    } finally {
      setLocksLoading(false);
    }
  };
  useEffect(() => {
    void refetchLocks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Load remembered AI pin count whenever the game changes so the indicator
  // (and "Reset" affordance) appears immediately for returning visits.
  const refetchAiMemory = async (): Promise<number> => {
    if (!id) return 0;
    try {
      const resp = await fetch(`${BASE}/api/games/${id}/ai-pins`);
      if (!resp.ok) return 0;
      const data = await resp.json();
      const count = typeof data?.count === "number" ? data.count : 0;
      setAiMemoryCount(count);
      return count;
    } catch {
      return 0;
    }
  };
  useEffect(() => {
    void refetchAiMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Keep the lineup refs in sync so async handlers (currently the AI
  // assistant remove flow) can read the LATEST lineup state when the
  // response lands, not the snapshot captured at request-start.
  useEffect(() => { previewLineupRef.current = previewLineup; }, [previewLineup]);
  useEffect(() => { editedLineupRef.current = editedLineup; }, [editedLineup]);
  useEffect(() => { lineupRef.current = lineup; });

  const handleClearAiMemory = async () => {
    if (aiMemoryCount === 0) return;
    setAiMemoryClearing(true);
    try {
      const resp = await fetch(`${BASE}/api/games/${id}/ai-pins`, { method: "DELETE" });
      if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
      setAiMemoryCount(0);
      toast({ title: "AI memory cleared" });
    } catch (err) {
      toastError(toast, "Couldn't clear AI memory", err);
    } finally {
      setAiMemoryClearing(false);
    }
  };

  // Group locks for compact display: one chip per (player, position) where
  // every inning of the game is covered, otherwise per-inning chips.
  const groupedLocks = useMemo(() => {
    if (!game) return [] as Array<{ key: string; label: string; ids: number[]; player: string; position: string; allInnings: boolean }>;
    const byPlayerPos = new Map<string, Lock[]>();
    for (const l of locks) {
      const k = `${l.playerId}:${l.position}`;
      const list = byPlayerPos.get(k) ?? [];
      list.push(l);
      byPlayerPos.set(k, list);
    }
    const out: Array<{ key: string; label: string; ids: number[]; player: string; position: string; allInnings: boolean }> = [];
    for (const [k, list] of byPlayerPos) {
      const player = list[0].playerName;
      const position = list[0].position;
      const innings = list.map((l) => l.inning).sort((a, b) => a - b);
      const allCovered = innings.length === game.innings && innings[0] === 1 && innings[innings.length - 1] === game.innings;
      if (allCovered) {
        out.push({ key: k, label: `${player} @ ${position} · all innings`, ids: list.map((l) => l.id), player, position, allInnings: true });
      } else {
        for (const l of list) {
          out.push({ key: `${k}:${l.inning}`, label: `${player} @ ${position} · inn ${l.inning}`, ids: [l.id], player, position, allInnings: false });
        }
      }
    }
    // Stable sort: by player name, then position, then inning.
    out.sort((a, b) => a.player.localeCompare(b.player) || a.position.localeCompare(b.position) || a.label.localeCompare(b.label));
    return out;
  }, [locks, game]);

  const openAddLock = () => {
    setLockPlayerId("");
    setLockPosition("");
    // Start with no innings selected — coaches usually want a partial-game
    // lock (e.g. just innings 1-2 for a starting pitcher), and the previous
    // "all innings preselected" default meant they had to deselect first.
    setLockInnings(new Set());
    setLockError(null);
    setAddLockOpen(true);
  };

  const handleSaveLock = async () => {
    setLockError(null);
    if (!lockPlayerId) { setLockError("Pick a player."); return; }
    if (!lockPosition) { setLockError("Pick a position."); return; }
    if (lockInnings.size === 0) { setLockError("Pick at least one inning."); return; }
    // If every inning is selected, send `null` so the server takes the
    // "all innings" fast path (and the response phrasing stays nice).
    const totalInnings = game?.innings ?? 0;
    const sortedInnings = Array.from(lockInnings).sort((a, b) => a - b);
    const inningPayload: number | number[] | null =
      totalInnings > 0 && sortedInnings.length === totalInnings
        ? null
        : sortedInnings.length === 1
          ? sortedInnings[0]
          : sortedInnings;
    setLockSubmitting(true);
    try {
      const resp = await fetch(`${BASE}/api/games/${id}/locks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: parseInt(lockPlayerId, 10),
          position: lockPosition,
          inning: inningPayload,
        }),
      });
      if (!resp.ok) {
        let msg = `Request failed (${resp.status})`;
        try { const body = await resp.json(); if (body?.error) msg = body.error; } catch { /* keep default */ }
        setLockError(msg);
        return;
      }
      await refetchLocks();
      setAddLockOpen(false);
      toast({ title: "Lock added" });
      // Locks change what the generator can produce — clear any preview that
      // was built without them so the coach regenerates.
      setPreviewLineup(null);
    } catch {
      setLockError("Network error — try again.");
    } finally {
      setLockSubmitting(false);
    }
  };

  const handleRemoveLock = async (ids: number[]) => {
    let hadRealError = false;
    try {
      // Delete each row that backs this chip (an "all innings" chip is N rows).
      // A 404 means the row was already gone — that's the state we wanted, so
      // treat it as success rather than a failure that surfaces a scary toast.
      const results = await Promise.all(
        ids.map((lid) => fetch(`${BASE}/api/games/${id}/locks/${lid}`, { method: "DELETE" })),
      );
      hadRealError = results.some((r) => !r.ok && r.status !== 404);
    } catch {
      hadRealError = true;
    } finally {
      // Always resync — even on partial failure we don't want stale ids in
      // local state (which causes "ghost" 404s on the next click).
      await refetchLocks();
    }
    if (hadRealError) {
      // `hadRealError` is a boolean — the individual fetches were
      // logged but discarded above, so we don't have a specific
      // message to surface. Give the coach a useful next step
      // instead of just a destructive title.
      toast({
        title: "Couldn't remove some locks",
        description:
          "One or more locks failed to delete. The list has been refreshed — try again.",
        variant: "destructive",
      });
    } else {
      toast({ title: "Lock removed" });
    }
  };

  /**
   * Internal: actually open the Generate Lineup dialog. Split out so the
   * "always lock P/C" prompt can call this after the coach picks "Generate
   * anyway" without re-running the lock check.
   */
  const openGenerateDialog = () => {
    setSelectedPlayerIds(players.filter((p) => p.active).map((p) => p.id));
    setPreviewLineup(null);
    setGenerateOpen(true);
    // Reset the "user touched the slider" flag and bump the seed token so any
    // in-flight fetch from a prior open is ignored when it returns.
    equityTouchedRef.current = false;
    equitySeedTokenRef.current += 1;
    const myToken = equitySeedTokenRef.current;
    // Seed the fairness slider from the saved global constraint so the dialog
    // reflects the coach's last choice. Errors are non-fatal — the slider just
    // stays at its current value (defaulting to 50). Stale responses (newer
    // open, or user has already moved the slider) are dropped.
    void (async () => {
      try {
        const r = await fetch(`${BASE}/api/constraints`, { credentials: "same-origin" });
        if (!r.ok) return;
        const all: unknown = await r.json();
        if (!Array.isArray(all)) return;
        if (myToken !== equitySeedTokenRef.current) return;
        if (equityTouchedRef.current) return;
        const rows = (all as Array<{ type: string; value: number | null; active: boolean; createdAt: string }>)
          .filter((c) => c.type === "global_equity_weight" && c.active && typeof c.value === "number")
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        if (rows.length > 0 && typeof rows[0].value === "number") {
          setEquityValue(rows[0].value);
        } else {
          setEquityValue(50);
        }
      } catch {
        // ignore — slider keeps prior value
      }
    })();
  };

  /**
   * Coach-facing entry point for "Generate Lineup". If the coach turned on
   * "Always lock pitchers and catchers" in Settings AND any inning of this
   * game is missing a Pitcher or Catcher lock, we show a prompt first
   * (with options to set the locks, generate anyway, or cancel) instead of
   * jumping straight into the player-picker dialog.
   */
  const openGenerate = () => {
    // Race protection: both `prefs` and `locks` are async-loaded. If a
    // coach clicks Generate before either query settles we'd risk either
    // skipping the prompt (prefs not yet known to be ON) or firing it
    // incorrectly (locks not yet known to exist). Defer the click with a
    // brief toast — in practice both queries resolve in well under a
    // second so this branch is almost never hit.
    if (prefsLoading || locksLoading) {
      toast({
        title: "Just a moment…",
        description: "Loading your settings.",
      });
      return;
    }
    if (prefs?.alwaysLockPitcherCatcher && game) {
      // Compute which innings still need a P or C lock. We treat any lock
      // (single-inning or all-innings) at position P/C as fulfilling that
      // inning's requirement.
      const innings = game.innings;
      const pInnings = new Set<number>();
      const cInnings = new Set<number>();
      for (const l of locks) {
        if (l.position === "P") pInnings.add(l.inning);
        else if (l.position === "C") cInnings.add(l.inning);
      }
      const missingP: number[] = [];
      const missingC: number[] = [];
      for (let i = 1; i <= innings; i++) {
        if (!pInnings.has(i)) missingP.push(i);
        if (!cInnings.has(i)) missingC.push(i);
      }
      if (missingP.length > 0 || missingC.length > 0) {
        setLockPromptInnings({ p: missingP, c: missingC });
        return;
      }
    }
    openGenerateDialog();
  };

  /**
   * Open the "Edit Available Players" dialog. Pre-selects every player who
   * currently appears in the lineup (preview, edited, or saved). Coaches
   * uncheck a player to drop them from every inning at once (the fast fix
   * for "Henry just rolled his ankle"), or check a missing player to add
   * them to the bench in every inning so they can be dragged onto the
   * field.
   */
  const openEditAvailable = () => {
    const current = previewLineup ?? editedLineup ?? lineup;
    const inLineup = new Set(current.map((e) => e.playerId));
    setAvailableSelectedIds(
      players.filter((p) => p.active && inLineup.has(p.id)).map((p) => p.id),
    );
    setAvailableOpen(true);
  };

  /**
   * Apply the checklist from the "Edit Available Players" dialog to the
   * current lineup. Computes the diff vs. who's already in the lineup:
   *   - removed players → strip every entry across all innings
   *   - added players → insert a Bench entry in every inning (with a
   *     fresh negative id so the save endpoint treats them as new rows)
   * The result is staged into editedLineup (or replaces previewLineup if
   * we were previewing a generated lineup), so the coach can review and
   * save just like any other manual edit.
   */
  const handleApplyAvailable = () => {
    if (!game) return;
    const current = previewLineup ?? editedLineup ?? lineup;
    const currentIds = new Set(current.map((e) => e.playerId));
    const desired = new Set(availableSelectedIds);

    const toRemove: number[] = [];
    currentIds.forEach((pid) => {
      if (!desired.has(pid)) toRemove.push(pid);
    });
    const toAdd: number[] = [];
    desired.forEach((pid) => {
      if (!currentIds.has(pid)) toAdd.push(pid);
    });

    if (toRemove.length === 0 && toAdd.length === 0) {
      setAvailableOpen(false);
      return;
    }

    let next = current.filter((e) => !toRemove.includes(e.playerId));

    // Mint negative ids that don't collide with existing rows (saved entries
    // have positive ids; unsaved/preview entries already use negatives).
    let nextId =
      Math.min(0, ...next.map((e) => e.id)) - 1;
    const totalInnings = game.innings;
    for (const pid of toAdd) {
      const player = players.find((p) => p.id === pid);
      if (!player) continue;
      for (let inning = 1; inning <= totalInnings; inning++) {
        next = next.concat({
          id: nextId--,
          gameId: id,
          playerId: pid,
          playerName: player.name,
          inning,
          position: "Bench",
          battingOrder: null,
        });
      }
    }

    if (previewLineup) setPreviewLineup(next);
    else setEditedLineup(next);

    if (selectedEntryId != null && !next.some((e) => e.id === selectedEntryId)) {
      setSelectedEntryId(null);
    }

    setAvailableOpen(false);

    const parts: string[] = [];
    if (toRemove.length > 0) {
      const names = toRemove
        .map((pid) => players.find((p) => p.id === pid)?.name ?? "Player")
        .slice(0, 3)
        .join(", ");
      parts.push(
        `Removed ${toRemove.length === 1 ? names : `${toRemove.length} players`}${toRemove.length > 3 ? "" : ""}`,
      );
    }
    if (toAdd.length > 0) {
      const names = toAdd
        .map((pid) => players.find((p) => p.id === pid)?.name ?? "Player")
        .slice(0, 3)
        .join(", ");
      parts.push(
        `Added ${toAdd.length === 1 ? names : `${toAdd.length} players`} to bench`,
      );
    }
    toast({
      title: "Available players updated",
      description: `${parts.join(" · ")}. Review the lineup and save when you're ready.`,
    });
  };

  const openCopy = async () => {
    if (editedLineup || previewLineup) {
      const what = editedLineup ? "unsaved lineup edits" : "an unsaved lineup preview";
      const ok = await confirm({
        title: "Load a previous lineup?",
        description: `You have ${what}. Loading a previous lineup will replace them.`,
        confirmText: "Replace",
        variant: "destructive",
      });
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
    } catch (err) {
      toastError(toast, "Failed to load past games", err);
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
    } catch (err) {
      toastError(toast, "Failed to load that lineup", err);
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

  const openImage = async () => {
    if (editedLineup || previewLineup) {
      const what = editedLineup ? "unsaved lineup edits" : "an unsaved lineup preview";
      const ok = await confirm({
        title: "Import from screenshot?",
        description: `You have ${what}. Importing from a screenshot will replace them.`,
        confirmText: "Replace",
        variant: "destructive",
      });
      if (!ok) return;
      setEditedLineup(null);
      setPreviewLineup(null);
      setSelectedEntryId(null);
    }
    resetImageState();
    setImageOpen(true);
  };

  // Downscale an image File so we don't ship a 5MB phone photo over a stadium
  // LTE connection. Max 1280px on the long edge, JPEG q=0.85 — easily readable
  // by the vision model and typically 10-20× smaller than the raw upload.
  // Falls back to the original file if anything goes wrong.
  const downscaleImageFile = (file: File): Promise<{ dataUrl: string; mime: string }> =>
    new Promise((resolve) => {
      const fallback = (reason: string) => {
        const fr = new FileReader();
        fr.onerror = () => resolve({ dataUrl: "", mime: file.type });
        fr.onload = () => {
          const dataUrl = String(fr.result ?? "");
          if (!dataUrl) {
            console.warn(`[image-import] fallback failed: ${reason}`);
            resolve({ dataUrl: "", mime: file.type });
          } else {
            resolve({ dataUrl, mime: file.type === "image/jpg" ? "image/jpeg" : file.type });
          }
        };
        fr.readAsDataURL(file);
      };
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onerror = () => {
        URL.revokeObjectURL(url);
        fallback("image decode failed");
      };
      img.onload = () => {
        try {
          const MAX = 1280;
          const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            URL.revokeObjectURL(url);
            fallback("no 2d context");
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          // Always re-encode as JPEG: smaller than PNG for photos and screenshots
          // of UIs with anti-aliased text alike, and the vision model doesn't care.
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          URL.revokeObjectURL(url);
          if (!dataUrl || !dataUrl.startsWith("data:image/jpeg")) {
            fallback("canvas export failed");
            return;
          }
          resolve({ dataUrl, mime: "image/jpeg" });
        } catch (err) {
          URL.revokeObjectURL(url);
          fallback(`exception: ${String(err)}`);
        }
      };
      img.src = url;
    });

  // Read a File into a base64 data URL we can preview AND ship to the server.
  const ingestImageFile = async (file: File) => {
    setImageError(null);
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
      setImageError(`Unsupported file type "${file.type || "unknown"}". Use PNG, JPEG, or WebP.`);
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setImageError(`Image is too large (${Math.round(file.size / 1024 / 1024)} MB). Max is 6 MB.`);
      return;
    }
    const { dataUrl, mime } = await downscaleImageFile(file);
    if (!dataUrl) {
      setImageError("Could not read that file.");
      return;
    }
    const commaAt = dataUrl.indexOf(",");
    if (commaAt < 0) {
      setImageError("Could not read that file.");
      return;
    }
    setImageDataUrl(dataUrl);
    setImageMime(mime === "image/jpg" ? "image/jpeg" : mime);
    setImageBase64(dataUrl.slice(commaAt + 1));
    setImageFileName(file.name || "screenshot");
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
      const parsedLineup: typeof previewLineup = data.lineup ?? [];
      const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
      if (!parsedLineup || parsedLineup.length === 0) {
        setImageError(
          warnings[0] || "I couldn't read a lineup from that image. Try a clearer screenshot.",
        );
        return;
      }
      setImageOpen(false);
      resetImageState();
      // If there is a saved lineup already, the coach is overriding the plan
      // with what actually happened. Ask whether to keep the original plan as
      // a snapshot before replacing. If there is NO saved lineup, fall back to
      // the existing preview-and-review flow.
      if (lineup.length > 0) {
        setPendingPhotoLineup(parsedLineup);
        setReplaceConfirmOpen(true);
        if (warnings.length) {
          toast({
            title: `Imported ${parsedLineup.length} entries`,
            description: warnings.join(" · "),
          });
        }
      } else {
        setPreviewLineup(parsedLineup);
        toast({
          title: `Imported ${parsedLineup.length} entries — review and save`,
          description: warnings.length ? warnings.join(" · ") : undefined,
        });
      }
    } catch {
      setImageError("The import service is unavailable. Try again in a moment.");
    } finally {
      setImageExtracting(false);
    }
  };

  const handleGenerate = async () => {
    if (selectedPlayerIds.length === 0) {
      toast({ title: "Select at least one player", variant: "destructive" });
      return;
    }
    if (editedLineup) {
      const ok = await confirm({
        title: "Discard your edits?",
        description: "You have unsaved lineup edits. Generating a new lineup will discard them.",
        confirmText: "Discard and generate",
        variant: "destructive",
      });
      if (!ok) return;
      setEditedLineup(null);
      setSelectedEntryId(null);
    }
    // Persist the dialog's fairness value back to the global_equity_weight
    // constraint before generating, so the server-side generator reads the
    // up-to-date dial. Single-row invariant: delete any existing rows of this
    // type, then post a fresh one. We surface a toast on persistence failure
    // (so the coach knows the dial change didn't stick) but still proceed with
    // generation using whatever the server already has.
    setGenerating(true);
    let persistOk = true;
    try {
      const v = Math.max(0, Math.min(100, Math.round(equityValue)));
      const description =
        v <= 25
          ? `Generator favors best lineup (fairness ${v}/100)`
          : v >= 75
            ? `Generator favors equal playing time (fairness ${v}/100)`
            : `Balanced lineup vs fairness (${v}/100)`;
      const listResp = await fetch(`${BASE}/api/constraints`, { credentials: "same-origin" });
      if (!listResp.ok) {
        persistOk = false;
      } else {
        const all: unknown = await listResp.json();
        if (Array.isArray(all)) {
          const stale = (all as Array<{ id: number; type: string }>).filter(
            (c) => c.type === "global_equity_weight",
          );
          const delResults = await Promise.all(
            stale.map((c) =>
              fetch(`${BASE}/api/constraints/${c.id}`, { method: "DELETE" }),
            ),
          );
          if (delResults.some((r) => !r.ok)) persistOk = false;
        } else {
          persistOk = false;
        }
      }
      const postResp = await fetch(`${BASE}/api/constraints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "global_equity_weight",
          rule: "weight",
          value: v,
          description,
          active: true,
        }),
      });
      if (!postResp.ok) persistOk = false;
    } catch {
      persistOk = false;
    }
    if (!persistOk) {
      toast({
        title: "Couldn't save fairness setting",
        description: "Generating with the previously saved value.",
        variant: "destructive",
      });
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
          // Stash as a preview; the autosave effect below picks it up
          // and POSTs to the server right away so the coach doesn't have
          // to click "Save Lineup" before navigating away.
          setPreviewLineup(result);
        },
        onError: (err: unknown) => {
          // Orval throws an AxiosError-like with .response.data on non-2xx;
          // surface the server's friendly message (e.g. understaffed-inning
          // 409s from the locks feasibility check) so the coach knows what
          // to fix instead of a generic "failed".
          const data = (err as { response?: { data?: { error?: string } } } | null)?.response?.data;
          const msg = data?.error;
          toast({
            title: "Failed to generate lineup",
            description: msg,
            variant: "destructive",
          });
        },
        onSettled: () => {
          setGenerating(false);
        },
      }
    );
  };

  const handleAskAi = async () => {
    const message = aiInput.trim();
    if (!message) return;
    if (editedLineup || previewLineup) {
      const what = editedLineup ? "unsaved lineup edits" : "an unsaved lineup preview";
      const ok = await confirm({
        title: "Ask the assistant?",
        description: `You have ${what}. Asking the assistant to regenerate may replace them.`,
        confirmText: "Continue",
      });
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
        if (typeof data.memoryCount === "number") {
          setAiMemoryCount(data.memoryCount);
        } else {
          void refetchAiMemory();
        }
        // New preview → re-show the equity hint with fresh numbers.
        setEquityDismissed(false);
      } else if (data.kind === "remove") {
        // Strip the named players from whichever lineup is on screen
        // (preview / edited / saved). Field cells they held become empty
        // cells the coach can refill or save as-is — same behavior as the
        // tally trash icon and the chip-selection Remove button, just
        // driven by natural language ("Henry got hurt, take him out").
        // Read the LATEST lineup via refs (not closure) so a response that
        // lands after the coach made local edits doesn't clobber them.
        const removeIds: number[] = Array.isArray(data.removePlayerIds)
          ? data.removePlayerIds.filter((n: unknown) => typeof n === "number")
          : [];
        const livePreview = previewLineupRef.current;
        const liveEdited = editedLineupRef.current;
        const current = livePreview ?? liveEdited ?? lineupRef.current;
        const next = current.filter((e) => !removeIds.includes(e.playerId));
        if (next.length !== current.length) {
          if (livePreview) setPreviewLineup(next);
          else setEditedLineup(next);
          if (selectedEntryId != null && !next.some((e) => e.id === selectedEntryId)) {
            setSelectedEntryId(null);
          }
        }
        setAiAnswer(data.explanation);
        setAiInput("");
        if (typeof data.memoryCount === "number") {
          setAiMemoryCount(data.memoryCount);
        } else {
          void refetchAiMemory();
        }
        // Removed players → equity numbers shift; let the hint re-evaluate.
        setEquityDismissed(false);
        const names: string[] = Array.isArray(data.removedPlayerNames)
          ? data.removedPlayerNames.filter((s: unknown) => typeof s === "string")
          : [];
        if (names.length > 0) {
          // If the server couldn't clear AI memory, warn the coach loudly —
          // otherwise the next regenerate will quietly resurrect the player.
          const memoryWarning = data.memoryCleared === false;
          toast({
            title:
              names.length === 1
                ? `${names[0]} removed from lineup`
                : `${names.length} players removed from lineup`,
            description: memoryWarning
              ? "Heads up — couldn't clear AI memory. They may come back on the next regenerate; tap Reset on the AI memory chip to be safe."
              : "Review the empty slots and save when you're ready.",
            variant: memoryWarning ? "destructive" : undefined,
          });
        }
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

  // Apply the parsed photo lineup over the saved lineup.
  // keepPlan=true → snapshot the current saved lineup first so the coach can
  // still see what they originally planned. keepPlan=false → just overwrite.
  const applyPhotoOverride = async (keepPlan: boolean) => {
    if (!pendingPhotoLineup) return;
    const photo = pendingPhotoLineup;
    setReplaceConfirmOpen(false);
    setPendingPhotoLineup(null);
    if (keepPlan) {
      try {
        await snapshotPlan.mutateAsync({ id });
        // Refresh the cached game so planSnapshot shows up in the UI
        // immediately and the "View Original Plan" button appears.
        await qc.invalidateQueries({ queryKey: getGetGameQueryKey(id) });
      } catch {
        // The coach explicitly asked to preserve their original plan.
        // If we silently replaced anyway, we'd lose the very thing they
        // were trying to keep. Abort the override and put the parsed
        // photo lineup back in the dialog so they can retry or fall
        // back to "Replace".
        setPendingPhotoLineup(photo);
        setReplaceConfirmOpen(true);
        toast({
          title: "Couldn't save the original plan",
          description: "Lineup not replaced. Try again or pick Replace.",
          variant: "destructive",
        });
        return;
      }
    }
    handleSaveLineup(photo);
  };

  const handleClearSnapshot = () => {
    clearPlanSnapshot.mutate(
      { id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGameQueryKey(id) });
          setViewPlanOpen(false);
          toast({ title: "Original plan discarded" });
        },
        onError: (err) => toastError(toast, "Failed to clear snapshot", err),
      },
    );
  };

  const handleSaveLineup = (
    lineupToSave: typeof lineup,
    opts?: { silent?: boolean },
  ) => {
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
        onSuccess: (savedEntries) => {
          // Jump the lineup cache straight to the saved state. The
          // POST endpoint returns the full set of entries, so we can
          // skip the invalidate → background refetch round-trip —
          // which otherwise leaves a few hundred ms where the cached
          // lineup is still the pre-save snapshot and the UI flashes
          // back to the old positions before the refetch lands.
          qc.setQueryData(getGetGameLineupQueryKey(id), savedEntries);
          qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() });
          // Stamp the SavedIndicator with the moment the server
          // acknowledged the write so the header chip flips to
          // "Saved just now" — both for explicit saves and silent
          // auto-saves.
          setLastLineupSavedAt(Date.now());
          if (!opts?.silent) toast({ title: "Lineup saved" });
          setGenerateOpen(false);
          // Only clear the staged state if it's STILL the value we
          // just saved. If the coach kept editing while the save was
          // in flight (drag → 800ms → save kicks off → drag again),
          // editedLineup is now a NEW reference holding their newer
          // edits — wiping it to null would silently lose those
          // changes and the next autosave wouldn't fire because the
          // effect's dep array would see editedLineup go from null
          // to … null. Reference-equality on the saved snapshot is
          // exactly what we want: clear iff no further edits.
          setPreviewLineup((cur) => (cur === lineupToSave ? null : cur));
          setEditedLineup((cur) => (cur === lineupToSave ? null : cur));
          setSelectedEntryId(null);
        },
        onError: (err) => {
          // The save may actually have landed server-side and we just
          // lost the response (Wi-Fi blip, sleeping laptop, etc.).
          // Refetch the lineup so the UI reconciles with the server —
          // if our edits are there, the coach sees them stay on screen
          // and can verify before reacting to the toast.
          qc.invalidateQueries({ queryKey: getGetGameLineupQueryKey(id) });
          const detail =
            err instanceof Error && err.message ? err.message : "Unknown error";
          toast({
            title: "Failed to save lineup",
            description: `${detail}. The lineup was refreshed — check whether your changes are there before retrying.`,
            variant: "destructive",
          });
        },
      }
    );
  };

  // Keep the latest `handleSaveLineup` callable via a ref so the
  // autosave effects below don't need to list every dep the handler
  // closes over (`saveLineup`, `qc`, `id`, setters, `toast`, …). They
  // just want "call whatever the current handler is" when the lineup
  // state changes.
  const handleSaveLineupRef = useRef(handleSaveLineup);
  handleSaveLineupRef.current = handleSaveLineup;

  // ── Autosave: generated / AI / photo previews ──────────────────────
  // As soon as a fresh preview lineup lands (Generate button, AI
  // regenerate, photo override path), POST it to the server. The
  // save's `onSuccess` clears `previewLineup`, so this effect can't
  // loop, and `saveLineup.isPending` gate prevents stacking saves if
  // a new preview arrives mid-flight.
  useEffect(() => {
    if (!previewLineup || !canEditLineup) return;
    if (saveLineup.isPending) return;
    handleSaveLineupRef.current(previewLineup);
  }, [previewLineup, canEditLineup, saveLineup.isPending]);

  // ── Autosave: manual edits (drag-drop swaps, position changes) ─────
  // Debounce so a flurry of swaps batches into ONE POST instead of
  // one per drop. Silent on success — the saved state appears in the
  // grid naturally, and toasting on every edit would be noisy. Errors
  // still toast via `handleSaveLineup`'s onError.
  useEffect(() => {
    if (!editedLineup || !canEditLineup) return;
    const t = setTimeout(() => {
      handleSaveLineupRef.current(editedLineup, { silent: true });
    }, 800);
    return () => clearTimeout(t);
  }, [editedLineup, canEditLineup]);

  /**
   * Pull a player out of the displayed lineup entirely (e.g. injury, early
   * departure). Drops every entry for that player across every inning. Field
   * positions they were holding become empty cells the coach can refill by
   * dragging another player in or regenerating. Acts on whichever lineup is
   * currently on screen — preview, edited, or saved (in the saved case it
   * seeds `editedLineup` so the change is reviewable + savable).
   */
  const handleRemovePlayerFromLineup = async (playerId: number, playerName: string) => {
    const current = previewLineup ?? editedLineup ?? lineup;
    const innings = new Set(current.filter((e) => e.playerId === playerId).map((e) => e.inning));
    if (innings.size === 0) return;
    const ok = await confirm({
      title: `Remove ${playerName} from this lineup?`,
      description: `They'll be cleared from all ${innings.size} inning${innings.size === 1 ? "" : "s"} they appear in. Use this for injuries or mid-game departures.`,
      confirmText: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    const next = current.filter((e) => e.playerId !== playerId);
    if (previewLineup) setPreviewLineup(next);
    else setEditedLineup(next);
    if (selectedEntryId != null) {
      const stillThere = next.some((e) => e.id === selectedEntryId);
      if (!stillThere) setSelectedEntryId(null);
    }
    toast({
      title: `${playerName} removed from lineup`,
      description: "Review the empty slots and save when you're ready.",
    });
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

  /**
   * Add a roster player to an empty (inning, position) slot from the picker.
   * If the player already has an entry in that inning (bench or another
   * field position), we just move that entry to the target position so we
   * don't end up with the same player in two slots in one inning. Otherwise
   * we mint a fresh negative-id entry. Result is staged into preview /
   * edited so the coach saves normally.
   */
  const addPlayerToSlot = (
    playerId: number,
    inning: number,
    position: string,
  ) => {
    const current = previewLineup ?? editedLineup ?? lineup;
    const existing = current.find(
      (e) => e.inning === inning && e.playerId === playerId,
    );
    let next: typeof current;
    if (existing) {
      // Same player already in this inning → just move their entry. Avoids
      // duplicate (player, inning) rows that the server would reject.
      if (existing.position === position) {
        setAddSlotTarget(null);
        return;
      }
      next = current.map((e) =>
        e.id === existing.id ? { ...e, position } : e,
      );
    } else {
      const player = players.find((p) => p.id === playerId);
      if (!player) return;
      const nextId = Math.min(0, ...current.map((e) => e.id)) - 1;
      next = current.concat([
        {
          id: nextId,
          gameId: id,
          playerId: player.id,
          playerName: player.name,
          inning,
          position,
          battingOrder: null,
        },
      ]);
    }
    if (previewLineup) setPreviewLineup(next);
    else setEditedLineup(next);
    setAddSlotTarget(null);
  };

  // Tap-to-select fallback (kept alongside drag-and-drop for accessibility / quick taps).
  const handleCellClick = (target: { entryId?: number; inning: number; position: string }) => {
    // A drop just finished — ignore the synthetic click the browser fires
    // afterward so the "add player" picker doesn't pop up over the move.
    if (justFinishedDragging()) return;
    if (selectedEntryId == null) {
      if (target.entryId != null) {
        setSelectedEntryId(target.entryId);
      } else {
        // Empty cell tapped with nothing selected → open picker so coach can
        // assign a player without needing to drag-and-drop.
        setAddSlotTarget({ inning: target.inning, position: target.position });
      }
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
    lastDragEndAtRef.current = Date.now();
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
    lastDragEndAtRef.current = Date.now();
  };

  // Returns true if a drag finished within the last 300 ms. The synthetic
  // click that browsers fire after a touch-drag ends would otherwise open
  // the "add player" picker right on top of the slot you just dropped into.
  const justFinishedDragging = () => Date.now() - lastDragEndAtRef.current < 300;

  // Shared TSV → clipboard helper used by both lineup and tally copy buttons.
  // Tries the modern Clipboard API first, then falls back to a hidden textarea
  // + execCommand for older browsers / non-secure contexts.
  const writeTsvToClipboard = async (tsv: string, successMsg: string): Promise<void> => {
    const showSuccess = () =>
      toast({ title: successMsg, description: "Paste it into Google Sheets." });
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tsv);
        showSuccess();
        return;
      }
      throw new Error("Clipboard API unavailable");
    } catch {
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
        // fall through
      }
      toast({ title: "Copy failed — clipboard not available", variant: "destructive" });
    }
  };

  const handleCopyTally = async () => {
    if (tallyRows.length === 0) {
      toast({ title: "No tally to copy yet", variant: "destructive" });
      return;
    }
    const header = ["Player", ...tallyCategories.map((c) => c.label), "Bench", "Out", "Total"].join("\t");
    const rows = tallyRows.map((r) => {
      const catCells = tallyCategories.map((c) => r.counts[c.key] ?? 0);
      const total = catCells.reduce((s, n) => s + n, 0) + r.Bench + r.Out;
      return [r.playerName, ...catCells, r.Bench, r.Out, total].map(String).join("\t");
    });
    const tsv = [header, ...rows].join("\n");
    await writeTsvToClipboard(tsv, "Tally copied");
  };

  const handleCopyLineup = async () => {
    const data = previewLineup ?? editedLineup ?? lineup;
    if (data.length === 0) {
      toast({ title: "Nothing to copy yet", variant: "destructive" });
      return;
    }
    const inningCount = game?.innings ?? 6;

    // ── Top block: inning grid ──────────────────────────────────
    // Bench column lists every benched player for the inning, comma-separated,
    // labeled "Bench (SIT)" so a coach pasting into Sheets can tell at a
    // glance which kids are sitting that inning.
    const inningHeader = [sportProfile.periodLabel, ...displayPositions, "Bench (SIT)"].join("\t");
    const inningRows = Array.from({ length: inningCount }, (_, i) => i + 1).map((inning) => {
      const cells = displayPositions.map((pos) => {
        const e = data.find((x) => x.inning === inning && x.position === pos);
        return e ? e.playerName : "";
      });
      const bench = data
        .filter((x) => x.inning === inning && x.position === "Bench")
        .map((x) => x.playerName)
        .join(", ");
      return [String(inning), ...cells, bench].join("\t");
    });

    // ── Bottom block: per-player tally + batting order side-by-side ──
    // Tally on the left (cols A-E), one empty column (F) as a visual buffer,
    // then the batting order down column G ("Lineup").
    //
    // Batting order is taken from each player's earliest field entry's
    // battingOrder. Players who only ever benched (no battingOrder anywhere
    // in `data`) get sorted to the end in name order so the column still
    // covers everyone on the roster for that game.
    const lineupNames = battingOrderRows.map((r) => r.playerName);

    const tallyHeader = ["Player", ...tallyCategories.map((c) => c.label), "Bench", "", "Lineup"];
    const emptyCells = tallyCategories.map(() => "");
    const dataRowCount = Math.max(tallyRows.length, lineupNames.length);
    const bottomRows: string[] = [tallyHeader.join("\t")];
    for (let i = 0; i < dataRowCount; i++) {
      const t = tallyRows[i];
      const lineupCell = lineupNames[i] ?? "";
      const cells = t
        ? [
            t.playerName,
            ...tallyCategories.map((c) => String(t.counts[c.key] ?? 0)),
            String(t.Bench),
            "",
            lineupCell,
          ]
        : ["", ...emptyCells, "", "", lineupCell];
      bottomRows.push(cells.join("\t"));
    }

    // ── Third block: per-position innings ─────────────────────────
    // For each player, count innings at each individual field position
    // (P, C, 1B, …) plus Bench. Counted at most once per (player, inning)
    // — mirrors the tallyRows logic so totals match. Gives the coach a
    // detailed record next to the rolled-up Pitching/Infield/Outfield
    // tally above. Player rows are sorted by name so the block lines up
    // with the tally block when read side-by-side.
    type PosRow = { playerName: string; counts: Record<string, number> };
    const posCols = [...displayPositions, "Bench"] as readonly string[];
    const posMap = new Map<number, PosRow>();
    const seenPI = new Set<string>();
    for (const e of data) {
      const k = `${e.playerId}:${e.inning}`;
      if (seenPI.has(k)) continue;
      seenPI.add(k);
      let row = posMap.get(e.playerId);
      if (!row) {
        row = { playerName: e.playerName, counts: {} };
        for (const c of posCols) row.counts[c] = 0;
        posMap.set(e.playerId, row);
      }
      if (Object.prototype.hasOwnProperty.call(row.counts, e.position)) {
        row.counts[e.position] = (row.counts[e.position] ?? 0) + 1;
      }
    }
    const posRows = Array.from(posMap.values()).sort((a, b) =>
      a.playerName.localeCompare(b.playerName)
    );
    const posHeader = ["Player", ...posCols, "Total"].join("\t");
    const posBody = posRows.map((r) => {
      const cells = posCols.map((c) => String(r.counts[c] ?? 0));
      const total = posCols.reduce((s, c) => s + (r.counts[c] ?? 0), 0);
      return [r.playerName, ...cells, String(total)].join("\t");
    });

    // Blank line between blocks so each lands as its own table when
    // pasted into Sheets. Order: defensive grid → tally + lineup → per-
    // position innings.
    const tsv = [
      inningHeader,
      ...inningRows,
      "",
      ...bottomRows,
      "",
      posHeader,
      ...posBody,
    ].join("\n");
    await writeTsvToClipboard(
      tsv,
      "Lineup copied — defensive grid, batting order, and innings by position"
    );
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
          // Marking a game complete is the exact transition that flips its
          // lineup entries from "ignored by stats" (status='upcoming') to
          // "counted by stats" (status='completed'), so the cached season +
          // player stats must be invalidated or the dashboard / Stats page
          // would keep showing pre-completion numbers until manual refresh.
          qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() });
          toast({ title: "Game marked as completed" });
          setCompleteOpen(false);
        },
        onError: (err) => toastError(toast, "Failed to update game", err),
      }
    );
  };

  /**
   * One-click "remove the last inning" — used by the trash icon on the
   * lineup grid's last inning row so the coach doesn't have to open the
   * Game Ended Early dialog every time. Server cascades the delete to
   * lineup entries, locks, and AI pins for that inning. We confirm in
   * place because it's destructive and can't be undone.
   */
  const handleRemoveLastInning = async () => {
    if (!game || game.innings <= 1) return;
    const removed = game.innings;
    const ok = await confirm({
      title: `Remove inning ${removed}?`,
      description: "Any players, locks, or assistant pins for that inning will be deleted.",
      confirmText: "Remove inning",
      variant: "destructive",
    });
    if (!ok) return;
    updateGame.mutate(
      { id, data: { innings: removed - 1 } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGameQueryKey(id) });
          qc.invalidateQueries({ queryKey: getGetGameLineupQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() });
          // Clear any unsaved edit/preview that referenced the removed inning
          // so the grid re-derives from the server's trimmed lineup.
          setEditedLineup(null);
          setPreviewLineup(null);
          toast({
            title: `Inning ${removed} removed`,
            description: `Game is now ${removed - 1} inning${removed - 1 === 1 ? "" : "s"} long.`,
          });
        },
        onError: (err) => toastError(toast, "Failed to remove inning", err),
      },
    );
  };

  const handleEndEarly = () => {
    const last = parseInt(endEarlyLastInning);
    if (!Number.isFinite(last) || last < 1 || last >= (game?.innings ?? 0)) return;
    updateGame.mutate(
      { id, data: { innings: last } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGameQueryKey(id) });
          qc.invalidateQueries({ queryKey: getGetGameLineupQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetSeasonStatsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPlayerStatsQueryKey() });
          // Drop unsaved drag/preview state so a later "Save" can't re-insert
          // entries for innings the server just deleted (the save endpoint
          // delete+reinserts whatever the client sends).
          setEditedLineup(null);
          setPreviewLineup(null);
          setSelectedEntryId(null);
          toast({ title: `Game shortened to ${last} inning${last === 1 ? "" : "s"}` });
          setEndEarlyOpen(false);
          setEndEarlyLastInning("");
        },
        onError: (err) => toastError(toast, "Failed to shorten game", err),
      },
    );
  };

  const innings = game?.innings ?? 6;
  // Keep the mobile single-inning picker in range when the game length
  // changes (e.g. coach trims via "Game ended early" or removes the last
  // inning from the grid header).
  useEffect(() => {
    if (mobileActiveInning > innings) setMobileActiveInning(innings);
    if (mobileActiveInning < 1) setMobileActiveInning(1);
  }, [innings, mobileActiveInning]);
  const displayLineup = previewLineup ?? editedLineup ?? lineup;
  // Columns to render in the lineup grid (and any per-position iteration:
  // copy-for-Sheets, batting-row defensive list, lock dropdown). Starts from
  // the team's chosen active positions, then unions in any position that
  // already appears in the lineup data — so a historical game saved when
  // the team used CF still renders its CF column even if the team has
  // since switched to LCF/RCF (and vice versa). Always sorted in canonical
  // L→R order so the grid reads left-to-right consistently.
  const displayPositions = useMemo<readonly string[]>(() => {
    if (sport === "basketball") {
      // Basketball ignores the baseball activeFieldPositions; its court spots
      // come straight from the sport profile (PG/SG/SF/PF/C). Any stray
      // position present on saved entries is appended so old data isn't lost.
      const order = sportPositionCodes("basketball");
      const present = new Set<string>(order);
      for (const e of displayLineup) if (e.position !== "Bench") present.add(e.position);
      const extras = [...present].filter((p) => !order.includes(p));
      return [...order, ...extras];
    }
    const present = new Set<string>(activeFieldPositions);
    for (const e of displayLineup) if (e.position !== "Bench") present.add(e.position);
    return POSITION_DISPLAY_ORDER.filter((p) => present.has(p));
  }, [activeFieldPositions, displayLineup, sport]);
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

  // Equity insights: scan the current lineup for the most useful "this isn't
  // fair yet" call-outs the coach can act on. Pure client-side derivation
  // from the rendered lineup so it always reflects what's on screen
  // (preview > unsaved edits > saved).
  //
  // Surfaced (in priority order, capped to a handful of items):
  //   1. Players with notably more bench innings than their teammates.
  //   2. Players who haven't seen the infield (P/C/1B/2B/3B/SS) at all.
  //   3. Players who haven't seen the outfield (LF/CF/RF) at all.
  // We only show players who appear in the lineup at least once so newly
  // added roster members aren't flagged on a lineup they weren't part of.
  const equityInsights = useMemo(() => {
    if (displayLineup.length === 0 || !game) {
      return { items: [] as Array<{ key: string; text: string }>, totalPlayers: 0 };
    }
    type Stats = {
      playerId: number;
      playerName: string;
      bench: number;
      infield: number;
      outfield: number;
      pitching: number;
      field: number;
    };
    const byPlayer = new Map<number, Stats>();
    const seenPlayerInning = new Set<string>();
    for (const e of displayLineup) {
      const dedupeKey = `${e.playerId}:${e.inning}`;
      if (seenPlayerInning.has(dedupeKey)) continue;
      seenPlayerInning.add(dedupeKey);
      let s = byPlayer.get(e.playerId);
      if (!s) {
        s = {
          playerId: e.playerId,
          playerName: e.playerName,
          bench: 0,
          infield: 0,
          outfield: 0,
          pitching: 0,
          field: 0,
        };
        byPlayer.set(e.playerId, s);
      }
      const cat = categoryForPos(e.position, sport);
      if (cat === "Bench") s.bench += 1;
      else {
        s.field += 1;
        if (cat === "Infield") s.infield += 1;
        else if (cat === "Outfield") s.outfield += 1;
        else if (cat === "Pitching") s.pitching += 1;
      }
    }
    const stats = Array.from(byPlayer.values());
    if (stats.length === 0) {
      return { items: [] as Array<{ key: string; text: string }>, totalPlayers: 0 };
    }
    const items: Array<{ key: string; text: string; weight: number }> = [];

    // (1) Bench equity — flag anyone sitting > 1 inning more than the team min.
    const minBench = Math.min(...stats.map((s) => s.bench));
    const benchOver = stats
      .filter((s) => s.bench - minBench >= 2)
      .sort((a, b) => b.bench - a.bench || a.playerName.localeCompare(b.playerName));
    for (const s of benchOver) {
      const diff = s.bench - minBench;
      items.push({
        key: `bench-${s.playerId}`,
        text: `${s.playerName} sits ${s.bench} innings — ${diff} more than the player who sits the least. Consider getting them on the field more.`,
        weight: 100 + diff,
      });
    }

    // (2) Hasn't played the infield at all (only flag if they have any field
    // time so we're not nagging about kids whose positions skew bench-heavy).
    const noInfield = stats
      .filter((s) => s.field > 0 && s.infield === 0)
      .sort((a, b) => a.playerName.localeCompare(b.playerName));
    for (const s of noInfield) {
      items.push({
        key: `infield-${s.playerId}`,
        text: `${s.playerName} hasn't played any infield this game.`,
        weight: 50,
      });
    }

    // (3) Hasn't played the outfield at all.
    const noOutfield = stats
      .filter((s) => s.field > 0 && s.outfield === 0)
      .sort((a, b) => a.playerName.localeCompare(b.playerName));
    for (const s of noOutfield) {
      items.push({
        key: `outfield-${s.playerId}`,
        text: `${s.playerName} hasn't played any outfield this game.`,
        weight: 30,
      });
    }

    items.sort((a, b) => b.weight - a.weight);
    return {
      items: items.slice(0, 5).map((i) => ({ key: i.key, text: i.text })),
      totalPlayers: stats.length,
    };
  }, [displayLineup, game]);

  // Reset the dismissal whenever the underlying saved lineup changes (a save
  // landed, a new game was opened, etc.) so a fresh round of insights gets a
  // fresh chance to be seen.
  useEffect(() => {
    setEquityDismissed(false);
  }, [lineup]);
  // Also reset on every new preview, regardless of how it arrived (manual
  // generate, copy-from-previous, screenshot import, AI). Hooking the
  // transition here keeps the dismissal logic in one place rather than
  // touching every setPreviewLineup call site.
  useEffect(() => {
    if (previewLineup) setEquityDismissed(false);
  }, [previewLineup]);

  // Per-player innings count by category, for the "Innings by Position" tally below.
  // Counted at most once per (player, inning) so totals never exceed the game's
  // innings even if upstream data accidentally lists a player twice in one inning.
  // "Out" tracks innings where the player has no entry at all (e.g. a kid who
  // showed up late or left early, or a photo import that didn't pick up their
  // name) so each row's total still adds up to the full game length.
  const tallyCategories = TALLY_CATEGORIES[sport];
  const tallyRows = useMemo(() => {
    type Row = {
      playerId: number;
      playerName: string;
      /** Per-category period counts (keys are the sport's category keys). */
      counts: Record<string, number>;
      Bench: number;
      Out: number;
    };
    const map = new Map<number, Row>();
    const seen = new Set<string>();
    for (const e of displayLineup) {
      const key = `${e.playerId}:${e.inning}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let row = map.get(e.playerId);
      if (!row) {
        row = {
          playerId: e.playerId,
          playerName: e.playerName,
          counts: Object.fromEntries(tallyCategories.map((c) => [c.key, 0])),
          Bench: 0,
          Out: 0,
        };
        map.set(e.playerId, row);
      }
      const cat = categoryForPos(e.position, sport);
      if (cat === "Bench") row.Bench += 1;
      else row.counts[cat] = (row.counts[cat] ?? 0) + 1;
    }
    for (const row of map.values()) {
      const counted =
        tallyCategories.reduce((s, c) => s + (row.counts[c.key] ?? 0), 0) + row.Bench;
      row.Out = Math.max(0, innings - counted);
    }
    return Array.from(map.values()).sort((a, b) => a.playerName.localeCompare(b.playerName));
  }, [displayLineup, innings, sport, tallyCategories]);

  /**
   * Reorder the batting lineup by moving the player at `fromIndex` to
   * `toIndex` (drag-and-drop). Rewrites battingOrder on every non-bench
   * entry across every inning so the new order applies for the whole game,
   * then stages into editedLineup (or previewLineup if previewing) so the
   * existing Save button picks it up.
   */
  const reorderBattingLineup = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const ids = arrayMove(battingOrderRows.map((r) => r.playerId), fromIndex, toIndex);
    const newOrderById = new Map<number, number>();
    ids.forEach((pid, i) => newOrderById.set(pid, i + 1));

    const data = previewLineup ?? editedLineup ?? lineup;
    // Write the new slot to EVERY entry for the player, including bench
    // innings. The old "if Bench → null" shortcut meant a bench-only
    // extra (e.g. the 11th player in nine-man mode, who never takes the
    // field) couldn't be dragged up the order — every entry kept
    // battingOrder=null, so the next render re-derived their slot from
    // the alphabetical fallback and they snapped right back to the
    // bottom. Carrying battingOrder on bench entries is harmless: the
    // batting-order memo collapses per-player using the first non-null
    // slot it finds, and `position === "Bench"` is what marks them
    // benched on the field grid (separate field from battingOrder).
    const next = data.map((e) => ({
      ...e,
      battingOrder: newOrderById.get(e.playerId) ?? e.battingOrder ?? null,
    }));
    if (previewLineup) setPreviewLineup(next);
    else setEditedLineup(next);
  };

  // Batting order rows for this game, derived from the current displayLineup
  // (preview > edited > saved). Each non-bench entry carries a battingOrder
  // assigned by the generator; we collapse duplicates per player using the
  // first non-null order we see. Players who only ever benched (no order
  // anywhere) get appended at the bottom in name order so the list still
  // covers the full game roster.
  //
  // Each row also includes `positions` — the distinct field positions the
  // player plays in this game, in their natural displayPositions order — so
  // the batting card can show coaches a quick "where they're playing" hint
  // next to the name without making them cross-reference the inning grid.
  const battingOrderRows = useMemo(() => {
    type Row = {
      playerId: number;
      playerName: string;
      order: number | null;
      positions: string[];
    };
    const byPlayer = new Map<number, Row & { _posSet: Set<string> }>();
    for (const e of displayLineup) {
      const incoming = e.battingOrder ?? null;
      let row = byPlayer.get(e.playerId);
      if (!row) {
        row = {
          playerId: e.playerId,
          playerName: e.playerName,
          order: incoming,
          positions: [],
          _posSet: new Set(),
        };
        byPlayer.set(e.playerId, row);
      } else if (row.order == null && incoming != null) {
        row.order = incoming;
      }
      if (e.position !== "Bench") row._posSet.add(e.position);
    }
    const rows: Row[] = Array.from(byPlayer.values()).map((r) => ({
      playerId: r.playerId,
      playerName: r.playerName,
      order: r.order,
      positions: displayPositions.filter((p) => r._posSet.has(p)),
    }));
    return rows.sort((a, b) => {
      if (a.order != null && b.order != null) return a.order - b.order;
      if (a.order != null) return -1;
      if (b.order != null) return 1;
      return a.playerName.localeCompare(b.playerName);
    });
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

      {/* Game Header — tournament games get a distinctive purple/indigo
          treatment (top gradient stripe, ring, Trophy eyebrow with a
          link back to the parent tournament, and a faint trophy
          watermark) so the coach can tell at a glance this is a
          tournament game with pitch-budget rules in play. */}
      {(() => {
        const isTournament = game.gameType === "tournament";
        const tournamentName =
          isTournament && tournamentForCallout.data?.name
            ? tournamentForCallout.data.name
            : null;
        return (
      <Card
        className={
          isTournament
            ? "relative overflow-hidden border-purple-300/70 ring-1 ring-purple-200 shadow-[0_2px_18px_-6px_rgba(126,34,206,0.25)]"
            : ""
        }
        data-testid={isTournament ? "card-tournament-game-header" : undefined}
      >
        {isTournament && (
          <>
            {/* Top gradient stripe — purple → indigo → purple, like a
                championship banner across the top of the card. */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-purple-600 via-indigo-500 to-purple-600"
            />
            {/* Faint Trophy watermark in the top-right; pointer-events-
                none so it never intercepts clicks. */}
            <Trophy
              aria-hidden
              className="pointer-events-none absolute -right-3 -top-3 h-28 w-28 text-purple-200/40 rotate-12"
              strokeWidth={1.25}
            />
          </>
        )}
        <CardContent className={isTournament ? "p-5 pt-6 relative" : "p-5"}>
          <div className="flex flex-col gap-4">
            <div>
              {isTournament ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 px-2.5 py-1 text-[11px] font-broadcast font-bold uppercase tracking-[0.16em] text-white shadow-sm"
                    data-testid="badge-tournament-eyebrow"
                  >
                    <Trophy className="h-3 w-3" />
                    Tournament
                  </span>
                  {tournamentName && game.tournamentId != null && (
                    <Link
                      href={`/tournaments/${game.tournamentId}`}
                      className="text-xs font-medium text-purple-700 hover:text-purple-900 hover:underline truncate max-w-[16rem]"
                      data-testid="link-parent-tournament"
                      title={tournamentName}
                    >
                      {tournamentName}
                    </Link>
                  )}
                </div>
              ) : (
                <div className="eyebrow text-primary/70">Game</div>
              )}
              {/* Title row: opponent + status badge on the left, status-
                  changing actions (Mark Complete / Game Ended Early)
                  pushed to the right with ml-auto so they sit on the
                  same line as the title even when the card is narrow. */}
              <div className="flex items-center gap-3 flex-wrap mt-1">
                <h1 className="page-title text-foreground text-2xl sm:text-3xl">
                  <span className="text-foreground" title={teamName || undefined}>{teamName || "Team"}</span>{" "}
                  <span className="text-foreground/50">vs.</span>{" "}
                  <span className="text-primary" title={game.opponent}>{formatOpponentForMatchup(game.opponent, teamName) || game.opponent}</span>
                </h1>
                {(() => {
                  const eff = effectiveStatus(game);
                  if (eff === "completed")
                    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>;
                  if (eff === "cancelled")
                    return <Badge variant="outline">Cancelled</Badge>;
                  if (eff === "past")
                    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Past</Badge>;
                  return <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Upcoming</Badge>;
                })()}
                {/* Lineup save status. Only shows once we've actually
                    saved in this session — falling back to the query's
                    fetch time would make passive background refetches
                    look like "Saved just now", which lies about
                    durability. Hidden for view-only coaches since
                    they can't trigger a save. */}
                {canEditLineup && (
                  <SavedIndicator
                    isPending={saveLineup.isPending}
                    isError={saveLineup.isError && !saveLineup.isPending}
                    lastSavedAt={lastLineupSavedAt}
                  />
                )}
                {/* Header action group. The Depth Chart dialog is read-
                    only so it's available to every viewer (including
                    "view" tier); Edit + Box Score still gate at
                    `partial`. Wraps to its own row on mobile and
                    pushes right on sm+. */}
                <div className="flex gap-2 flex-wrap justify-start basis-full sm:basis-auto sm:ml-auto sm:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDepthChartOpen(true)}
                    data-testid="button-depth-chart"
                    title="View depth chart"
                  >
                    <DepthChartIcon className="h-4 w-4 mr-2" />
                    Depth chart
                  </Button>
                  {can("partial") && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditGameOpen(true)}
                      data-testid="button-edit-game"
                      title="Edit game details"
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                    {sportProfile.features.boxScoreImport &&
                      game.status !== ("cancelled" as typeof game.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setBoxScoreOpen(true)}
                        data-testid="button-import-box-score"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        {game.boxScoreImportedAt ? "Re-import box score" : "Import box score"}
                      </Button>
                    )}
                  </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {safeFormatDate(game.gameDate, "EEEE, MMMM d, yyyy · h:mm a")}
                </span>
                {game.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {game.location}
                  </span>
                )}
                <span>{game.innings} innings</span>
              </div>
              {game.status === "completed" && game.ourScore != null && game.opponentScore != null && (() => {
                // Same-score completed games are ties (T). See games.tsx for
                // matching logic — keep these in sync.
                const tied = game.ourScore === game.opponentScore;
                const won = game.ourScore > game.opponentScore;
                const cls = tied
                  ? "bg-amber-100 text-amber-800"
                  : won
                    ? "bg-green-100 text-green-800"
                    : "bg-red-100 text-red-800";
                const letter = tied ? "T" : won ? "W" : "L";
                return (
                  <div className="mt-2 flex items-center gap-3">
                    <span className={`text-xl font-bold px-3 py-1 rounded ${cls}`}>
                      {letter} {game.ourScore} - {game.opponentScore}
                    </span>
                  </div>
                );
              })()}
            </div>
            {/* Lineup-management actions on their own row spanning the
                full width below the title block. */}
            {game.status !== "cancelled" && (
              <div className="flex gap-2 flex-wrap">
                  {/* "View Original Plan" is read-only — leave it on
                      for view-tier coaches so they can still see how
                      the lineup was originally drawn up. */}
                  {game.planSnapshot && game.planSnapshot.length > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => setViewPlanOpen(true)}
                      data-testid="button-view-original-plan"
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Original Plan
                    </Button>
                  )}
                  {/* All of these mutate the lineup → partial+ only. */}
                  {canEditLineup && (
                    <>
                      {(lineup.length > 0 || previewLineup || editedLineup) && (
                        <Button
                          variant="outline"
                          onClick={openEditAvailable}
                          data-testid="button-edit-available"
                        >
                          <Users className="h-4 w-4 mr-2" />
                          Edit Available
                        </Button>
                      )}
                      {/* Single CTA that opens a chooser with all three
                          lineup-source entry points. */}
                      <Button
                        onClick={() => setLineupActionsOpen(true)}
                        data-testid="button-lineup-actions"
                      >
                        <Wand2 className="h-4 w-4 mr-2" />
                        {lineup.length > 0 ? "Replace Lineup" : "Set Lineup"}
                      </Button>
                    </>
                  )}
                </div>
              )}
          </div>
        </CardContent>
      </Card>
        );
      })()}

      {/* Read-only box score — auto-renders when boxScoreImportedAt is set.
          Coaches land here after a game and want to see results without
          re-opening the import dialog. The Edit button still routes there. */}
      {sportProfile.features.boxScoreImport && game.boxScoreImportedAt && (
        <BoxScoreDisplayCard
          gameId={game.id}
          onEdit={can("partial") ? () => setBoxScoreOpen(true) : undefined}
        />
      )}

      {/* Mobile-only "Tools & insights" toggle. Hidden on sm+ where the
          tools render inline as ever. The four blocks below
          (AI Assistant, Position Locks, Equity Insights, Pitch budget
          watch, tap hint) each carry a `max-sm:hidden` class that the
          state-driven className strips when expanded. Banners for
          unsaved changes are NOT collapsed — those are critical
          alerts and stay visible. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setMobileToolsOpen((o) => !o)}
        className="sm:hidden w-full justify-between"
        data-testid="button-mobile-tools-toggle"
        aria-expanded={mobileToolsOpen}
      >
        <span className="flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Tools & insights
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${mobileToolsOpen ? "rotate-180" : ""}`}
        />
      </Button>

      {/* AI Assistant search bar */}
      <AiAssistantPanel
        aiInput={aiInput}
        onAiInputChange={setAiInput}
        aiLoading={aiLoading}
        onAsk={handleAskAi}
        aiAnswer={aiAnswer}
        onDismissAnswer={() => setAiAnswer(null)}
        aiMemoryCount={aiMemoryCount}
        aiMemoryClearing={aiMemoryClearing}
        onClearMemory={handleClearAiMemory}
        mobileToolsOpen={mobileToolsOpen}
      />

      {/* Position Locks — pin specific players to specific positions/innings.
          The lineup generator and AI assistant honor these. The id is used
          by the "always lock P/C" prompt so "Set locks first" can scroll the
          coach straight here. */}
      {game.status !== "cancelled" && (
        <Card
          id="position-locks-card"
          data-testid="card-locks"
          className={mobileToolsOpen ? "" : "max-sm:hidden"}
        >
          <CardHeader className="flex-row items-start justify-between space-y-0 gap-3 pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <LockIcon className="h-4 w-4" />
                Position Locks
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Pin a player to a position for one inning or all innings — the generator and AI assistant will honor them.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={openAddLock} data-testid="button-add-lock">
              <Plus className="h-4 w-4 mr-1" />
              Add Lock
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {locksLoading && locks.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-locks-loading">Loading locks…</p>
            ) : groupedLocks.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-locks-empty">
                No locks yet. Add one to pin a player to a specific position.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2" data-testid="list-locks">
                {groupedLocks.map((g) => (
                  <span
                    key={g.key}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${positionColor(g.position)}`}
                    data-testid={`chip-lock-${g.ids.join("-")}`}
                  >
                    {g.label}
                    <button
                      type="button"
                      onClick={() => handleRemoveLock(g.ids)}
                      className="ml-0.5 -mr-0.5 rounded-full hover:bg-black/10 p-0.5"
                      aria-label={`Remove lock ${g.label}`}
                      data-testid={`button-remove-lock-${g.ids[0]}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Lineup Grid — Save buttons gated on partial+. View-only
          coaches shouldn't see a "preview" state at all because the
          actions that produce one (Generate / Update from Photo /
          Edit Available) are themselves hidden, but the gate here is
          a defense-in-depth so the buttons can't appear via stale
          state from a permission downgrade mid-session. */}
      {previewLineup && canEditLineup && (
        <div className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg" data-testid="banner-preview">
          <span className="text-sm text-yellow-800 font-medium">
            {saveLineup.isPending ? "Saving generated lineup…" : "Generated lineup — auto-saving"}
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => handleSaveLineup(previewLineup)} disabled={saveLineup.isPending} data-testid="button-save-preview">
              <Save className="h-4 w-4 mr-1" />
              {saveLineup.isPending ? "Saving..." : "Save now"}
            </Button>
          </div>
        </div>
      )}
      {!previewLineup && editedLineup && canEditLineup && (
        <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg" data-testid="banner-edited">
          <span className="text-sm text-amber-800 font-medium">
            {saveLineup.isPending ? "Saving changes…" : "Auto-saving your edits…"}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={discardEdits} data-testid="button-discard-edits">Discard</Button>
            <Button size="sm" onClick={() => handleSaveLineup(editedLineup)} disabled={saveLineup.isPending} data-testid="button-save-edits">
              <Save className="h-4 w-4 mr-1" />
              {saveLineup.isPending ? "Saving..." : "Save now"}
            </Button>
          </div>
        </div>
      )}

      {/* Equity insights popup — surfaces the most useful "this isn't fair
          yet" call-outs based on the lineup currently on screen. Dismissible
          per session; reappears with fresh advice on the next regenerate or
          save. Coaches can also turn these off entirely in Settings. */}
      {(prefs?.showEquitySuggestions ?? true) && !equityDismissed && equityInsights.items.length > 0 && (
        <div
          className={`rounded-lg border border-blue-200 bg-blue-50 p-3 print:hidden ${mobileToolsOpen ? "" : "max-sm:hidden"}`}
          data-testid="equity-insights"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <Sparkles className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
              <div className="text-sm text-blue-900 min-w-0">
                <p className="font-medium leading-snug">
                  Make this lineup more equitable
                </p>
                <ul className="mt-1.5 space-y-1 leading-snug">
                  {equityInsights.items.map((item) => (
                    <li
                      key={item.key}
                      className="flex items-start gap-1.5"
                      data-testid={`equity-item-${item.key}`}
                    >
                      <span className="text-blue-500">•</span>
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEquityDismissed(true)}
              className="text-blue-400 hover:text-blue-700 shrink-0"
              aria-label="Dismiss equity insights"
              data-testid="button-equity-dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Tournament pitch-budget callout — surfaces pitchers who are
          resting today or have a small remaining budget so the coach
          notices BEFORE they pencil that pitcher into the next inning.
          Pulls from the same `pitcherAvailability` payload PitchCountsCard
          uses below; this is a "skim above the fold" version. */}
      {game.gameType === "tournament" &&
        tournamentForCallout.data &&
        (() => {
          const items = (tournamentForCallout.data.pitcherAvailability ?? [])
            .filter((p) => {
              if (p.restingUntil) return true;
              if (p.pitchesAvailableToday == null) return false;
              if (p.dailyMax == null) return false;
              // Show pitchers at or below 25 pitches remaining today, or
              // anyone already capped out. Tunable threshold — a fresh
              // pitcher with 65 left isn't interesting, but one down to
              // 20 is a real "use them carefully" signal.
              return p.pitchesAvailableToday <= 25;
            })
            .sort(
              (a, b) =>
                (a.pitchesAvailableToday ?? -1) -
                (b.pitchesAvailableToday ?? -1),
            );
          if (items.length === 0) return null;
          return (
            <div
              className={`rounded-lg border border-purple-200 bg-purple-50 p-3 print:hidden ${mobileToolsOpen ? "" : "max-sm:hidden"}`}
              data-testid="tournament-pitch-callout"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-purple-700 shrink-0" />
                <div className="text-sm text-purple-900 min-w-0 flex-1">
                  <p className="font-medium leading-snug">
                    Pitch budget watch
                    {tournamentForCallout.data.effectiveDailyMax != null && (
                      <span className="font-normal text-purple-700">
                        {" "}
                        · daily max {tournamentForCallout.data.effectiveDailyMax}
                      </span>
                    )}
                  </p>
                  <ul className="mt-1.5 space-y-1 leading-snug">
                    {items.map((p) => (
                      <li
                        key={p.playerId}
                        className="flex items-start gap-1.5"
                        data-testid={`pitch-callout-${p.playerId}`}
                      >
                        <span className="text-purple-500">•</span>
                        <span>
                          <span className="font-medium">{p.playerName}</span>
                          {p.restingUntil ? (
                            <span>
                              {" "}
                              — resting until{" "}
                              {safeFormatDate(
                                p.restingUntil.availableOn,
                                "EEE M/d",
                                "soon",
                              )}
                            </span>
                          ) : (
                            <span>
                              {" "}
                              — {p.pitchesAvailableToday} pitch
                              {p.pitchesAvailableToday === 1 ? "" : "es"} left
                              today
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-purple-700">
                    Tap to record counts in the Pitch Counts card below.
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

      {/* One-time-per-session hint for mobile coaches: drag-and-drop is OFF
          on touch devices (it kept fighting page scroll), so the only way
          to move a player is the tap-to-select / tap-to-place flow. The
          desktop tile already shows this in its tooltip. */}
      {isCoarsePointer &&
        !tapHintDismissed &&
        canEditLineup &&
        displayLineup.length > 0 && (
          <div
            className={`rounded-lg border border-sky-200 bg-sky-50 p-3 print:hidden ${mobileToolsOpen ? "" : "max-sm:hidden"}`}
            data-testid="banner-tap-to-swap-hint"
          >
            <div className="flex items-start gap-2">
              <MousePointerClick className="h-4 w-4 mt-0.5 text-sky-700 shrink-0" />
              <div className="text-sm text-sky-900 flex-1 min-w-0 leading-snug">
                <p className="font-medium">Tap a player, then tap where to send them.</p>
                <p className="text-xs text-sky-800 mt-0.5">
                  Tapping the same player again deselects. The page scrolls
                  normally — chips don't grab the screen anymore.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTapHintDismissed(true)}
                className="text-sky-400 hover:text-sky-700 shrink-0"
                aria-label="Dismiss tap-to-swap hint"
                data-testid="button-tap-hint-dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

      <section id="printable-lineup">
        {/* Print-only header: gives the printout team/opponent/date
            context. Hidden on screen via the global `.print-only`
            rule; styled in @media print as a big Oswald title with
            an underline rule for a "scoreboard sheet" feel. */}
        <div className="print-only print-header" data-testid="print-header">
          <div className="print-title">
            {teamName || "Lineup"}
            <span style={{ fontWeight: 400 }}> vs. </span>
            {formatOpponentForMatchup(game.opponent, teamName) || game.opponent}
          </div>
          <div className="print-subtitle">
            {safeFormatDate(game.gameDate, "EEEE, MMMM d, yyyy · h:mm a")}
            {" · "}
            {innings} innings
            {game.gameType === "tournament" && " · Tournament"}
            {game.gameType === "league" && " · League"}
            {game.status === "completed" &&
              typeof game.ourScore === "number" &&
              typeof game.opponentScore === "number" &&
              ` · Final ${game.ourScore}–${game.opponentScore}`}
          </div>
          {game.location && (
            <div className="print-meta">{game.location}</div>
          )}
        </div>
      <Tabs
        value={lineupTab}
        onValueChange={(v) => setLineupTab(v as typeof lineupTab)}
        className="game-tabs"
      >
        <TabsList
          className={`no-print w-full grid grid-cols-2 h-auto ${
            sport === "basketball" ? "sm:grid-cols-2" : "sm:grid-cols-4"
          }`}
        >
          <TabsTrigger value="defense" data-testid="tab-defense">
            {sport === "basketball" ? "Lineup" : "Defense"}
          </TabsTrigger>
          {sportProfile.features.battingOrder && (
            <TabsTrigger
              value="batting"
              disabled={displayLineup.length === 0}
              data-testid="tab-batting"
            >
              Batting Order
            </TabsTrigger>
          )}
          <TabsTrigger
            value="innings"
            disabled={displayLineup.length === 0}
            data-testid="tab-innings"
          >
            {sportProfile.periodLabelPlural}
          </TabsTrigger>
          {sportProfile.features.pitchCounts && (
            <TabsTrigger value="pitching" data-testid="tab-pitching">
              Pitch Counts
            </TabsTrigger>
          )}
        </TabsList>
        {/* `forceMount` keeps every panel mounted so print CSS can
            reveal them all at once and so heavy panels (lineup grid)
            don't have to re-mount when the coach toggles between tabs. */}
        <TabsContent value="defense" forceMount className="mt-3 data-[state=inactive]:hidden">
      <Card data-testid="card-defensive-lineup">
        <CardHeader className="flex-row items-start justify-between space-y-0 gap-3 p-4 sm:p-6">
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
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {selectedEntry && (
                <span className="text-xs text-muted-foreground hidden sm:inline" data-testid="text-swap-hint">
                  Moving <span className="font-medium text-foreground">{formatPlayerNameShort(selectedEntry.playerName)}</span> — tap a cell in inning {selectedEntry.inning}
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
              {selectedEntry && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    handleRemovePlayerFromLineup(selectedEntry.playerId, selectedEntry.playerName);
                  }}
                  data-testid="button-remove-selected-player"
                  className="no-print"
                  title={`Remove ${selectedEntry.playerName} from this lineup (e.g. injury)`}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Remove {formatPlayerNameShort(selectedEntry.playerName)}
                </Button>
              )}
              {showSelectPositions && <SelectPositionsDialog />}
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`${BASE}/games/${id}/display`, "_blank", "noopener")}
                data-testid="button-open-field-display"
                className="no-print"
                aria-label="Field Display"
                title="Open the live dugout / fence-iPad display for this game (auto-updates)"
              >
                <Tv className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Field Display</span>
              </Button>
              {/* Single Export menu — replaces the prior pair of "Copy
                  for Sheets" + "Print" buttons. Same actions, half the
                  header width on mobile. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="button-export-lineup"
                    className="no-print"
                    aria-label="Export"
                    title="Copy the lineup to your clipboard or print this card"
                  >
                    <Upload className="h-4 w-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={handleCopyLineup}
                    data-testid="menu-copy-lineup"
                  >
                    <ClipboardCopy className="h-4 w-4 mr-2" />
                    Copy for Sheets
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => window.print()}
                    data-testid="menu-print-lineup"
                  >
                    <Printer className="h-4 w-4 mr-2" />
                    Print
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          {displayLineup.length === 0 && showSelectPositions && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <SelectPositionsDialog />
            </div>
          )}
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          {lineupLoading ? (
            <div className="h-40 bg-muted animate-pulse rounded" />
          ) : displayLineup.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Wand2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>No lineup generated yet.</p>
              <div className="flex gap-2 justify-center mt-3 flex-wrap">
                <Button
                  onClick={() => setLineupActionsOpen(true)}
                  data-testid="button-lineup-actions-empty"
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  Set Lineup
                </Button>
              </div>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              // pointerWithin → closestCenter fallback. The default
              // rectIntersection intermittently reported `over: null`
              // even when the cursor was clearly over a target cell.
              // pointerWithin alone would no-op when releasing in the
              // tiny gap between cells, so closestCenter picks up
              // those edge cases. See `fieldCollisionDetection` above.
              collisionDetection={fieldCollisionDetection}
              // autoScroll OFF: when it kicked in near the viewport edge
              // it desynced the DragOverlay's rect math from the cursor
              // and the floating chip would snap to the top of the page
              // mid-drag. Coaches can scroll manually before grabbing.
              autoScroll={false}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              {/* Desktop / tablet view — innings as rows, positions as
                  columns. This is the original layout. Hidden on phones
                  (where the 11-column row was wider than the screen and
                  forced a horizontal scroll). */}
              {/* Tablet/desktop view — innings as rows, positions as
                  columns. Column widths use `lg:` to grow back to the
                  generous original sizing only on real desktops/iPad
                  landscape; below `lg` (which includes phone landscape
                  ~844px wide) the columns are tight enough for a 9-pos
                  league lineup + bench to fit without horizontal scroll
                  — coaches kept losing the rightmost columns on iPhone
                  landscape. table-fixed pins the widths so an extra-long
                  player name in a cell doesn't push the table wider. */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-y-0.5 table-fixed">
                  <thead>
                    <tr>
                      <th className="text-left py-2 pr-2 text-[10px] lg:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-12 lg:w-16">{sportProfile.periodLabelShort}</th>
                      {displayPositions.map((pos) => (
                        <th key={pos} className="text-center py-2 px-0.5 lg:px-1 w-[58px] lg:w-20">
                          <span className="inline-block px-1.5 lg:px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-[10px] lg:text-[11px] font-bold tracking-wide">
                            {pos}
                          </span>
                        </th>
                      ))}
                      <th className="text-center py-2 px-1 w-20 lg:w-28">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] lg:text-[11px] font-bold tracking-wide uppercase">
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
                          <td className="py-1 pl-3 pr-2 rounded-l-xl">
                            <div className="flex items-center gap-1">
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-sm">
                                {inning}
                              </span>
                              {inning === innings && innings > 1 && (
                                <button
                                  type="button"
                                  onClick={handleRemoveLastInning}
                                  disabled={updateGame.isPending}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 disabled:opacity-40"
                                  title={`Remove inning ${inning} (we ten-runned, lost as visitor, etc.)`}
                                  aria-label={`Remove inning ${inning}`}
                                  data-testid={`button-remove-inning-${inning}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                          {displayPositions.map((pos) => {
                            const entry = cellByInningPos[inning]?.[pos];
                            return (
                              <td key={pos} className="py-1 px-1 text-center">
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
                          <td className="py-1 px-1 pr-2 text-center align-top rounded-r-xl border-l border-border/40">
                            <BenchArea
                              inning={inning}
                              entries={benchEntries}
                              selectedEntryId={selectedEntryId}
                              isHotInning={isHotInning}
                              draggedEntryId={activeDrag?.entryId ?? null}
                              onTileClick={(id) =>
                                handleCellClick({ entryId: id, inning, position: "Bench" })
                              }
                              onEmptyClick={() =>
                                handleCellClick({ inning, position: "Bench" })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile view — defaults to a "coach-during-the-game"
                  single-inning view: pick the inning, see big tappable
                  position rows for that inning only. Fall back to the
                  compressed transposed grid (positions as rows, innings
                  as columns) when a coach wants the season-pacing view.
                  Both modes use the same FieldCell / BenchArea so
                  drag-and-drop, tap-to-swap, and tap-to-add behave
                  identically. */}
              <div className="sm:hidden space-y-2">
                {/* Coach control bar: prev/next inning + view-mode pill. */}
                <div className="flex items-center justify-between gap-2 px-1">
                  {mobileDefenseView === "single" ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setMobileActiveInning((n) => Math.max(1, n - 1))}
                        disabled={mobileActiveInning <= 1}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card border border-border text-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-card"
                        aria-label="Previous inning"
                        data-testid="button-mobile-prev-inning"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-primary text-primary-foreground shadow-sm">
                        <span className="text-[10px] uppercase tracking-wider font-semibold opacity-80">
                          Inning
                        </span>
                        <span
                          className="text-base font-bold font-['Roboto_Mono'] tabular-nums"
                          data-testid="text-mobile-active-inning"
                        >
                          {mobileActiveInning}
                        </span>
                        <span className="text-[10px] tracking-wider opacity-70">/ {innings}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMobileActiveInning((n) => Math.min(innings, n + 1))}
                        disabled={mobileActiveInning >= innings}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card border border-border text-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-card"
                        aria-label="Next inning"
                        data-testid="button-mobile-next-inning"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-1">
                      All innings
                    </span>
                  )}
                  <div className="inline-flex rounded-full bg-muted p-0.5 text-[10px] font-bold uppercase tracking-wider">
                    <button
                      type="button"
                      onClick={() => setMobileDefenseView("single")}
                      className={`px-2.5 py-1 rounded-full transition-colors ${
                        mobileDefenseView === "single"
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground"
                      }`}
                      aria-pressed={mobileDefenseView === "single"}
                      data-testid="button-mobile-view-single"
                    >
                      Inning
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileDefenseView("all")}
                      className={`px-2.5 py-1 rounded-full transition-colors ${
                        mobileDefenseView === "all"
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground"
                      }`}
                      aria-pressed={mobileDefenseView === "all"}
                      data-testid="button-mobile-view-all"
                    >
                      All
                    </button>
                  </div>
                </div>

                {/* Single-inning view: stack of large position rows for the
                    selected inning, plus a bench row. Each row's FieldCell
                    is the SAME component used in the all-innings grid so
                    drag-and-drop and tap-to-swap work identically. */}
                {mobileDefenseView === "single" && (
                  <div className="rounded-lg border border-border bg-card overflow-hidden" data-testid="mobile-single-inning-view">
                    {(() => {
                      const inning = mobileActiveInning;
                      const isHotInning =
                        selectedEntry?.inning === inning || activeDrag?.inning === inning;
                      const benchEntries = displayLineup.filter(
                        (e) => e.inning === inning && e.position === "Bench",
                      );
                      return (
                        <>
                          {displayPositions.map((pos, posIdx) => {
                            const entry = cellByInningPos[inning]?.[pos];
                            return (
                              <div
                                key={pos}
                                className={`flex items-center gap-2.5 px-3 py-1.5 ${
                                  posIdx % 2 === 0 ? "bg-card" : "bg-muted/40"
                                } ${posIdx > 0 ? "border-t border-border/60" : ""}`}
                              >
                                <span className="inline-flex items-center justify-center min-w-[40px] h-7 px-2 rounded bg-secondary text-secondary-foreground text-xs font-bold tracking-wide font-['Roboto_Mono']">
                                  {pos}
                                </span>
                                <div className="flex-1 min-w-0 flex items-center justify-start">
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
                                </div>
                              </div>
                            );
                          })}
                          <div className="flex items-start gap-2.5 px-3 py-1.5 bg-muted/60 border-t border-border/60">
                            <span className="inline-flex items-center justify-center min-w-[40px] h-7 px-2 rounded bg-muted text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
                              Bench
                            </span>
                            <div className="flex-1 min-w-0">
                              <BenchArea
                                inning={inning}
                                entries={benchEntries}
                                selectedEntryId={selectedEntryId}
                                isHotInning={isHotInning}
                                draggedEntryId={activeDrag?.entryId ?? null}
                                onTileClick={(id) =>
                                  handleCellClick({ entryId: id, inning, position: "Bench" })
                                }
                                onEmptyClick={() =>
                                  handleCellClick({ inning, position: "Bench" })
                                }
                              />
                            </div>
                          </div>
                          {inning === innings && innings > 1 && (
                            <div className="flex items-center justify-end px-3 py-1.5 bg-muted/30 border-t border-border/60">
                              <button
                                type="button"
                                onClick={handleRemoveLastInning}
                                disabled={updateGame.isPending}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-destructive disabled:opacity-40"
                                data-testid={`button-mobile-remove-inning-${inning}`}
                              >
                                <X className="h-3 w-3" />
                                Remove inning {inning}
                              </button>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* All-innings view: original transposed grid, kept as a
                    deliberate fallback for coaches who use this page on a
                    phone for season-level review (not in-game switching). */}
                {mobileDefenseView === "all" && (
                <table className="w-full text-xs border-separate border-spacing-y-0.5">
                  <thead>
                    <tr>
                      <th className="text-left py-1.5 pl-1 pr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-9">
                        Pos
                      </th>
                      {Array.from({ length: innings }, (_, i) => i + 1).map((inning) => (
                        <th key={inning} className="text-center py-1.5 px-0.5">
                          <div className="flex items-center justify-center gap-0.5">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-bold shadow-sm">
                              {inning}
                            </span>
                            {inning === innings && innings > 1 && (
                              <button
                                type="button"
                                onClick={handleRemoveLastInning}
                                disabled={updateGame.isPending}
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 disabled:opacity-40"
                                title={`Remove inning ${inning}`}
                                aria-label={`Remove inning ${inning}`}
                                data-testid={`button-remove-inning-mobile-${inning}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayPositions.map((pos, posIdx) => {
                      const rowBg = posIdx % 2 === 0 ? "bg-card" : "bg-muted/40";
                      return (
                        <tr key={pos} className={`${rowBg} transition-colors`}>
                          <td className="py-1 pl-1 pr-1 rounded-l-lg align-middle">
                            <span className="inline-block px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground text-[10px] font-bold tracking-wide">
                              {pos}
                            </span>
                          </td>
                          {Array.from({ length: innings }, (_, i) => i + 1).map((inning) => {
                            const entry = cellByInningPos[inning]?.[pos];
                            const isHotInning =
                              selectedEntry?.inning === inning || activeDrag?.inning === inning;
                            return (
                              <td key={inning} className="py-1 px-0.5 text-center">
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
                        </tr>
                      );
                    })}
                    {/* Bench row — one cell per inning, each its own
                        droppable so dragging onto an inning's bench area
                        works exactly like the desktop layout. */}
                    <tr className="bg-muted/60">
                      <td className="py-1 pl-1 pr-1 rounded-l-lg align-top">
                        <span className="inline-block px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-bold tracking-wide uppercase">
                          Bench
                        </span>
                      </td>
                      {Array.from({ length: innings }, (_, i) => i + 1).map((inning) => {
                        const isHotInning =
                          selectedEntry?.inning === inning || activeDrag?.inning === inning;
                        const benchEntries = displayLineup.filter(
                          (e) => e.inning === inning && e.position === "Bench",
                        );
                        return (
                          <td key={inning} className="py-1 px-0.5 align-top">
                            <BenchArea
                              inning={inning}
                              entries={benchEntries}
                              selectedEntryId={selectedEntryId}
                              isHotInning={isHotInning}
                              draggedEntryId={activeDrag?.entryId ?? null}
                              onTileClick={(id) =>
                                handleCellClick({ entryId: id, inning, position: "Bench" })
                              }
                              onEmptyClick={() =>
                                handleCellClick({ inning, position: "Bench" })
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
                )}
              </div>

              {/* Portal the DragOverlay to <body> so the floating chip
                * always positions itself relative to the viewport. Without
                * the portal, any `transform`, `filter`, or `will-change`
                * style on an ancestor (Cards, animation wrappers, etc.)
                * makes @dnd-kit's `position: fixed` overlay anchor to
                * that ancestor instead of the viewport — the chip ends up
                * far from the cursor and the original tile just looks like
                * it disappeared. createPortal sidesteps the whole tree. */}
              {createPortal(
                <DragOverlay dropAnimation={null} style={{ zIndex: 1000 }}>
                  {draggedEntry ? (
                    <div
                      className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${positionColor(draggedEntry.position)} shadow-lg ring-2 ring-primary cursor-grabbing`}
                    >
                      {formatPlayerNameShort(draggedEntry.playerName)}
                    </div>
                  ) : null}
                </DragOverlay>,
                document.body,
              )}
            </DndContext>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {/* Batting order — drag-and-drop sortable list. The numbered chip on
             the left is the slot, the grip handle on the right is the drag
             target. Stages reorders into editedLineup so the standard Save
             Changes flow persists them. */}
        <TabsContent value="batting" forceMount className="mt-3 data-[state=inactive]:hidden">
      {displayLineup.length > 0 && battingOrderRows.length > 0 ? (
        <Card data-testid="card-batting-order">
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">Batting Order</CardTitle>
            <p className="text-xs text-muted-foreground">
              Drag a row by its handle to reorder the lineup. Slots 1–9 are
              the starting nine; anyone after the divider hits behind them.
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <DndContext
              sensors={sensors}
              onDragEnd={(e) => {
                const activeId = Number(e.active.id);
                const overId = e.over ? Number(e.over.id) : null;
                if (overId == null || activeId === overId) return;
                const from = battingOrderRows.findIndex((r) => r.playerId === activeId);
                const to = battingOrderRows.findIndex((r) => r.playerId === overId);
                if (from < 0 || to < 0) return;
                reorderBattingLineup(from, to);
              }}
            >
              <SortableContext
                items={battingOrderRows.map((r) => r.playerId)}
                strategy={verticalListSortingStrategy}
              >
                <ol className="flex flex-col">
                  {battingOrderRows.map((r, i) => (
                    <SortableBattingRow
                      key={r.playerId}
                      row={r}
                      slot={i + 1}
                      showStarterDivider={
                        battingStyle === "nine_man" &&
                        i === 8 &&
                        battingOrderRows.length > 9
                      }
                      isContinuous={battingStyle === "continuous"}
                      testId={`row-batting-order-${i}`}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-md">
          Generate or import a lineup first to see the batting order.
        </div>
      )}
        </TabsContent>

        {/* Innings by Position tally */}
        <TabsContent value="innings" forceMount className="mt-3 data-[state=inactive]:hidden">
      {displayLineup.length > 0 ? (
        <Card data-testid="card-tally">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3">
            <CardTitle className="text-base">{sportProfile.terms.timeByPositionLabel}</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyTally}
              data-testid="button-copy-tally"
              className="no-print shrink-0"
            >
              <ClipboardCopy className="h-4 w-4 mr-1.5" />
              Copy
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs">
                    <th className="text-left py-2 pr-3 font-medium">Player</th>
                    {tallyCategories.map((c) => (
                      <th key={c.key} className="text-center py-2 px-2 font-medium">{c.label}</th>
                    ))}
                    <th className="text-center py-2 px-2 font-medium">Bench</th>
                    <th className="text-center py-2 px-2 font-medium">Out</th>
                    <th className="text-center py-2 pl-2 font-medium">Total</th>
                    <th className="w-8 py-2 pl-2 no-print" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {tallyRows.map((row) => {
                    const total =
                      tallyCategories.reduce((s, c) => s + (row.counts[c.key] ?? 0), 0) +
                      row.Bench +
                      row.Out;
                    return (
                      <tr
                        key={row.playerId}
                        className="border-t border-border/50"
                        data-testid={`tally-row-${row.playerId}`}
                      >
                        <td className="py-1.5 pr-3 font-medium">{row.playerName}</td>
                        {tallyCategories.map((c) => {
                          const n = row.counts[c.key] ?? 0;
                          return (
                            <td
                              key={c.key}
                              className="text-center py-1.5 px-2"
                              data-testid={`tally-${row.playerId}-${c.testid}`}
                            >
                              {n > 0 ? (
                                <span
                                  className={`inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded ${c.cls} text-xs font-semibold`}
                                >
                                  {n}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-center py-1.5 px-2" data-testid={`tally-${row.playerId}-bench`}>
                          {row.Bench > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-semibold">
                              {row.Bench}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="text-center py-1.5 px-2" data-testid={`tally-${row.playerId}-out`}>
                          {row.Out > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-semibold">
                              {row.Out}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="text-center py-1.5 pl-2 font-semibold text-muted-foreground">
                          {total}
                        </td>
                        <td className="py-1.5 pl-2 no-print">
                          <button
                            type="button"
                            onClick={() => handleRemovePlayerFromLineup(row.playerId, row.playerName)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                            aria-label={`Remove ${row.playerName} from lineup`}
                            title={`Remove ${row.playerName} from this lineup (e.g. injury)`}
                            data-testid={`button-remove-player-${row.playerId}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {sport === "basketball"
                ? `Guard: PG, SG · Forward: SF, PF · Center: C · Out: ${sportProfile.periodLabelPlural.toLowerCase()} the player has no entry for`
                : "Pitching: P · Infield: C, 1B, 2B, 3B, SS · Outfield: LF, CF, RF · Out: innings the player has no entry for"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-md">
          Generate or import a {sportProfile.terms.lineupNoun.toLowerCase()} first to see the {sportProfile.periodLabelPlural.toLowerCase()} tally.
        </div>
      )}
        </TabsContent>

        {/* Pitch counts — works standalone or rolls into a tournament. The
            id anchor lets the dashboard "pitch counts not logged" task
            deep-link straight to this card (#pitch-counts-card). */}
        <TabsContent value="pitching" forceMount className="mt-3 data-[state=inactive]:hidden">
          {game && (
            <div id="pitch-counts-card" className="scroll-mt-20">
              <PitchCountsCard gameId={id} game={game} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Print-only footer — timestamp + tool credit so coaches can
          tell stale printouts apart at the field. */}
      <div className="print-only print-footer" data-testid="print-footer">
        Printed {format(new Date(), "MMM d, yyyy · h:mm a")} · {teamName || "Lineup Lab"}
      </div>
      </section>

      {/* "Always lock pitchers and catchers" prompt — fires when the coach
          enabled the preference in Settings and hits "Generate Lineup" while
          one or more innings still lack a P or C lock. */}
      <AlertDialog
        open={lockPromptInnings != null}
        onOpenChange={(o) => !o && setLockPromptInnings(null)}
      >
        <AlertDialogContent data-testid="dialog-lock-pc-prompt">
          <AlertDialogHeader>
            <AlertDialogTitle>Lock pitchers and catchers first?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Your settings ask you to set Pitcher and Catcher locks before
                  generating a lineup. These innings are still missing locks:
                </p>
                {lockPromptInnings && lockPromptInnings.p.length > 0 && (
                  <p>
                    <span className="font-medium text-foreground">Pitcher:</span>{" "}
                    inning{lockPromptInnings.p.length === 1 ? "" : "s"}{" "}
                    {lockPromptInnings.p.join(", ")}
                  </p>
                )}
                {lockPromptInnings && lockPromptInnings.c.length > 0 && (
                  <p>
                    <span className="font-medium text-foreground">Catcher:</span>{" "}
                    inning{lockPromptInnings.c.length === 1 ? "" : "s"}{" "}
                    {lockPromptInnings.c.join(", ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Tip: turn this off in Settings → Defaults if you don't want
                  to be reminded.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel data-testid="button-lock-prompt-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-lock-prompt-set-locks"
              onClick={() => {
                setLockPromptInnings(null);
                // Defer scroll to next paint so the dialog has time to
                // unmount and release focus before we move the viewport.
                requestAnimationFrame(() => {
                  document
                    .getElementById("position-locks-card")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
            >
              Set locks first
            </AlertDialogAction>
            <AlertDialogAction
              data-testid="button-lock-prompt-generate-anyway"
              onClick={() => {
                setLockPromptInnings(null);
                openGenerateDialog();
              }}
            >
              Generate anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Generate Dialog */}
      <Dialog open={generateOpen} onOpenChange={(o) => !o && setGenerateOpen(false)}>
        <DialogContent className="max-w-md max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Lineup</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Select players available for this game. The lineup will rotate positions fairly.
            </p>
            <div className="rounded-md border bg-muted/30 px-3 py-3 flex flex-col gap-2" data-testid="generate-fairness-section">
              <div className="flex items-baseline justify-between">
                <Label className="text-sm font-medium">Fairness Dial</Label>
                <span
                  className="text-base font-bold font-mono text-primary"
                  data-testid="generate-fairness-value"
                >
                  {equityValue}
                </span>
              </div>
              <Slider
                value={[equityValue]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) => {
                  equityTouchedRef.current = true;
                  setEquityValue(v);
                }}
                data-testid="generate-fairness-slider"
              />
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                <span>Best lineup</span>
                <span>Balanced</span>
                <span>Most equitable</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Lower keeps stronger players in their preferred spots; higher rotates everyone evenly. We'll remember this as your default.
              </p>
            </div>
            {(game?.gameType === "league" || game?.gameType === "tournament") && (
              <div className={`rounded-md border px-3 py-2 text-xs ${
                game.gameType === "tournament"
                  ? "border-purple-200 bg-purple-50 text-purple-900"
                  : "border-blue-200 bg-blue-50 text-blue-900"
              }`}>
                {game.gameType === "tournament"
                  ? "Tournament mode — strongest players start in their preferred positions; batting order uses the table-setter / cleanup pattern (top OBPs lead off, top SLG hits 4-5 to drive them in). Players without recorded stats are treated as team-average."
                  : "League mode — players with fewer plate appearances this season will bat earlier to even things out."}
              </div>
            )}
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
                    {p.preferredPositions.slice(0, 3).map((pos) => (
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
              <Button onClick={handleGenerate} disabled={generating || generateLineup.isPending}>
                <Wand2 className="h-4 w-4 mr-1" />
                {generating || generateLineup.isPending ? "Generating..." : "Generate"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Player to Empty Slot Dialog */}
      <Dialog
        open={addSlotTarget != null}
        onOpenChange={(o) => !o && setAddSlotTarget(null)}
      >
        <DialogContent className="max-w-md max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Add player to {addSlotTarget?.position} · Inning{" "}
              {addSlotTarget?.inning}
            </DialogTitle>
            <DialogDescription>
              Pick a player from your roster to drop into this slot. If they're
              already in this inning somewhere else, they'll just move here.
            </DialogDescription>
          </DialogHeader>
          {addSlotTarget && (() => {
            const current = previewLineup ?? editedLineup ?? lineup;
            const inningEntries = current.filter(
              (e) => e.inning === addSlotTarget.inning,
            );
            const positionByPlayerId = new Map(
              inningEntries.map((e) => [e.playerId, e.position] as const),
            );
            // Surface preferred-position fits first; everyone else is still
            // pickable underneath, alphabetised. Eligibility is no longer a
            // gate — every player can be added to any slot.
            const preferredFirst = (a: typeof players[number], b: typeof players[number]) => {
              const aPref = a.preferredPositions.includes(addSlotTarget.position);
              const bPref = b.preferredPositions.includes(addSlotTarget.position);
              if (aPref !== bPref) return aPref ? -1 : 1;
              return a.name.localeCompare(b.name);
            };
            const candidates = players
              .filter((p) => p.active)
              .slice()
              .sort(preferredFirst);
            return (
              <div className="flex flex-col gap-1.5">
                {candidates.map((p) => {
                  const here = positionByPlayerId.get(p.id);
                  const isPreferred = p.preferredPositions.includes(
                    addSlotTarget.position,
                  );
                  const cannotPitch =
                    addSlotTarget.position === "P" && !p.canPitch;
                  const subtitle = here
                    ? here === "Bench"
                      ? "Currently on bench this inning"
                      : `Currently at ${here} this inning`
                    : "Not in this inning";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        addPlayerToSlot(
                          p.id,
                          addSlotTarget.inning,
                          addSlotTarget.position,
                        )
                      }
                      className={`flex items-center justify-between gap-3 p-2.5 rounded-md border text-left transition-colors ${
                        isPreferred
                          ? "border-primary/60 bg-primary/5 hover:bg-primary/10"
                          : "border-border hover:border-primary/40 hover:bg-muted/40"
                      }`}
                      data-testid={`add-slot-row-${p.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium flex items-center gap-2">
                          <span className="truncate">{p.name}</span>
                          {p.number != null && (
                            <span className="text-xs text-muted-foreground">
                              #{p.number}
                            </span>
                          )}
                          {isPreferred && (
                            <span className="text-[10px] uppercase tracking-wide text-primary bg-primary/10 border border-primary/30 rounded px-1 py-px">
                              ★ preferred
                            </span>
                          )}
                          {cannotPitch && (
                            <span className="text-[10px] uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-px">
                              not a pitcher
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {subtitle}
                        </div>
                      </div>
                      <span className="text-xs text-primary shrink-0">
                        {here ? "Move here" : "Add"}
                      </span>
                    </button>
                  );
                })}
                {candidates.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No active players in your roster.
                  </p>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSlotTarget(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Available Players Dialog */}
      <Dialog open={availableOpen} onOpenChange={(o) => !o && setAvailableOpen(false)}>
        <DialogContent className="max-w-md max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Available Players</DialogTitle>
            <DialogDescription>
              Uncheck a player to remove them from every inning of this lineup
              (e.g. injury). Check a player to add them to the bench so you can
              drag them onto the field. Positions other players hold won't be
              changed — just review and save.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <Label className="text-sm">Available Players</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-primary"
                    onClick={() =>
                      setAvailableSelectedIds(
                        players.filter((p) => p.active).map((p) => p.id),
                      )
                    }
                  >
                    Select all
                  </button>
                  <span className="text-xs text-muted-foreground">·</span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground"
                    onClick={() => setAvailableSelectedIds([])}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {players.filter((p) => p.active).map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                    availableSelectedIds.includes(p.id)
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                  data-testid={`available-row-${p.id}`}
                >
                  <Checkbox
                    checked={availableSelectedIds.includes(p.id)}
                    onCheckedChange={(v) =>
                      setAvailableSelectedIds((prev) =>
                        v ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{p.name}</span>
                    {p.number != null && (
                      <span className="text-xs text-muted-foreground ml-1.5">
                        #{p.number}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {p.preferredPositions.slice(0, 3).map((pos) => (
                      <span key={pos} className="text-xs text-muted-foreground">
                        {pos}
                      </span>
                    ))}
                  </div>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setAvailableOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleApplyAvailable} data-testid="button-apply-available">
              Apply
            </Button>
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
        <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
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
                  // NOTE: intentionally NO `capture` attribute. iOS Safari
                  // treats `capture="environment"` (and even an empty
                  // `capture`) as a hard request for the rear camera and
                  // will skip the photo-library option entirely — coaches
                  // who already screenshotted a lineup on their phone
                  // couldn't pick it. Without `capture`, iOS shows the
                  // standard "Photo Library / Take Photo / Choose File"
                  // sheet so both flows work.
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
        <DialogContent className="max-w-md max-h-[80dvh] overflow-y-auto">
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
                        <span className="text-sm font-medium" title={g.opponent}>vs. {formatOpponentForMatchup(g.opponent, teamName) || g.opponent}</span>
                        {(() => {
                          const eff = effectiveStatus(g);
                          if (eff === "completed")
                            return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-[10px] px-1.5 py-0">Played</Badge>;
                          if (eff === "past")
                            return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px] px-1.5 py-0">Past</Badge>;
                          if (eff === "cancelled")
                            return <Badge variant="outline" className="text-[10px] px-1.5 py-0">Cancelled</Badge>;
                          return <Badge variant="outline" className="text-[10px] px-1.5 py-0">Upcoming</Badge>;
                        })()}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span>{safeFormatDate(g.gameDate, "EEE, MMM d, yyyy")}</span>
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
      <Dialog
        open={endEarlyOpen}
        onOpenChange={(o) => {
          if (!o) {
            setEndEarlyOpen(false);
            setEndEarlyLastInning("");
          }
        }}
      >
        <DialogContent className="max-w-sm" data-testid="dialog-game-ended-early">
          <DialogHeader>
            <DialogTitle>Game Ended Early</DialogTitle>
            <DialogDescription>
              Pick the last inning that was actually played. Innings after that will be removed
              from this game's lineup, locks, and assistant pins.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label>Last inning played</Label>
              <Select
                value={endEarlyLastInning}
                onValueChange={(v) => setEndEarlyLastInning(v)}
              >
                <SelectTrigger data-testid="select-last-inning">
                  <SelectValue placeholder="Select inning" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: Math.max(0, (game?.innings ?? 0) - 1) }, (_, i) => i + 1).map(
                    (n) => (
                      <SelectItem key={n} value={String(n)} data-testid={`select-inning-${n}`}>
                        Inning {n}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Currently scheduled for {game?.innings ?? 0} innings.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEndEarlyOpen(false);
                setEndEarlyLastInning("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEndEarly}
              disabled={
                updateGame.isPending ||
                !endEarlyLastInning ||
                parseInt(endEarlyLastInning) < 1 ||
                parseInt(endEarlyLastInning) >= (game?.innings ?? 0)
              }
              data-testid="button-confirm-end-early"
            >
              {updateGame.isPending ? "Saving..." : "Shorten Game"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Add Lock Dialog */}
      <Dialog open={addLockOpen} onOpenChange={(o) => !o && setAddLockOpen(false)}>
        <DialogContent className="max-w-sm" data-testid="dialog-add-lock">
          <DialogHeader>
            <DialogTitle>Add Position Lock</DialogTitle>
            <DialogDescription>
              Pin a player to a position for any combination of innings — pick one,
              pick a few, or every inning of this game.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lock-player">Player</Label>
              <Select value={lockPlayerId} onValueChange={setLockPlayerId}>
                <SelectTrigger id="lock-player" data-testid="select-lock-player">
                  <SelectValue placeholder="Pick a player" />
                </SelectTrigger>
                <SelectContent>
                  {players
                    .filter((p) => p.active)
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((p) => (
                      <SelectItem key={p.id} value={String(p.id)} data-testid={`option-lock-player-${p.id}`}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lock-position">Position</Label>
              <Select value={lockPosition} onValueChange={setLockPosition}>
                <SelectTrigger id="lock-position" data-testid="select-lock-position">
                  <SelectValue placeholder="Pick a position" />
                </SelectTrigger>
                <SelectContent>
                  {[...displayPositions, "Bench"].map((pos) => (
                    <SelectItem key={pos} value={pos} data-testid={`option-lock-position-${pos}`}>
                      {pos}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Innings</Label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      const all = new Set<number>();
                      for (let i = 1; i <= game.innings; i++) all.add(i);
                      setLockInnings(all);
                    }}
                    data-testid="button-lock-innings-all"
                  >
                    All
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setLockInnings(new Set())}
                    data-testid="button-lock-innings-none"
                  >
                    None
                  </button>
                </div>
              </div>
              <div
                className="grid grid-cols-3 gap-2 rounded-md border border-border p-2"
                data-testid="grid-lock-innings"
              >
                {Array.from({ length: game.innings }, (_, i) => i + 1).map((n) => {
                  const checked = lockInnings.has(n);
                  return (
                    <label
                      key={n}
                      htmlFor={`lock-inning-${n}`}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded border text-sm cursor-pointer transition-colors ${
                        checked
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border/60 hover:border-border text-muted-foreground"
                      }`}
                      data-testid={`label-lock-inning-${n}`}
                    >
                      <Checkbox
                        id={`lock-inning-${n}`}
                        checked={checked}
                        onCheckedChange={(v) => {
                          setLockInnings((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(n);
                            else next.delete(n);
                            return next;
                          });
                        }}
                        data-testid={`checkbox-lock-inning-${n}`}
                      />
                      <span>Inn {n}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {lockInnings.size === 0
                  ? "Pick at least one inning."
                  : lockInnings.size === game.innings
                    ? "All innings selected."
                    : `${lockInnings.size} of ${game.innings} innings selected.`}
              </p>
            </div>
            {lockError && (
              <p className="text-sm text-destructive" data-testid="text-lock-error">{lockError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddLockOpen(false)} disabled={lockSubmitting}>Cancel</Button>
            <Button onClick={handleSaveLock} disabled={lockSubmitting} data-testid="button-save-lock">
              {lockSubmitting ? "Saving..." : "Add Lock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo override: Replace vs Keep-original choice. Shown after a photo
          was successfully parsed and a saved lineup already exists. */}
      <Dialog
        open={replaceConfirmOpen}
        onOpenChange={(o) => {
          if (!o) {
            setReplaceConfirmOpen(false);
            setPendingPhotoLineup(null);
          }
        }}
      >
        <DialogContent className="max-w-md" data-testid="dialog-replace-confirm">
          <DialogHeader>
            <DialogTitle>Replace the saved lineup?</DialogTitle>
            <DialogDescription>
              You already have a lineup for this game. Do you want to keep your
              original plan as a snapshot, or just replace it with what was on
              the photo?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setReplaceConfirmOpen(false);
                setPendingPhotoLineup(null);
              }}
              disabled={snapshotPlan.isPending || saveLineup.isPending}
              data-testid="button-photo-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => applyPhotoOverride(false)}
              disabled={snapshotPlan.isPending || saveLineup.isPending}
              data-testid="button-photo-replace"
            >
              Replace
            </Button>
            <Button
              onClick={() => applyPhotoOverride(true)}
              disabled={snapshotPlan.isPending || saveLineup.isPending}
              data-testid="button-photo-keep"
            >
              {snapshotPlan.isPending ? "Saving original..." : "Keep original"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lineup-source chooser. Single CTA replaces the old three-button row;
          each option just dispatches to the existing handler and closes. */}
      <Dialog open={lineupActionsOpen} onOpenChange={setLineupActionsOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-lineup-actions">
          <DialogHeader>
            <DialogTitle>
              {lineup.length > 0 ? "Replace lineup" : "Set lineup"}
            </DialogTitle>
            <DialogDescription>
              Pick where this lineup should come from. You can still tweak it
              by hand after.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setLineupActionsOpen(false);
                openGenerate();
              }}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
              data-testid="lineup-action-generate"
            >
              <Wand2 className="h-5 w-5 mt-0.5 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-sm">Generate with AI</div>
                <div className="text-xs text-muted-foreground leading-snug">
                  Auto-build a fair rotation from your roster, preferences, and
                  fairness dial.
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setLineupActionsOpen(false);
                openImage();
              }}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
              data-testid="lineup-action-screenshot"
            >
              <Camera className="h-5 w-5 mt-0.5 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-sm">
                  Upload lineup screenshot
                </div>
                <div className="text-xs text-muted-foreground leading-snug">
                  Snap or upload a photo of your handwritten lineup card and
                  we'll read it.
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setLineupActionsOpen(false);
                openCopy();
              }}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
              data-testid="lineup-action-copy"
            >
              <CopyIcon className="h-5 w-5 mt-0.5 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-sm">
                  Copy from a previous game
                </div>
                <div className="text-xs text-muted-foreground leading-snug">
                  Reuse positions from any saved game on your schedule.
                </div>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Read-only view of the snapshotted plan from before a photo override. */}
      <Dialog open={viewPlanOpen} onOpenChange={(o) => !o && setViewPlanOpen(false)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-view-plan">
          <DialogHeader>
            <DialogTitle>Original plan</DialogTitle>
            <DialogDescription>
              This is the lineup you saved before importing a photo override.
            </DialogDescription>
          </DialogHeader>
          {game.planSnapshot && game.planSnapshot.length > 0 ? (
            <div className="max-h-[60dvh] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Inning</th>
                    <th className="px-3 py-2 font-medium">Order</th>
                    <th className="px-3 py-2 font-medium">Player</th>
                    <th className="px-3 py-2 font-medium">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {game.planSnapshot
                    .slice()
                    .sort(
                      (a, b) =>
                        a.inning - b.inning ||
                        (a.battingOrder ?? 99) - (b.battingOrder ?? 99),
                    )
                    .map((e, i) => (
                      <tr
                        key={`${e.inning}-${e.playerId}-${i}`}
                        className="border-t"
                        data-testid={`row-plan-snapshot-${i}`}
                      >
                        <td className="px-3 py-2">{e.inning}</td>
                        <td className="px-3 py-2">{e.battingOrder ?? "—"}</td>
                        <td className="px-3 py-2">{e.playerName}</td>
                        <td className="px-3 py-2">{e.position}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No snapshot saved.</p>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setViewPlanOpen(false)}
              data-testid="button-close-view-plan"
            >
              Close
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearSnapshot}
              disabled={clearPlanSnapshot.isPending}
              data-testid="button-discard-snapshot"
            >
              {clearPlanSnapshot.isPending ? "Discarding..." : "Discard snapshot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={depthChartOpen} onOpenChange={setDepthChartOpen}>
        <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DepthChartIcon className="h-5 w-5 text-primary" />
              Depth Chart
            </DialogTitle>
            <DialogDescription>
              Quick reference for tonight's matchups. Edit on the{" "}
              <Link href="/depth-chart" className="text-primary underline">
                full Depth Chart page
              </Link>
              .
            </DialogDescription>
          </DialogHeader>
          <DepthChartReference topN={3} />
        </DialogContent>
      </Dialog>

      {/* Box-score offer. Arriving from the field-display "Mark complete &
          finish" flow asks first instead of auto-opening the importer, so
          coaches who don't track box scores aren't forced through it. */}
      {sportProfile.features.boxScoreImport && (
        <AlertDialog
          open={boxScorePromptOpen}
          onOpenChange={(o) => !o && setBoxScorePromptOpen(false)}
        >
          <AlertDialogContent data-testid="dialog-box-score-offer">
            <AlertDialogHeader>
              <AlertDialogTitle>Load a box score for this game?</AlertDialogTitle>
              <AlertDialogDescription>
                Do you want to load a box score in for this game for pitch
                counting and batting statistics? You can always import one
                later from the game page.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => setBoxScorePromptOpen(false)}
                data-testid="button-box-score-offer-no"
              >
                No, not now
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setBoxScorePromptOpen(false);
                  setBoxScoreOpen(true);
                }}
                data-testid="button-box-score-offer-yes"
              >
                Yes, load box score
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {boxScoreOpen && (
        <BoxScoreImportDialog
          gameId={game.id}
          gameInnings={game.innings}
          players={players ?? []}
          open={boxScoreOpen}
          onOpenChange={setBoxScoreOpen}
        />
      )}

      {editGameOpen && (
        <EditGameDialog
          game={{
            id: game.id,
            opponent: game.opponent,
            gameDate: game.gameDate,
            location: game.location ?? null,
            innings: game.innings,
            status: game.status,
            gameType: game.gameType ?? null,
            tournamentId: game.tournamentId ?? null,
            bracketStage:
              game.bracketStage === "pool" || game.bracketStage === "bracket"
                ? game.bracketStage
                : null,
            notes: game.notes ?? null,
          }}
          onClose={() => setEditGameOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: getGetGameQueryKey(id) });
            qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
          }}
        />
      )}
    </div>
  );
}
