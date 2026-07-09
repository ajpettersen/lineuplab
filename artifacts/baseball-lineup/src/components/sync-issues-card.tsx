import { format } from "date-fns";
import { CloudOff, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  clearConflictHistory,
  useConflictHistory,
  type ResolvedConflict,
} from "@/lib/conflict-registry";

/**
 * Settings → "Sync issues": a per-device audit list of resolved
 * version conflicts, so a coach can answer "why did my edit
 * disappear?" after the fact. The live/unresolved conflicts surface
 * in the sync-status chip's tray — this card is history only.
 */

const CHOICE_LABEL: Record<ResolvedConflict["choice"], string> = {
  mine: "Kept mine",
  theirs: "Kept theirs",
  merge: "Merged",
};

function humanizeField(field: string): string {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function safeWhen(ts: number): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return format(d, "MMM d, h:mm a");
  } catch {
    return "";
  }
}

export function SyncIssuesCard() {
  const history = useConflictHistory();

  return (
    <Card data-testid="card-sync-issues">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CloudOff className="h-5 w-5" /> Sync issues
            </CardTitle>
            <CardDescription>
              Edits that clashed with changes from another device, and how
              they were resolved. This log is stored on this device only.
            </CardDescription>
          </div>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground shrink-0"
              onClick={clearConflictHistory}
              data-testid="button-clear-sync-history"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-sync-issues">
            No sync conflicts so far. When two devices edit the same thing,
            the resolution shows up here.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="list-sync-issues">
            {history.map((h, i) => (
              <li
                key={`${h.resolvedAt}-${i}`}
                className="rounded-md border border-border p-3 flex flex-wrap items-center gap-x-3 gap-y-1"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">{h.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.fields.length > 0
                      ? h.fields.map(humanizeField).join(", ")
                      : "No overlapping fields"}
                    {safeWhen(h.resolvedAt) && ` · ${safeWhen(h.resolvedAt)}`}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {CHOICE_LABEL[h.choice] ?? h.choice}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
