import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTeamSettingsQueryKey, getListGamesQueryKey } from "@workspace/api-client-react";
import { format, formatDistanceToNow } from "date-fns";
import { AlertTriangle, CalendarSync, Loader2, MoreVertical, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { useTeamContext } from "@/hooks/use-team-context";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type SyncResult = { found: number; added: number; updated: number; linked: number; error: string | null };
type PreviewGame = { uid: string; opponent: string; gameDate: string; location: string | null };

async function postJson<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const b = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(b?.error ?? `Request failed (${r.status})`);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

function describeSync(r: SyncResult): string {
  const parts: string[] = [];
  if (r.added) parts.push(`${r.added} new game${r.added === 1 ? "" : "s"} added`);
  if (r.linked) parts.push(`${r.linked} existing game${r.linked === 1 ? "" : "s"} matched`);
  if (r.updated) parts.push(`${r.updated} updated`);
  return parts.length ? parts.join(", ") : "Schedule already up to date";
}

/**
 * Calendar connection state + actions for the active team. Status comes
 * from team settings (icalUrl / icalLastSync*), which the server keeps
 * current on connect, "Sync now", and the hourly background sync.
 */
export function useCalendarSync() {
  const { calendar } = useTeamSettings();
  const { data: ctx } = useTeamContext();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);

  const permission = ctx?.currentUser.permission ?? "view";
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetTeamSettingsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await postJson<SyncResult>("/api/calendar/sync");
      if (r.error) toast({ title: "Couldn't sync calendar", description: r.error, variant: "destructive" });
      else toast({ title: "Schedule synced", description: describeSync(r) });
    } catch (err) {
      toast({ title: "Couldn't sync calendar", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSyncing(false);
      refresh();
    }
  };

  const disconnect = async () => {
    try {
      await postJson("/api/calendar", undefined, "DELETE");
      toast({ title: "Calendar disconnected", description: "Games already on your schedule were kept." });
    } catch (err) {
      toast({ title: "Couldn't disconnect", description: (err as Error).message, variant: "destructive" });
    } finally {
      refresh();
    }
  };

  return {
    ...calendar,
    connected: !!calendar.url,
    canManage: permission === "full",
    canSync: permission === "full" || permission === "partial",
    syncing,
    syncNow,
    disconnect,
    refresh,
  };
}

const SOURCES: Array<{ name: string; steps: string }> = [
  {
    name: "MBL / Fall League (mbl.bz)",
    steps:
      "Open your team's page on mbl.bz (Schedules → pick your team) and paste that page's address.",
  },
  {
    name: "GameChanger",
    steps:
      "In the GameChanger app, open your team's Schedule and look for the option to sync or subscribe to the schedule in your calendar. Copy the link it gives you.",
  },
  {
    name: "TeamSnap / SportsEngine / league sites",
    steps:
      "On your team's schedule, look for \"Subscribe,\" \"Sync to calendar,\" or \"Export (iCal)\" and copy that link.",
  },
  {
    name: "Google Calendar",
    steps:
      "Calendar settings → your team calendar → \"Secret address in iCal format\" → copy.",
  },
];

