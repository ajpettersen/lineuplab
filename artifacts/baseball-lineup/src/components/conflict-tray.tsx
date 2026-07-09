import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  getConflictResolver,
  logConflictResolution,
  removeConflict,
  useConflicts,
  type ConflictResolutionChoice,
  type VersionConflict,
} from "@/lib/conflict-registry";

/**
 * Conflict tray — the resolution surface for version conflicts.
 *
 * Rendered inside the sync-status chip's popover whenever the
 * conflict store is non-empty. Each conflict shows a small
 * "mine vs theirs" diff and two (sometimes three) actions:
 *
 *   • Keep mine   — re-fire my edit pinned to the server's current
 *                   rowVersion (deliberate overwrite, not a race).
 *   • Keep theirs — drop my edit and keep what the other device wrote.
 *   • Merge       — only when a per-domain resolver registered one
 *                   (additive collections: attendance, pitch counts).
 *
 * Every path ends with `removeConflict` + query invalidation so the
 * UI converges on the server's post-resolution state.
 */

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    // ISO timestamps read badly in a 300px tray; show the date part.
    const isoMatch = /^(\d{4}-\d{2}-\d{2})T\d{2}:/.exec(v);
    if (isoMatch) return isoMatch[1];
    return v.length > 40 ? `${v.slice(0, 39)}…` : v;
  }
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.map(formatValue).join(", ");
  return "(changed)";
}

/** "focusPoints" → "Focus points". Good enough for API field names. */
function humanizeField(field: string): string {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function ConflictRow({ conflict }: { conflict: VersionConflict }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"mine" | "theirs" | "merge" | null>(null);

  const resolver = getConflictResolver(conflict.op);
  const isDelete = conflict.op.startsWith("delete");

  const finish = (choice: ConflictResolutionChoice) => {
    logConflictResolution(conflict, choice);
    removeConflict(conflict.id);
    void qc.invalidateQueries();
  };

  const keepTheirs = () => {
    setBusy("theirs");
    finish("theirs");
  };

  const keepMine = async () => {
    if (!resolver) {
      // No resolver registered (shouldn't happen for If-Match-guarded
      // ops — mutation-defaults registers them all) — fall back to
      // "theirs" semantics rather than pretending we re-applied.
      finish("theirs");
      return;
    }
    setBusy("mine");
    try {
      await resolver.keepMine(conflict.variables as never, conflict.current);
      finish("mine");
    } catch {
      setBusy(null);
      toast({
        title: "Couldn't re-apply your change",
        description:
          "The server rejected it again — it may have changed another time. The list has been refreshed.",
        variant: "destructive",
      });
      // A brand-new conflict entry was added by the global listener if
      // this was another version race; drop the stale one either way.
      // Logged as "theirs" — the re-apply did NOT land.
      finish("theirs");
    }
  };

  const merge = async () => {
    if (!resolver?.merge) return;
    setBusy("merge");
    try {
      const result = resolver.merge(conflict.variables as never, conflict.current);
      if (result) await result;
      finish("merge");
    } catch {
      setBusy(null);
      toast({
        title: "Couldn't merge",
        description: "The merge was rejected. Pick Keep mine or Keep theirs instead.",
        variant: "destructive",
      });
    }
  };

  return (
    <div
      className="rounded-md border border-border bg-card p-3 space-y-2"
      data-testid={`conflict-row-${conflict.id}`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">{conflict.label}</p>
          <p className="text-xs text-muted-foreground">
            Changed on another device while you were editing.
          </p>
        </div>
      </div>

      {conflict.fields.length > 0 && (
        <div className="space-y-1">
          {conflict.fields.slice(0, 4).map((f) => (
            <div key={f.field} className="text-xs leading-snug">
              <span className="font-medium">{humanizeField(f.field)}:</span>{" "}
              <span className="text-muted-foreground">theirs</span>{" "}
              {formatValue(f.theirs)} <span className="text-muted-foreground">→ mine</span>{" "}
              {formatValue(f.mine)}
            </div>
          ))}
          {conflict.fields.length > 4 && (
            <p className="text-xs text-muted-foreground">
              +{conflict.fields.length - 4} more field
              {conflict.fields.length - 4 === 1 ? "" : "s"}
            </p>
          )}
        </div>
      )}

      {isDelete && (
        <p className="text-xs text-muted-foreground">
          You deleted this, but it was edited on another device after you last
          synced. Keep your delete, or keep their version?
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button
          size="sm"
          variant="default"
          className="h-7 px-2 text-xs"
          disabled={busy !== null}
          onClick={() => void keepMine()}
          data-testid={`button-keep-mine-${conflict.id}`}
        >
          {busy === "mine" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          {isDelete ? "Delete anyway" : "Keep mine"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={busy !== null}
          onClick={keepTheirs}
          data-testid={`button-keep-theirs-${conflict.id}`}
        >
          Keep theirs
        </Button>
        {conflict.canMerge && (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={busy !== null}
            onClick={() => void merge()}
            data-testid={`button-merge-${conflict.id}`}
          >
            {busy === "merge" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Merge
          </Button>
        )}
      </div>
    </div>
  );
}

export function ConflictTray() {
  const conflicts = useConflicts();

  if (conflicts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-1">
        No sync conflicts. You're all caught up.
      </p>
    );
  }

  return (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto" data-testid="conflict-tray">
      <p className="text-xs text-muted-foreground">
        These changes clashed with edits from another device. Pick which
        version to keep — nothing is overwritten until you choose.
      </p>
      {conflicts.map((c) => (
        <ConflictRow key={c.id} conflict={c} />
      ))}
    </div>
  );
}
