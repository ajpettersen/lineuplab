import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTournaments,
  useCreateTournament,
  useGetTeamSettings,
  getListTournamentsQueryKey,
} from "@workspace/api-client-react";
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
import { Plus, Trophy, MapPin, CalendarDays, Users, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { RestTiersEditor } from "@/components/rest-tiers-editor";
import type { RestTier } from "@/lib/pitch-rulesets";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseOptionalInt(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function Tournaments() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: tournaments = [], isLoading } = useListTournaments();
  // Pull team defaults so the dialog can show "Team default: 85" hints
  // — coach inherits whenever they leave the per-tournament field blank.
  const { data: teamSettings } = useGetTeamSettings();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [dailyMax, setDailyMax] = useState<string>("");
  const [tournamentMax, setTournamentMax] = useState<string>("");
  const [restTiers, setRestTiers] = useState<RestTier[] | null>(null);

  const reset = () => {
    setName("");
    setLocation("");
    setNotes("");
    setDailyMax("");
    setTournamentMax("");
    setRestTiers(null);
  };

  const create = useCreateTournament({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        toast({ title: "Tournament created" });
        setOpen(false);
        reset();
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
        dailyPitchMax: parseOptionalInt(dailyMax),
        tournamentPitchMax: parseOptionalInt(tournamentMax),
        restTiers,
      },
    });
  };

  const teamDailyDefault = teamSettings?.defaultDailyPitchMax ?? null;
  const teamTournamentDefault = teamSettings?.defaultTournamentPitchMax ?? null;

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
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-tournament">
              <Plus className="h-4 w-4 mr-1.5" />
              New Tournament
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New tournament</DialogTitle>
              <DialogDescription>
                Pitch limits and rest tiers fall back to your team defaults if you leave them blank.
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="t-daily-max" className="text-xs">Pitches / day</Label>
                  <Input
                    id="t-daily-max"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={500}
                    value={dailyMax}
                    onChange={(e) => setDailyMax(e.target.value)}
                    placeholder={
                      teamDailyDefault != null
                        ? `Team default: ${teamDailyDefault}`
                        : "Optional"
                    }
                    data-testid="input-tournament-daily-max"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-tournament-max" className="text-xs">Pitches / tournament</Label>
                  <Input
                    id="t-tournament-max"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={2000}
                    value={tournamentMax}
                    onChange={(e) => setTournamentMax(e.target.value)}
                    placeholder={
                      teamTournamentDefault != null
                        ? `Team default: ${teamTournamentDefault}`
                        : "Optional"
                    }
                    data-testid="input-tournament-total-max"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Rest tiers</Label>
                <p className="text-xs text-muted-foreground -mt-1">
                  Leave empty to inherit your team default.
                </p>
                <RestTiersEditor
                  value={restTiers}
                  onChange={setRestTiers}
                  testIdPrefix="new-tournament-rest-tier"
                  placeholder="Inheriting team default — add rows here to override."
                />
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
