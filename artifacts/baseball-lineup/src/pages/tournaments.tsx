import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTournaments,
  useCreateTournament,
  getListTournamentsQueryKey,
} from "@workspace/api-client-react";
import {
  PITCH_RULESET_OPTIONS,
  DEFAULT_PITCH_RULESET,
} from "@/lib/pitch-rulesets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trophy, MapPin, CalendarDays, Users, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Tournaments() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: tournaments = [], isLoading } = useListTournaments();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [ruleset, setRuleset] = useState<string>(DEFAULT_PITCH_RULESET);

  const create = useCreateTournament({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        toast({ title: "Tournament created" });
        setOpen(false);
        setName("");
        setLocation("");
        setNotes("");
      },
      onError: (err) =>
        toast({
          title: "Could not create tournament",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    },
  });

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Tournament name required", variant: "destructive" });
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      toast({ title: "End date can't be before start date", variant: "destructive" });
      return;
    }
    create.mutate({
      data: {
        name: trimmed,
        startDate,
        endDate,
        location: location.trim() || null,
        notes: notes.trim() || null,
        pitchCountRuleset: ruleset || null,
      },
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-6 w-6 text-purple-600" />
            Tournaments
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Group multi-game weekends so the app rolls per-pitcher pitch counts and rest days across every game.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-tournament">
              <Plus className="h-4 w-4 mr-1.5" />
              New Tournament
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>New tournament</DialogTitle>
              <DialogDescription>
                Pitch budgets and rest days will use the ruleset you pick here.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="t-name">Name</Label>
                <Input
                  id="t-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Memorial Day Classic"
                  maxLength={120}
                  data-testid="input-tournament-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="t-start">Start</Label>
                  <Input
                    id="t-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    data-testid="input-tournament-start"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-end">End</Label>
                  <Input
                    id="t-end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    data-testid="input-tournament-end"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-location">Location (optional)</Label>
                <Input
                  id="t-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Riverside Sports Complex"
                  data-testid="input-tournament-location"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-ruleset">Pitch ruleset</Label>
                <Select value={ruleset} onValueChange={setRuleset}>
                  <SelectTrigger id="t-ruleset" data-testid="select-tournament-ruleset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PITCH_RULESET_OPTIONS.map((r) => (
                      <SelectItem key={r.key} value={r.key}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-notes">Notes (optional)</Label>
                <Textarea
                  id="t-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  data-testid="input-tournament-notes"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={create.isPending} data-testid="button-create-tournament">
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tournaments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Trophy className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No tournaments yet. Create one to start tracking pitch counts across a multi-game weekend.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tournaments.map((t) => (
            <Link key={t.id} href={`/tournaments/${t.id}`}>
              <Card
                className="cursor-pointer transition-colors hover:border-primary/40"
                data-testid={`card-tournament-${t.id}`}
              >
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-purple-600 shrink-0" />
                    <span className="truncate">{t.name}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {format(new Date(t.startDate), "MMM d")}
                      {" – "}
                      {format(new Date(t.endDate), "MMM d, yyyy")}
                    </span>
                  </div>
                  {t.location && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{t.location}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 pt-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {t.gameCount} game{t.gameCount === 1 ? "" : "s"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {t.pitchersUsed} pitcher{t.pitchersUsed === 1 ? "" : "s"}
                    </span>
                    <span>{t.totalPitches} pitches</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
