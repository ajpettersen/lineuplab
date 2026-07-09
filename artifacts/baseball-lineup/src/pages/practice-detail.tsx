import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPractice,
  useUpdatePractice,
  useDeletePractice,
  useGeneratePracticePlan,
  useReplacePracticeAttendance,
  useListPlayers,
  getGetPracticeQueryKey,
  getListPracticesQueryKey,
  updatePractice,
  replacePracticeAttendance,
  type PracticeBlock,
  type PracticeDetail,
} from "@workspace/api-client-react";
import {
  PRACTICE_FOCUS_AREAS,
  PRACTICE_DRILL_TYPES,
  FOCUS_AREA_BY_KEY,
  DRILL_TYPE_BY_KEY,
} from "@/lib/practice-focus-areas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  CalendarDays,
  Clipboard,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  ChevronUp,
  ChevronDown,
  Users,
  Check,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { showUndoToast, restoreEntity } from "@/lib/undo-toast";
import { useToast } from "@/hooks/use-toast";
import { withSync, newSyncMeta, syncRequestInit } from "@/lib/sync-envelope";
import { isVersionConflict } from "@/lib/conflict-registry";

function makeBlockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function dateToInputDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateToInputTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function combineDateTimeISO(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

function reindex(blocks: PracticeBlock[]): PracticeBlock[] {
  return blocks.map((b, i) => ({ ...b, orderIndex: i }));
}

function totalBlockMinutes(blocks: PracticeBlock[]): number {
  return blocks.reduce((s, b) => s + (b.durationMinutes || 0), 0);
}

/**
 * Compute the wall-clock start of each block by walking from the
 * practice's start time and adding each block's duration. Returns an
 * array of "h:mm a" labels parallel to `blocks`.
 */
function blockStartLabels(practiceStart: Date, blocks: PracticeBlock[]): string[] {
  const labels: string[] = [];
  let cursor = new Date(practiceStart);
  for (const b of blocks) {
    labels.push(format(cursor, "h:mm a"));
    cursor = new Date(cursor.getTime() + (b.durationMinutes || 0) * 60_000);
  }
  return labels;
}

export default function PracticeDetailPage() {
  const [, params] = useRoute("/practices/:id");
  const practiceId = parseInt(params?.id ?? "0", 10);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: practice, isLoading, isError } = useGetPractice(practiceId, {
    query: {
      enabled: !!practiceId,
      queryKey: getGetPracticeQueryKey(practiceId),
    },
  });
  const { data: players = [] } = useListPlayers();
  const activePlayers = useMemo(() => players.filter((p) => p.active), [players]);

  // Header-edit dialog uses the React Query hook (one-shot, modal-gated, can
  // safely await mutateAsync). Block + attendance writes bypass the hook
  // and go through dedicated single-flight chains below — see the long
  // comment over `flushBlocks` for why hook-managed mutations don't fit
  // those flows.
  const update = useUpdatePractice({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetPracticeQueryKey(practiceId) });
        void qc.invalidateQueries({ queryKey: getListPracticesQueryKey() });
      },
      onError: (err) => {
        // 409 conflicts are surfaced by the global ConflictListener
        // (toast + tray); a second "failed" toast would read as a bug.
        if (isVersionConflict(err)) return;
        toast({
          title: "Couldn't save",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      },
    },
  });

  const del = useDeletePractice({
    mutation: {
      onSuccess: (_data, vars) => {
        void qc.invalidateQueries({ queryKey: getListPracticesQueryKey() });
        const idToRestore = vars?.id ?? practiceId;
        showUndoToast(toast, {
          title: "Practice deleted",
          onUndo: async () => {
            try {
              await restoreEntity("practices", idToRestore);
              void qc.invalidateQueries({ queryKey: getListPracticesQueryKey() });
              toast({ title: "Practice restored" });
            } catch {
              toast({ title: "Couldn't undo", variant: "destructive" });
            }
          },
        });
        window.history.back();
      },
      onError: (err) => {
        // 409 conflicts are surfaced by the global ConflictListener.
        if (isVersionConflict(err)) return;
        toast({
          title: "Couldn't delete practice",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      },
    },
  });

  const generate = useGeneratePracticePlan({
    mutation: {
      onSuccess: (resp) => {
        // Persist the AI's blocks through the same single-flight chain that
        // handles user reorders/edits — keeps the server's view consistent
        // even if the coach is mid-drag when the AI response lands.
        saveBlocksOptimistically(reindex(resp.blocks));
        toast({ title: "Plan generated", description: resp.rationale });
      },
      onError: (err) => {
        // ApiError exposes `status`; surface specific HTTP failures with
        // actionable copy so a transient (server restart / Clerk session
        // rotation) doesn't look like a generic AI outage.
        const status =
          err && typeof err === "object" && "status" in err
            ? (err as { status?: unknown }).status
            : undefined;
        let title = "Couldn't generate plan";
        let description = err instanceof Error ? err.message : String(err);
        if (status === 401) {
          title = "Session expired";
          description = "Refresh the page and try again.";
        } else if (status === 504) {
          description = "The AI took too long to respond. Try again.";
        } else if (status === 502) {
          description = "AI service is unavailable right now. Try again in a minute.";
        }
        toast({ title, description, variant: "destructive" });
      },
    },
  });

  // Hook is unused now (writes go through `flushAttendance`'s single-flight
  // chain) but referenced for type re-export shape — keep the call site so
  // future maintainers see the canonical hook name. We just don't subscribe.
  void useReplacePracticeAttendance;

  // ---- Header (date / duration / title / focus chips) — local edit state.
  const [editHeaderOpen, setEditHeaderOpen] = useState(false);
  const [hDate, setHDate] = useState("");
  const [hTime, setHTime] = useState("");
  const [hDuration, setHDuration] = useState(90);
  const [hTitle, setHTitle] = useState("");
  const [hFocus, setHFocus] = useState<string[]>([]);
  const [hNotes, setHNotes] = useState("");
  const seedHeader = (p: PracticeDetail) => {
    const dt = new Date(p.date);
    setHDate(dateToInputDate(dt));
    setHTime(dateToInputTime(dt));
    setHDuration(p.durationMinutes);
    setHTitle(p.title ?? "");
    setHFocus(p.focusAreas ?? []);
    setHNotes(p.notes ?? "");
  };
  const openHeaderDialog = () => {
    if (practice) seedHeader(practice);
    setEditHeaderOpen(true);
  };
  const submitHeader = () => {
    update.mutate(
      withSync(
        {
          id: practiceId,
          data: {
            date: combineDateTimeISO(hDate, hTime),
            durationMinutes: hDuration,
            title: hTitle.trim() || null,
            focusAreas: hFocus,
            notes: hNotes.trim() || null,
          },
        },
        practice?.rowVersion,
      ),
    );
    // Close immediately (not in onSuccess): while offline the update
    // pauses in the queue and onSuccess wouldn't fire until reconnect.
    setEditHeaderOpen(false);
  };

  // ---- Focus points ("Things to work on") — coach-authored bullet
  // list that the AI uses to design drills around weaknesses. Same
  // single-flight save chain pattern as `flushBlocks`: only one PATCH
  // is in flight at a time, and rapid add/remove during an in-flight
  // save coalesce into ONE follow-up PATCH carrying the latest
  // snapshot. This matters because focusPoints is a JSONB column with
  // REPLACE semantics — two racing PATCHes could complete out of
  // order and the older one's payload would silently overwrite the
  // newer one's. On error we drop pending and invalidate so the UI
  // pulls authoritative server state (rather than leaving an
  // incorrect optimistic state stuck on screen).
  const [localFocusPoints, setLocalFocusPoints] = useState<string[]>([]);
  const [newFocusPoint, setNewFocusPoint] = useState("");
  const pendingFocusPointsRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (practice && pendingFocusPointsRef.current === null) {
      setLocalFocusPoints(practice.focusPoints ?? []);
    }
  }, [practice]);
  const saveFocusPointsQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const flushFocusPoints = () => {
    saveFocusPointsQueueRef.current = saveFocusPointsQueueRef.current
      .then(async () => {
        const toSave = pendingFocusPointsRef.current;
        if (!toSave) return;
        pendingFocusPointsRef.current = null;
        try {
          await qc.cancelQueries({
            queryKey: getGetPracticeQueryKey(practiceId),
          });
          await updatePractice(
            practiceId,
            { focusPoints: toSave },
            // Idempotency-only envelope (no If-Match): this bespoke
            // single-flight chain keeps last-writer-wins REPLACE
            // semantics for the JSONB focusPoints column.
            syncRequestInit(newSyncMeta()),
          );
          if (pendingFocusPointsRef.current == null) {
            void qc.invalidateQueries({
              queryKey: getGetPracticeQueryKey(practiceId),
            });
          }
          void qc.invalidateQueries({ queryKey: getListPracticesQueryKey() });
        } catch (err) {
          // Same recovery as flushBlocks: drop pending so the chain
          // can drain, refetch authoritative state, and tell the
          // coach. The next render's sync effect will replace the
          // (now stale) optimistic local list with whatever the
          // server actually has.
          pendingFocusPointsRef.current = null;
          void qc.invalidateQueries({
            queryKey: getGetPracticeQueryKey(practiceId),
          });
          toast({
            title: "Couldn't save",
            description:
              err instanceof Error ? err.message : "Pulled the latest from the server.",
            variant: "destructive",
          });
        }
      })
      .catch(() => {
        // Belt-and-suspenders: a rejected chain promise would make every
        // future flushFocusPoints silently no-op.
      });
  };
  const persistFocusPoints = (next: string[]) => {
    setLocalFocusPoints(next);
    pendingFocusPointsRef.current = next;
    flushFocusPoints();
  };
  const addFocusPoint = () => {
    const trimmed = newFocusPoint.trim().slice(0, 200);
    if (!trimmed) return;
    // Case-insensitive dupe check matches the server's dedupeFocusPoints
    // so a coach who tries "bunt defense" twice doesn't get a phantom
    // optimistic insert that disappears on the next server round-trip.
    if (localFocusPoints.some((fp) => fp.toLowerCase() === trimmed.toLowerCase())) {
      setNewFocusPoint("");
      return;
    }
    if (localFocusPoints.length >= 20) {
      toast({
        title: "Max 20 items",
        description: "Remove one first.",
        variant: "destructive",
      });
      return;
    }
    persistFocusPoints([...localFocusPoints, trimmed]);
    setNewFocusPoint("");
  };
  const removeFocusPoint = (idx: number) => {
    persistFocusPoints(localFocusPoints.filter((_, i) => i !== idx));
  };

  // ---- Blocks editor — local mirror so up/down/delete are responsive,
  // then PATCH to persist via a single-flight save chain (see flushBlocks).
  const [localBlocks, setLocalBlocks] = useState<PracticeBlock[]>([]);
  // Sync local from server snapshot. Skip the sync while a save is pending
  // so a slow PATCH response (or a 5s background refetch landing right
  // after our optimistic update) can't snap the UI back to the pre-edit
  // state.
  const pendingBlocksRef = useRef<PracticeBlock[] | null>(null);
  useEffect(() => {
    if (practice && pendingBlocksRef.current === null) {
      setLocalBlocks(practice.blocks ?? []);
    }
  }, [practice]);

  /**
   * Single-flight save chain for blocks. Same pattern as field-display's
   * lineup chain: only one PATCH is ever in flight; rapid reorders/edits
   * during an in-flight save coalesce into ONE follow-up PATCH carrying
   * the latest snapshot.
   *
   * Why this matters: blocks are stored as a JSONB column with REPLACE
   * semantics — two racing PATCHes can complete out of order, and the
   * older one's payload would silently overwrite the newer one's order.
   * Serializing the chain guarantees client intent (latest pending state)
   * wins regardless of network timing.
   */
  const saveBlocksQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const flushBlocks = () => {
    saveBlocksQueueRef.current = saveBlocksQueueRef.current
      .then(async () => {
        const toSave = pendingBlocksRef.current;
        if (!toSave) return;
        // Mark as in-flight so a follow-up edit during this save sets a
        // fresh ref value (which the next chained .then picks up).
        pendingBlocksRef.current = null;
        try {
          await qc.cancelQueries({
            queryKey: getGetPracticeQueryKey(practiceId),
          });
          await updatePractice(
            practiceId,
            { blocks: reindex(toSave) },
            // Idempotency-only envelope (no If-Match): this bespoke
            // single-flight chain keeps last-writer-wins REPLACE
            // semantics for the JSONB blocks column.
            syncRequestInit(newSyncMeta()),
          );
          // Clear list-page cache so list shows current block count;
          // skip detail invalidation if a newer edit is already pending
          // (otherwise the refetch would race with our next PATCH).
          if (pendingBlocksRef.current == null) {
            void qc.invalidateQueries({
              queryKey: getGetPracticeQueryKey(practiceId),
            });
          }
          void qc.invalidateQueries({ queryKey: getListPracticesQueryKey() });
        } catch (err) {
          // Drop pending so the chain can drain; pull authoritative state
          // back from the server. Don't snapshot-rollback (could clobber
          // a newer successful save that landed in a different chain).
          pendingBlocksRef.current = null;
          void qc.invalidateQueries({
            queryKey: getGetPracticeQueryKey(practiceId),
          });
          toast({
            title: "Couldn't save plan",
            description:
              err instanceof Error ? err.message : "Pulled the latest from the server.",
            variant: "destructive",
          });
        }
      })
      .catch(() => {
        // Belt-and-suspenders: a rejected chain promise would make every
        // future flushBlocks silently no-op. Swallow here so the queue
        // stays alive across errors.
      });
  };
  const saveBlocksOptimistically = (next: PracticeBlock[]) => {
    setLocalBlocks(next);
    pendingBlocksRef.current = next;
    flushBlocks();
  };
  const moveBlock = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= localBlocks.length) return;
    const next = localBlocks.slice();
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    saveBlocksOptimistically(next);
  };
  const deleteBlock = (idx: number) => {
    saveBlocksOptimistically(localBlocks.filter((_, i) => i !== idx));
  };

  // ---- Block editor dialog (add or edit).
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [editingBlockIdx, setEditingBlockIdx] = useState<number | null>(null);
  const [bTitle, setBTitle] = useState("");
  const [bDuration, setBDuration] = useState(15);
  const [bDescription, setBDescription] = useState("");
  const [bDrillType, setBDrillType] = useState("drill");
  const [bFocus, setBFocus] = useState<string[]>([]);
  const openAddBlock = () => {
    setEditingBlockIdx(null);
    setBTitle("");
    setBDuration(15);
    setBDescription("");
    setBDrillType("drill");
    setBFocus(practice?.focusAreas?.slice(0, 1) ?? []);
    setBlockDialogOpen(true);
  };
  const openEditBlock = (idx: number) => {
    const b = localBlocks[idx];
    if (!b) return;
    setEditingBlockIdx(idx);
    setBTitle(b.title);
    setBDuration(b.durationMinutes);
    setBDescription(b.description);
    setBDrillType(b.drillType);
    setBFocus(b.focusAreas);
    setBlockDialogOpen(true);
  };
  const submitBlock = () => {
    const trimmedTitle = bTitle.trim();
    if (!trimmedTitle) {
      toast({ title: "Block needs a title", variant: "destructive" });
      return;
    }
    // Preserve AI-generated groups on edit — the dialog doesn't expose
    // them as editable fields, but we don't want a coach tweaking a
    // block's title to silently wipe its station groupings.
    const existing =
      editingBlockIdx !== null ? localBlocks[editingBlockIdx] : null;
    const block: PracticeBlock = {
      id: editingBlockIdx === null ? makeBlockId() : localBlocks[editingBlockIdx]!.id,
      orderIndex: editingBlockIdx === null ? localBlocks.length : editingBlockIdx,
      title: trimmedTitle,
      durationMinutes: Math.max(1, Math.min(240, bDuration)),
      description: bDescription.trim(),
      drillType: bDrillType,
      focusAreas: bFocus,
      ...(existing?.groups && existing.groups.length > 0
        ? { groups: existing.groups }
        : {}),
      // Preserve AI-tagged "addresses these focus points" badges on
      // edit — the dialog doesn't expose them as editable fields, but
      // a coach tweaking a block's title shouldn't silently wipe its
      // tags (same reasoning as `groups` above).
      ...(existing?.addressesFocusPoints && existing.addressesFocusPoints.length > 0
        ? { addressesFocusPoints: existing.addressesFocusPoints }
        : {}),
    };
    const next =
      editingBlockIdx === null
        ? [...localBlocks, block]
        : localBlocks.map((b, i) => (i === editingBlockIdx ? block : b));
    saveBlocksOptimistically(next);
    setBlockDialogOpen(false);
  };

  // ---- Generate-plan dialog. Reuses the practice's own focus areas +
  // notes (set in the header dialog) so we don't duplicate fields. The
  // dialog only collects what's specific to this generation: required
  // drills the coach wants guaranteed in the plan.
  const [genOpen, setGenOpen] = useState(false);
  // Coach-supplied "must include" drills, one per line. Sent as a string[]
  // and the AI is told each entry MUST appear as its own block. Kept as
  // free text in the input so the coach can type naturally; we split on
  // newlines at submit time.
  const [genRequiredDrills, setGenRequiredDrills] = useState("");
  const submitGenerate = () => {
    if (!practice) return;
    if ((practice.focusAreas ?? []).length === 0) {
      toast({
        title: "Pick at least one focus area first",
        description: "Edit the practice header and add focus areas the AI should plan around.",
        variant: "destructive",
      });
      return;
    }
    const requiredDrills = genRequiredDrills
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 10);
    generate.mutate(
      {
        id: practiceId,
        data: {
          focusAreas: practice.focusAreas ?? [],
          durationMinutes: practice.durationMinutes,
          // Use the practice's persistent notes as AI guidance rather than
          // a separate one-shot dialog field — one source of truth.
          coachNotes: practice.notes?.trim() || null,
          ...(requiredDrills.length > 0 ? { requiredDrills } : {}),
        },
      },
      { onSuccess: () => setGenOpen(false) },
    );
  };

  // ---- Attendance — optimistic per-row toggle. We keep a local snapshot
  // (one row per active player, attended=null until the coach marks it) and
  // a single-flight save chain that coalesces rapid toggles into one PUT.
  type AttRow = { playerId: number; attended: boolean | null; notes: string | null };
  const [attDraft, setAttDraft] = useState<Map<number, AttRow>>(new Map());
  // Pending TOGGLES (only the rows the user changed since the last flush);
  // playerId-keyed so two rapid toggles on the same player coalesce to the
  // latest value.
  const pendingAttRef = useRef<Map<number, AttRow>>(new Map());
  const saveAttQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastSyncedAttRef = useRef<string>("");

  // Sync local draft from server snapshot. Stamp uses a SORTED-by-playerId
  // serialization so the server returning the same data in a different row
  // order doesn't spuriously reset the draft (which would clobber a queued
  // optimistic toggle). Also skip the sync while there are pending writes
  // — the next flush will round-trip and bump the stamp naturally.
  useEffect(() => {
    if (!practice) return;
    const map = new Map<number, AttRow>();
    for (const p of activePlayers) {
      map.set(p.id, { playerId: p.id, attended: null, notes: null });
    }
    const sortedAtt = (practice.attendance ?? [])
      .slice()
      .sort((a, b) => a.playerId - b.playerId);
    for (const a of sortedAtt) {
      map.set(a.playerId, {
        playerId: a.playerId,
        attended: a.attended,
        notes: a.notes ?? null,
      });
    }
    const stamp = JSON.stringify(
      sortedAtt.map((a) => [a.playerId, a.attended, a.notes]),
    );
    const hasPending = pendingAttRef.current.size > 0;
    if (stamp !== lastSyncedAttRef.current && !hasPending) {
      lastSyncedAttRef.current = stamp;
      setAttDraft(map);
    } else if (stamp !== lastSyncedAttRef.current && hasPending) {
      // Server changed but we have local edits — merge: take server state
      // for unchanged players, keep our pending overrides on top.
      const merged = new Map(map);
      for (const [pid, row] of pendingAttRef.current) merged.set(pid, row);
      lastSyncedAttRef.current = stamp;
      setAttDraft(merged);
    }
  }, [practice, activePlayers]);

  /**
   * Single-flight attendance save. Drains `pendingAttRef` (the toggles since
   * last flush). Same pattern as flushBlocks — rapid toggles during an
   * in-flight PUT coalesce into ONE follow-up PUT, and we never have two
   * in-flight requests racing each other.
   */
  const flushAttendance = () => {
    saveAttQueueRef.current = saveAttQueueRef.current
      .then(async () => {
        if (pendingAttRef.current.size === 0) return;
        const entries = Array.from(pendingAttRef.current.values())
          .filter((r) => r.attended !== null)
          .map((r) => ({
            playerId: r.playerId,
            attended: r.attended as boolean,
            notes: r.notes,
          }));
        pendingAttRef.current = new Map();
        if (entries.length === 0) return;
        try {
          await replacePracticeAttendance(
            practiceId,
            { entries },
            // Idempotency-only envelope (no If-Match): attendance is an
            // idempotent full REPLACE, so this bespoke single-flight
            // chain stays last-writer-wins.
            syncRequestInit(newSyncMeta()),
          );
          if (pendingAttRef.current.size === 0) {
            void qc.invalidateQueries({
              queryKey: getGetPracticeQueryKey(practiceId),
            });
          }
          void qc.invalidateQueries({ queryKey: getListPracticesQueryKey() });
        } catch (err) {
          pendingAttRef.current = new Map();
          void qc.invalidateQueries({
            queryKey: getGetPracticeQueryKey(practiceId),
          });
          toast({
            title: "Couldn't save attendance",
            description:
              err instanceof Error ? err.message : "Pulled the latest from the server.",
            variant: "destructive",
          });
        }
      })
      .catch(() => {
        // Keep the queue alive across errors.
      });
  };

  const toggleAttendance = (playerId: number, next: boolean | null) => {
    setAttDraft((prev) => {
      const copy = new Map(prev);
      const row = copy.get(playerId) ?? { playerId, attended: null, notes: null };
      copy.set(playerId, { ...row, attended: next });
      return copy;
    });
    if (next !== null) {
      pendingAttRef.current.set(playerId, {
        playerId,
        attended: next,
        notes: null,
      });
      flushAttendance();
    }
  };

  const markAllPresent = () => {
    setAttDraft((prev) => {
      const copy = new Map(prev);
      for (const p of activePlayers) {
        copy.set(p.id, { playerId: p.id, attended: true, notes: null });
      }
      return copy;
    });
    for (const p of activePlayers) {
      pendingAttRef.current.set(p.id, {
        playerId: p.id,
        attended: true,
        notes: null,
      });
    }
    flushAttendance();
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !practice) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <Clipboard className="h-10 w-10 mx-auto text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Practice not found</h2>
          <p className="text-sm text-muted-foreground mt-1">
            It may have been deleted, or the link is wrong.
          </p>
        </div>
        <Link href="/practices">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back to practices
          </Button>
        </Link>
      </div>
    );
  }

  const startDt = new Date(practice.date);
  const labels = blockStartLabels(startDt, localBlocks);
  const blocksTotal = totalBlockMinutes(localBlocks);
  const fitsDuration = Math.abs(blocksTotal - practice.durationMinutes) <= 2;
  const presentCount = Array.from(attDraft.values()).filter(
    (r) => r.attended === true,
  ).length;
  const absentCount = Array.from(attDraft.values()).filter(
    (r) => r.attended === false,
  ).length;
  const unmarkedCount = activePlayers.length - presentCount - absentCount;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/practices" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3 w-3" />
            Back to practices
          </Link>
          <div className="eyebrow text-primary/70 mt-1">Practice</div>
          <h1 className="mt-1 page-title text-foreground flex items-center gap-3">
            <Clipboard className="h-7 w-7 text-emerald-600" />
            {practice.title || `${format(startDt, "EEEE")} practice`}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              {format(startDt, "EEE, MMM d, yyyy • h:mm a")}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {practice.durationMinutes} min
            </span>
          </div>
          {(practice.focusAreas ?? []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {(practice.focusAreas ?? []).map((key) => {
                const meta = FOCUS_AREA_BY_KEY[key];
                if (!meta) return null;
                return (
                  <span
                    key={key}
                    className={`text-xs px-2 py-0.5 rounded-full border ${meta.tint}`}
                  >
                    {meta.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={openHeaderDialog}
            data-testid="button-edit-practice"
          >
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Delete this practice? Attendance will be lost.")) {
                del.mutate(withSync({ id: practiceId }, practice?.rowVersion));
              }
            }}
            data-testid="button-delete-practice"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Things to work on — coach bullet list, fed into AI generator */}
      <Card>
        <CardHeader className="space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Things to work on
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Specific weaknesses or skills the team needs reps at. The AI will design drills around these and tag each block with which ones it covers.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {localFocusPoints.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Nothing here yet — try "Bunt defense", "Reading fly balls in LF", "Leading off second base".
            </p>
          ) : (
            <ul className="space-y-1.5" data-testid="list-focus-points">
              {localFocusPoints.map((fp, idx) => (
                <li
                  key={`${idx}-${fp}`}
                  className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-1.5"
                  data-testid={`row-focus-point-${idx}`}
                >
                  <span className="text-sm flex-1 min-w-0 break-words">{fp}</span>
                  <button
                    type="button"
                    onClick={() => removeFocusPoint(idx)}
                    className="p-1 rounded hover:bg-background text-muted-foreground hover:text-destructive shrink-0"
                    aria-label="Remove"
                    data-testid={`button-focus-point-remove-${idx}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 pt-1">
            <Input
              value={newFocusPoint}
              onChange={(e) => setNewFocusPoint(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addFocusPoint();
                }
              }}
              placeholder="Add something to work on…"
              maxLength={200}
              className="h-8 text-sm"
              data-testid="input-new-focus-point"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addFocusPoint}
              disabled={!newFocusPoint.trim() || localFocusPoints.length >= 20}
              data-testid="button-add-focus-point"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Plan / blocks */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Plan</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {localBlocks.length === 0 ? (
                <span className="text-amber-600">No blocks yet — generate a plan or add manually.</span>
              ) : (
                <>
                  {localBlocks.length} block{localBlocks.length === 1 ? "" : "s"} • {blocksTotal} min
                  {!fitsDuration && (
                    <span className="text-amber-600">
                      {" "}
                      (target {practice.durationMinutes})
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={openAddBlock}
              data-testid="button-add-block"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add block
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setGenRequiredDrills("");
                setGenOpen(true);
              }}
              disabled={generate.isPending}
              data-testid="button-generate-plan"
            >
              {generate.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              )}
              {localBlocks.length === 0 ? "Generate plan" : "Regenerate"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {localBlocks.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Pick focus areas above and tap <strong>Generate plan</strong> — the AI will draft a time-blocked drill list you can edit.
            </div>
          ) : (
            localBlocks.map((b, idx) => {
              const drillMeta = DRILL_TYPE_BY_KEY[b.drillType];
              return (
                <div
                  key={b.id}
                  className="rounded-lg border bg-card p-3 flex gap-3"
                  data-testid={`row-block-${idx}`}
                >
                  <div className="flex flex-col items-center justify-start text-xs text-muted-foreground min-w-[64px] pt-0.5">
                    <span className="font-mono">{labels[idx]}</span>
                    <span className="mt-0.5 text-[10px]">{b.durationMinutes} min</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{b.title}</span>
                      {drillMeta && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full border ${drillMeta.badge}`}
                        >
                          {drillMeta.label}
                        </span>
                      )}
                      {b.focusAreas.map((key) => {
                        const meta = FOCUS_AREA_BY_KEY[key];
                        if (!meta) return null;
                        return (
                          <span
                            key={key}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border ${meta.tint}`}
                          >
                            {meta.label}
                          </span>
                        );
                      })}
                    </div>
                    {b.description && (
                      <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                        {b.description}
                      </p>
                    )}
                    {b.addressesFocusPoints && b.addressesFocusPoints.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                          Addresses:
                        </span>
                        {b.addressesFocusPoints.map((fp, fi) => (
                          <span
                            key={`${b.id}-fp-${fi}`}
                            className="text-[10px] px-1.5 py-0.5 rounded-full border bg-primary/5 border-primary/20 text-primary/90"
                            data-testid={`badge-addresses-${idx}-${fi}`}
                          >
                            {fp}
                          </span>
                        ))}
                      </div>
                    )}
                    {b.groups && b.groups.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                          Groups
                        </div>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {b.groups.map((g, gi) => (
                            <div
                              key={`${b.id}-grp-${gi}`}
                              className="rounded border bg-muted/40 px-2 py-1.5"
                              data-testid={`group-${idx}-${gi}`}
                            >
                              <div className="text-[11px] font-medium text-foreground">
                                {g.label}
                                <span className="ml-1 text-muted-foreground font-normal">
                                  ({g.playerNames.length})
                                </span>
                              </div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                                {g.playerNames.join(", ")}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveBlock(idx, -1)}
                      disabled={idx === 0}
                      className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Move up"
                      data-testid={`button-block-up-${idx}`}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveBlock(idx, 1)}
                      disabled={idx === localBlocks.length - 1}
                      className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Move down"
                      data-testid={`button-block-down-${idx}`}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => openEditBlock(idx)}
                      className="p-1 rounded hover:bg-muted"
                      aria-label="Edit block"
                      data-testid={`button-block-edit-${idx}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteBlock(idx)}
                      className="p-1 rounded hover:bg-muted text-destructive"
                      aria-label="Delete block"
                      data-testid={`button-block-delete-${idx}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Attendance */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Attendance
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {presentCount} present • {absentCount} absent • {unmarkedCount} unmarked
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={markAllPresent}
            disabled={activePlayers.length === 0}
            data-testid="button-mark-all-present"
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            Mark all present
          </Button>
        </CardHeader>
        <CardContent>
          {activePlayers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No active players on the roster.
            </p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {activePlayers.map((p) => {
                const row = attDraft.get(p.id);
                const state: "present" | "absent" | "unmarked" =
                  row?.attended === true
                    ? "present"
                    : row?.attended === false
                      ? "absent"
                      : "unmarked";
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2"
                    data-testid={`row-attendance-${p.id}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {p.number != null && (
                        <span className="text-xs text-muted-foreground font-mono w-6 text-right">
                          #{p.number}
                        </span>
                      )}
                      <span className="text-sm truncate">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleAttendance(p.id, true)}
                        className={`px-2 py-1 rounded text-xs border ${
                          state === "present"
                            ? "bg-emerald-100 border-emerald-300 text-emerald-800"
                            : "bg-white border-border text-muted-foreground hover:bg-muted"
                        }`}
                        data-testid={`button-att-present-${p.id}`}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleAttendance(p.id, false)}
                        className={`px-2 py-1 rounded text-xs border ${
                          state === "absent"
                            ? "bg-rose-100 border-rose-300 text-rose-800"
                            : "bg-white border-border text-muted-foreground hover:bg-muted"
                        }`}
                        data-testid={`button-att-absent-${p.id}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit header dialog */}
      <Dialog open={editHeaderOpen} onOpenChange={setEditHeaderOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit practice</DialogTitle>
            <DialogDescription>
              Updating focus areas changes what the AI plans for next time you regenerate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="eh-date">Date</Label>
                <Input
                  id="eh-date"
                  type="date"
                  value={hDate}
                  onChange={(e) => setHDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eh-time">Start time</Label>
                <Input
                  id="eh-time"
                  type="time"
                  value={hTime}
                  onChange={(e) => setHTime(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="eh-duration">Length (min)</Label>
                <NumberInput
                  id="eh-duration"
                  min={15}
                  max={360}
                  step={5}
                  value={hDuration}
                  onChange={setHDuration}
                  fallback={90}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eh-title">Title</Label>
                <Input
                  id="eh-title"
                  value={hTitle}
                  onChange={(e) => setHTitle(e.target.value)}
                  maxLength={120}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Focus areas</Label>
              <div className="flex flex-wrap gap-1.5">
                {PRACTICE_FOCUS_AREAS.map((f) => {
                  const active = hFocus.includes(f.key);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() =>
                        setHFocus((prev) =>
                          prev.includes(f.key)
                            ? prev.filter((k) => k !== f.key)
                            : [...prev, f.key],
                        )
                      }
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        active
                          ? f.tint
                          : "bg-white text-muted-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eh-notes">Notes</Label>
              <Textarea
                id="eh-notes"
                value={hNotes}
                onChange={(e) => setHNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditHeaderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitHeader} disabled={update.isPending}>
              {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block edit dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBlockIdx === null ? "New block" : "Edit block"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="b-title">Title</Label>
              <Input
                id="b-title"
                value={bTitle}
                onChange={(e) => setBTitle(e.target.value)}
                placeholder="e.g. Tee work + soft toss"
                data-testid="input-block-title"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="b-duration">Length (min)</Label>
                <NumberInput
                  id="b-duration"
                  min={1}
                  max={240}
                  step={5}
                  value={bDuration}
                  onChange={setBDuration}
                  fallback={15}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-drilltype">Type</Label>
                <Select value={bDrillType} onValueChange={setBDrillType}>
                  <SelectTrigger id="b-drilltype">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRACTICE_DRILL_TYPES.map((d) => (
                      <SelectItem key={d.key} value={d.key}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Focus areas</Label>
              <div className="flex flex-wrap gap-1.5">
                {PRACTICE_FOCUS_AREAS.map((f) => {
                  const active = bFocus.includes(f.key);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() =>
                        setBFocus((prev) =>
                          prev.includes(f.key)
                            ? prev.filter((k) => k !== f.key)
                            : [...prev, f.key],
                        )
                      }
                      className={`text-xs px-2 py-0.5 rounded-full border ${
                        active
                          ? f.tint
                          : "bg-white text-muted-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-description">Description</Label>
              <Textarea
                id="b-description"
                value={bDescription}
                onChange={(e) => setBDescription(e.target.value)}
                rows={4}
                placeholder="What the kids do, how the coach runs it…"
                data-testid="input-block-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitBlock} data-testid="button-save-block">
              Save block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate plan dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {localBlocks.length === 0 ? "Generate plan" : "Regenerate plan"}
            </DialogTitle>
            <DialogDescription>
              The AI will draft a time-blocked plan from your focus areas
              {localBlocks.length > 0 && ", replacing the current blocks"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Duration:</span>{" "}
              <span className="font-medium">{practice.durationMinutes} min</span>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Focus areas
              </Label>
              <div className="flex flex-wrap gap-1">
                {(practice.focusAreas ?? []).length === 0 ? (
                  <span className="text-xs text-amber-600">
                    No focus areas — edit the practice header to add some.
                  </span>
                ) : (
                  (practice.focusAreas ?? []).map((key) => {
                    const meta = FOCUS_AREA_BY_KEY[key];
                    if (!meta) return null;
                    return (
                      <span
                        key={key}
                        className={`text-xs px-2 py-0.5 rounded-full border ${meta.tint}`}
                      >
                        {meta.label}
                      </span>
                    );
                  })
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-required">Must-include drills (optional)</Label>
              <Textarea
                id="g-required"
                value={genRequiredDrills}
                onChange={(e) => setGenRequiredDrills(e.target.value)}
                rows={3}
                placeholder={"One drill per line — each becomes its own block.\ne.g. 4-corners infield\nPickoff plays at 1st"}
                data-testid="input-generate-required-drills"
              />
              <p className="text-[11px] text-muted-foreground">
                Each line will appear as its own block in the plan.
              </p>
            </div>
            {practice.notes?.trim() && (
              <div className="space-y-1">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Notes (from practice header)
                </Label>
                <p className="text-xs text-muted-foreground italic whitespace-pre-wrap rounded border bg-muted/40 px-2 py-1.5">
                  {practice.notes}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  These will be sent to the AI. Edit the practice header to change them.
                </p>
              </div>
            )}
            {activePlayers.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                For infield/outfield/catching/pitching blocks, the AI may split players into groups by preferred position.
                {Array.from(attDraft.values()).some((r) => r.attended !== null)
                  ? " Today's attendance will limit groups to players marked present."
                  : " Mark attendance below first if you want groups limited to who's actually here."}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitGenerate}
              disabled={generate.isPending || (practice.focusAreas ?? []).length === 0}
              data-testid="button-confirm-generate"
            >
              {generate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-1.5" />
                  Generate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
