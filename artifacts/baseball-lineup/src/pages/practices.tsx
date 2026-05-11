import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPractices,
  useCreatePractice,
  getListPracticesQueryKey,
} from "@workspace/api-client-react";
import {
  PRACTICE_FOCUS_AREAS,
  FOCUS_AREA_BY_KEY,
  DEFAULT_PRACTICE_DURATION,
} from "@/lib/practice-focus-areas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CardGridSkeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Clipboard,
  CalendarDays,
  Clock,
  Users,
  Loader2,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

function todayDateInputValue() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nextPracticeStartTime() {
  return "17:30";
}

function combineDateTimeISO(date: string, time: string): string {
  // Build a Date in local TZ then send ISO so the server stores wall-clock
  // intent the same way games do.
  const dt = new Date(`${date}T${time}:00`);
  return dt.toISOString();
}

export default function Practices() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: practices = [], isLoading } = useListPractices();

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayDateInputValue());
  const [time, setTime] = useState(nextPracticeStartTime());
  const [duration, setDuration] = useState(DEFAULT_PRACTICE_DURATION);
  const [title, setTitle] = useState("");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [openAfterCreate, setOpenAfterCreate] = useState(true);

  const create = useCreatePractice({
    mutation: {
      onSuccess: (created) => {
        void qc.invalidateQueries({ queryKey: getListPracticesQueryKey() });
        toast({ title: "Practice created" });
        setOpen(false);
        setTitle("");
        setNotes("");
        setFocusAreas([]);
        if (openAfterCreate) {
          setLocation(`/practices/${created.id}`);
        }
      },
      onError: (err) =>
        toast({
          title: "Could not create practice",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    },
  });

  const toggleFocus = (key: string) => {
    setFocusAreas((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const submit = () => {
    create.mutate({
      data: {
        date: combineDateTimeISO(date, time),
        durationMinutes: duration,
        title: title.trim() || null,
        focusAreas,
        notes: notes.trim() || null,
      },
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow text-primary/70">Workouts</div>
          <h1 className="page-title text-foreground mt-1 flex items-center gap-3">
            <Clipboard className="h-7 w-7 text-emerald-600" />
            Practices
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Plan a practice, let the AI draft time-blocked drills, take attendance, and keep your team rotation honest.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-practice">
              <Plus className="h-4 w-4 mr-1.5" />
              New Practice
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>New practice</DialogTitle>
              <DialogDescription>
                Pick the date, length, and focus areas. You can let the AI draft the plan on the next screen.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="p-date">Date</Label>
                  <Input
                    id="p-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    data-testid="input-practice-date"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-time">Start time</Label>
                  <Input
                    id="p-time"
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    data-testid="input-practice-time"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="p-duration">Length (min)</Label>
                  <NumberInput
                    id="p-duration"
                    min={15}
                    max={360}
                    step={5}
                    value={duration}
                    onChange={setDuration}
                    fallback={DEFAULT_PRACTICE_DURATION}
                    data-testid="input-practice-duration"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-title">Title (optional)</Label>
                  <Input
                    id="p-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Pre-tournament prep"
                    maxLength={120}
                    data-testid="input-practice-title"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Focus areas</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PRACTICE_FOCUS_AREAS.map((f) => {
                    const active = focusAreas.includes(f.key);
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => toggleFocus(f.key)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          active
                            ? f.tint
                            : "bg-white text-muted-foreground border-border hover:bg-muted"
                        }`}
                        data-testid={`chip-focus-${f.key}`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-notes">Notes (optional)</Label>
                <Textarea
                  id="p-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. Sarah's first practice as catcher"
                  data-testid="input-practice-notes"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={openAfterCreate}
                  onChange={(e) => setOpenAfterCreate(e.target.checked)}
                  className="h-4 w-4"
                  data-testid="checkbox-open-after-create"
                />
                Open the practice when it's created
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={create.isPending}
                data-testid="button-create-practice"
              >
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        // Skeleton card grid that mirrors the real practice-card
        // layout (sm:grid-cols-2). Reserves the same vertical space
        // as the loaded list so the page doesn't jump when data
        // arrives, and replaces the previous centered spinner that
        // collapsed to ~48 px and made the page look broken.
        <CardGridSkeleton count={4} columns={2} cardHeight="h-32" />
      ) : practices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Clipboard className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              No practices yet. Create one and the AI will draft a time-blocked plan from your focus areas.
            </p>
            <Button onClick={() => setOpen(true)} variant="outline" size="sm">
              <Sparkles className="h-4 w-4 mr-1.5" />
              Plan your first practice
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {practices.map((p) => {
            const dt = new Date(p.date);
            const blockCount = (p.blocks ?? []).length;
            return (
              <Link key={p.id} href={`/practices/${p.id}`}>
                <Card
                  className="cursor-pointer transition-colors hover:border-primary/40"
                  data-testid={`card-practice-${p.id}`}
                >
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clipboard className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span className="truncate">
                        {p.title || `${format(dt, "EEEE")} practice`}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                      <span>{format(dt, "EEE, MMM d • h:mm a")}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {p.durationMinutes} min
                      </span>
                      <span className="flex items-center gap-1">
                        {blockCount === 0 ? (
                          <span className="text-amber-600">No plan yet</span>
                        ) : (
                          <>
                            <Sparkles className="h-3 w-3" />
                            {blockCount} block{blockCount === 1 ? "" : "s"}
                          </>
                        )}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {p.attendancePresent}/{p.attendanceMarked || "—"} present
                      </span>
                    </div>
                    {(p.focusAreas ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {(p.focusAreas ?? []).slice(0, 5).map((key) => {
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
                        {(p.focusAreas ?? []).length > 5 && (
                          <span className="text-[10px] px-1.5 py-0.5 text-muted-foreground">
                            +{(p.focusAreas ?? []).length - 5}
                          </span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
