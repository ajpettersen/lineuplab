import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTeamSettings,
  useUpdateTeamSettings,
  useGetPreferences,
  useUpdatePreferences,
  getGetTeamSettingsQueryKey,
  getGetPreferencesQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save } from "lucide-react";

export default function Settings() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const teamQuery = useGetTeamSettings();
  const prefsQuery = useGetPreferences();

  const updateTeam = useUpdateTeamSettings({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetTeamSettingsQueryKey() });
        toast({ title: "Team branding saved" });
      },
      onError: (err) => {
        toast({
          title: "Could not save team branding",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      },
    },
  });

  const updatePrefs = useUpdatePreferences({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetPreferencesQueryKey() });
        toast({ title: "Defaults saved" });
      },
      onError: (err) => {
        toast({
          title: "Could not save defaults",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      },
    },
  });

  const [teamName, setTeamName] = useState("");
  const [teamShortName, setTeamShortName] = useState("");
  const [innings, setInnings] = useState(6);
  const [maxPos, setMaxPos] = useState(2);
  const [maxBench, setMaxBench] = useState(2);
  const [ensureAll, setEnsureAll] = useState(true);
  const [pitcherRotation, setPitcherRotation] = useState(false);

  useEffect(() => {
    if (teamQuery.data) {
      setTeamName(teamQuery.data.teamName);
      setTeamShortName(teamQuery.data.teamShortName);
    }
  }, [teamQuery.data]);

  useEffect(() => {
    if (prefsQuery.data) {
      setInnings(prefsQuery.data.defaultInnings);
      setMaxPos(prefsQuery.data.defaultMaxInningsPerPosition);
      setMaxBench(prefsQuery.data.defaultMaxInningsBench);
      setEnsureAll(prefsQuery.data.defaultEnsureAllPositions);
      setPitcherRotation(prefsQuery.data.defaultPitcherRotation);
    }
  }, [prefsQuery.data]);

  const teamLoading = teamQuery.isLoading;
  const prefsLoading = prefsQuery.isLoading;

  const onSaveTeam = () => {
    const name = teamName.trim();
    const short = teamShortName.trim();
    if (!name || !short) {
      toast({
        title: "Both fields are required",
        variant: "destructive",
      });
      return;
    }
    updateTeam.mutate({
      data: { teamName: name, teamShortName: short },
    });
  };

  const onSavePrefs = () => {
    updatePrefs.mutate({
      data: {
        defaultInnings: innings,
        defaultMaxInningsPerPosition: maxPos,
        defaultMaxInningsBench: maxBench,
        defaultEnsureAllPositions: ensureAll,
        defaultPitcherRotation: pitcherRotation,
      },
    });
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your team branding and lineup defaults. Changes only affect
          your account.
        </p>
      </div>

      <Card data-testid="card-team-branding">
        <CardHeader>
          <CardTitle>Team Branding</CardTitle>
          <CardDescription>
            Shown in the header and on shared lineups.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="teamName">Team name</Label>
            <Input
              id="teamName"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Eastside Eagles"
              disabled={teamLoading}
              maxLength={80}
              data-testid="input-team-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="teamShortName">Short name</Label>
            <Input
              id="teamShortName"
              value={teamShortName}
              onChange={(e) => setTeamShortName(e.target.value)}
              placeholder="e.g. Eagles"
              disabled={teamLoading}
              maxLength={20}
              data-testid="input-team-short-name"
            />
            <p className="text-xs text-muted-foreground">
              Used where space is tight (e.g. mobile chips, exports).
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={onSaveTeam}
              disabled={updateTeam.isPending || teamLoading}
              className="gap-2"
              data-testid="button-save-team"
            >
              {updateTeam.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save branding
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-defaults">
        <CardHeader>
          <CardTitle>Defaults</CardTitle>
          <CardDescription>
            Used when you create a new game or generate a lineup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="innings">Default innings</Label>
              <Input
                id="innings"
                type="number"
                min={1}
                max={15}
                value={innings}
                onChange={(e) => setInnings(Number(e.target.value) || 0)}
                disabled={prefsLoading}
                data-testid="input-default-innings"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxPos">Max innings / position</Label>
              <Input
                id="maxPos"
                type="number"
                min={1}
                max={15}
                value={maxPos}
                onChange={(e) => setMaxPos(Number(e.target.value) || 0)}
                disabled={prefsLoading}
                data-testid="input-max-position"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxBench">Max innings on bench</Label>
              <Input
                id="maxBench"
                type="number"
                min={0}
                max={15}
                value={maxBench}
                onChange={(e) => setMaxBench(Number(e.target.value) || 0)}
                disabled={prefsLoading}
                data-testid="input-max-bench"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="ensureAll" className="text-sm font-medium">
                Ensure every position is filled
              </Label>
              <p className="text-xs text-muted-foreground">
                Generator prefers lineups that cover all 9 positions each
                inning.
              </p>
            </div>
            <Switch
              id="ensureAll"
              checked={ensureAll}
              onCheckedChange={setEnsureAll}
              disabled={prefsLoading}
              data-testid="switch-ensure-positions"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label
                htmlFor="pitcherRotation"
                className="text-sm font-medium"
              >
                Rotate pitchers each inning
              </Label>
              <p className="text-xs text-muted-foreground">
                Avoid leaving the same player on the mound for multiple innings.
              </p>
            </div>
            <Switch
              id="pitcherRotation"
              checked={pitcherRotation}
              onCheckedChange={setPitcherRotation}
              disabled={prefsLoading}
              data-testid="switch-pitcher-rotation"
            />
          </div>

          <div className="flex justify-end">
            <Button
              onClick={onSavePrefs}
              disabled={updatePrefs.isPending || prefsLoading}
              className="gap-2"
              data-testid="button-save-defaults"
            >
              {updatePrefs.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save defaults
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