export function ConnectCalendarDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refresh } = useCalendarSync();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<PreviewGame[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setUrl("");
    setPreview(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    setPreview(null);
    try {
      const r = await postJson<{ games: PreviewGame[] }>("/api/calendar/preview", { icalUrl: url.trim() });
      setPreview(r.games);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const r = await postJson<SyncResult>("/api/calendar/connect", { icalUrl: url.trim() });
      toast({ title: "Calendar connected", description: `${describeSync(r)}. We'll keep it in sync automatically.` });
      refresh();
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const upcoming = preview?.filter((g) => new Date(g.gameDate) >= new Date(Date.now() - 12 * 3600 * 1000)) ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect your team calendar</DialogTitle>
          <DialogDescription>
            Paste your team's schedule page or calendar link. Games are added automatically and
            kept up to date when times or opponents change — no more entering them by hand.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ical-url">Team page or calendar link</Label>
            <div className="flex gap-2">
              <Input
                id="ical-url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setPreview(null);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && url.trim()) {
                    e.preventDefault();
                    void check();
                  }
                }}
                placeholder="e.g. mbl.bz/teams/12345  or  webcal://…"
                autoFocus
              />
              <Button variant="outline" onClick={check} disabled={!url.trim() || checking}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
              </Button>
            </div>
          </div>

          {error && (
            <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {preview && (
            <div className="rounded-md border">
              <div className="px-3 py-2 text-sm font-medium border-b bg-muted/40">
                {preview.length === 0
                  ? "No games found in this calendar"
                  : `Found ${preview.length} game${preview.length === 1 ? "" : "s"}${
                      upcoming.length !== preview.length ? ` (${upcoming.length} upcoming)` : ""
                    }`}
              </div>
              {upcoming.length > 0 && (
                <ul className="divide-y max-h-56 overflow-y-auto">
                  {upcoming.slice(0, 20).map((g) => (
                    <li key={g.uid} className="px-3 py-2 text-sm flex items-baseline justify-between gap-3">
                      <span className="font-medium truncate">vs {g.opponent || "TBD"}</span>
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {format(new Date(g.gameDate), "EEE MMM d · h:mm a")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="px-3 py-2 text-xs text-muted-foreground border-t">
                Practices and team events in the calendar are skipped. Games you've already added by hand
                are matched up instead of duplicated.
              </p>
            </div>
          )}

          {!preview && (
            <details className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">Where do I find my calendar link?</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {SOURCES.map((s) => (
                  <li key={s.name}>
                    <span className="font-medium">{s.name}:</span>{" "}
                    <span className="text-muted-foreground">{s.steps}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Calendar links usually start with <span className="font-mono">webcal://</span> or end in{" "}
                <span className="font-mono">.ics</span>. A team schedule page works too if it has an
                iCal or Subscribe link on it — we'll find it.
              </p>
            </details>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={connect} disabled={!preview || preview.length === 0 || connecting}>
            {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CalendarSync className="h-4 w-4 mr-2" />}
            Connect &amp; keep in sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Schedule-page status strip. Connected: shows sync health + "Sync now".
 * Not connected: a one-line pitch to connect (head coaches only).
 */
export function CalendarSyncBar({ onConnect }: { onConnect: () => void }) {
  const cal = useCalendarSync();

  if (!cal.connected) {
    if (!cal.canManage) return null;
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <CalendarSync className="h-6 w-6 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium">Stop entering games by hand</div>
            <div className="text-sm text-muted-foreground">
              Connect your GameChanger, TeamSnap, or league calendar and your schedule fills itself in.
            </div>
          </div>
          <Button onClick={onConnect} className="shrink-0">
            Connect calendar
          </Button>
        </CardContent>
      </Card>
    );
  }

  const failed = !!cal.lastSyncError;
  return (
    <div
      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
        failed ? "border-amber-300 bg-amber-50 text-amber-900" : "bg-muted/40"
      }`}
    >
      {failed ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : (
        <CalendarSync className="h-4 w-4 shrink-0 text-primary" />
      )}
      <div className="flex-1 min-w-0">
        {failed ? (
          <span>
            Calendar sync failed: <span className="text-amber-800">{cal.lastSyncError}</span>
          </span>
        ) : (
          <span>
            Synced with your team calendar
            {cal.gameCount != null && <> · {cal.gameCount} games</>}
            {cal.lastSyncAt && (
              <span className="text-muted-foreground">
                {" "}
                · updated {formatDistanceToNow(new Date(cal.lastSyncAt), { addSuffix: true })}
              </span>
            )}
          </span>
        )}
      </div>
      {cal.canSync && (
        <Button variant="ghost" size="sm" onClick={cal.syncNow} disabled={cal.syncing} className="shrink-0">
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${cal.syncing ? "animate-spin" : ""}`} />
          {cal.syncing ? "Syncing…" : "Sync now"}
        </Button>
      )}
      {cal.canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Calendar options">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onConnect}>
              <CalendarSync className="h-4 w-4 mr-2" /> Change calendar link
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={cal.disconnect} className="text-destructive focus:text-destructive">
              <Unlink className="h-4 w-4 mr-2" /> Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
