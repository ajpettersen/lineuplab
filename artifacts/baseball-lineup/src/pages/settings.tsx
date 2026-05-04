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
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Trophy, Wand2 } from "lucide-react";
import { CoachesCard } from "@/components/coaches-card";
import { PITCH_RULESET_OPTIONS } from "@/lib/pitch-rulesets";
import { useSeedDemoMutation, DEMO_SEED_ENABLED } from "@/hooks/use-demo-seeder";

const NO_DEFAULT = "__none";

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
  const [battingStyle, setBattingStyle] = useState<"continuous" | "nine_man">(
    "continuous"
  );
  const [defaultAgeGroup, setDefaultAgeGroup] = useState("");
  const [defaultPitchRuleset, setDefaultPitchRuleset] = useState<string>(NO_DEFAULT);
  const [innings, setInnings] = useState(6);
  const [maxPos, setMaxPos] = useState(2);
  const [maxBench, setMaxBench] = useState(2);
  const [ensureAll, setEnsureAll] = useState(true);
  const [pitcherRotation, setPitcherRotation] = useState(false);
  // When on, the per-game Generate Lineup flow blocks (with override) until
  // the coach has set Pitcher and Catcher locks for every inning. Mirrors the
  // `alwaysLockPitcherCatcher` column on `user_preferences`.
  const [alwaysLockPC, setAlwaysLockPC] = useState(false);

  useEffect(() => {
    if (teamQuery.data) {
      setTeamName(teamQuery.data.teamName);
      setTeamShortName(teamQuery.data.teamShortName);
      setBattingStyle(
        teamQuery.data.battingStyle === "nine_man" ? "nine_man" : "continuous"
      );
      setDefaultAgeGroup(teamQuery.data.defaultAgeGroup ?? "");
      setDefaultPitchRuleset(teamQuery.data.defaultPitchRuleset ?? NO_DEFAULT);
    }
  }, [teamQuery.data]);

  useEffect(() => {
    if (prefsQuery.data) {
      setInnings(prefsQuery.data.defaultInnings);
      setMaxPos(prefsQuery.data.defaultMaxInningsPerPosition);
      setMaxBench(prefsQuery.data.defaultMaxInningsBench);
      setEnsureAll(prefsQuery.data.defaultEnsureAllPositions);
      setPitcherRotation(prefsQuery.data.defaultPitcherRotation);
      setAlwaysLockPC(prefsQuery.data.alwaysLockPitcherCatcher);
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
      data: {
        teamName: name,
        teamShortName: short,
        battingStyle,
        defaultAgeGroup: defaultAgeGroup.trim() || null,
        defaultPitchRuleset:
          defaultPitchRuleset === NO_DEFAULT ? null : defaultPitchRuleset,
      },
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
        alwaysLockPitcherCatcher: alwaysLockPC,
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

      <CoachesCard />

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
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="battingStyle" className="text-sm font-medium">
                Continuous batting order
              </Label>
              <p className="text-xs text-muted-foreground">
                On: every player on the roster bats (recommended for youth
                leagues). Off: only the top 9 batters get a slot — extras are
                fielding subs.
              </p>
            </div>
            <Switch
              id="battingStyle"
              checked={battingStyle === "continuous"}
              onCheckedChange={(v) =>
                setBattingStyle(v ? "continuous" : "nine_man")
              }
              disabled={teamLoading}
              data-testid="switch-batting-style"
            />
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-purple-600" />
              <Label className="text-sm font-medium">Tournament defaults</Label>
            </div>
            <p className="text-xs text-muted-foreground -mt-1">
              Used when you create a new tournament — you can still override per tournament.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="defaultAgeGroup" className="text-xs">Age group</Label>
                <Input
                  id="defaultAgeGroup"
                  value={defaultAgeGroup}
                  onChange={(e) => setDefaultAgeGroup(e.target.value)}
                  placeholder="e.g. 11-12U"
                  maxLength={20}
                  disabled={teamLoading}
                  data-testid="input-default-age-group"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="defaultPitchRuleset" className="text-xs">Pitch ruleset</Label>
                <Select
                  value={defaultPitchRuleset}
                  onValueChange={setDefaultPitchRuleset}
                  disabled={teamLoading}
                >
                  <SelectTrigger id="defaultPitchRuleset" data-testid="select-default-pitch-ruleset">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DEFAULT}>None (pick per tournament)</SelectItem>
                    {PITCH_RULESET_OPTIONS.map((r) => (
                      <SelectItem key={r.key} value={r.key}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
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
              <NumberInput
                id="innings"
                min={1}
                max={15}
                value={innings}
                onChange={setInnings}
                fallback={1}
                disabled={prefsLoading}
                data-testid="input-default-innings"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxPos">Max innings / position</Label>
              <NumberInput
                id="maxPos"
                min={1}
                max={15}
                value={maxPos}
                onChange={setMaxPos}
                fallback={1}
                disabled={prefsLoading}
                data-testid="input-max-position"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxBench">Max innings on bench</Label>
              <NumberInput
                id="maxBench"
                min={0}
                max={15}
                value={maxBench}
                onChange={setMaxBench}
                fallback={0}
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

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label
                htmlFor="alwaysLockPC"
                className="text-sm font-medium"
              >
                Always lock pitchers and catchers
              </Label>
              <p className="text-xs text-muted-foreground">
                Before generating a lineup, prompt me to set Pitcher and Catcher
                locks for every inning. I can still generate without them.
              </p>
            </div>
            <Switch
              id="alwaysLockPC"
              checked={alwaysLockPC}
              onCheckedChange={setAlwaysLockPC}
              disabled={prefsLoading}
              data-testid="switch-always-lock-pc"
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

      {DEMO_SEED_ENABLED && <DemoDataCard />}
    </div>
  );
}

/**
 * Dev-preview-only card that lets the coach load a demo roster + schedule
 * with a single click so they can click around the app without first
 * setting everything up by hand. Hidden in production builds via
 * DEMO_SEED_ENABLED so a real coach signing into the live app never sees
 * this affordance.
 */
function DemoDataCard() {
  const seed = useSeedDemoMutation();
  return (
    <Card data-testid="card-demo-data">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="h-5 w-5" /> Demo data
        </CardTitle>
        <CardDescription>
          Load a sample roster of 12 players and 3 games so you can explore
          the app. Only available in the preview environment — your live
          deployment is untouched. Already have data? This button is a
          no-op (we won't overwrite anything).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          onClick={() => seed.mutate()}
          disabled={seed.isPending}
          className="gap-2"
          data-testid="button-load-demo"
        >
          {seed.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
          {seed.isPending ? "Loading…" : "Load demo data"}
        </Button>
      </CardContent>
    </Card>
  );
}
