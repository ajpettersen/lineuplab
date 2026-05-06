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
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Trophy, Wand2, Sliders } from "lucide-react";
import { CoachesCard } from "@/components/coaches-card";
import { RestTiersEditor } from "@/components/rest-tiers-editor";
import type { RestTier } from "@/lib/pitch-rulesets";
import { useSeedDemoMutation, DEMO_SEED_ENABLED } from "@/hooks/use-demo-seeder";
import { usePermission } from "@/hooks/use-permission";
import Constraints from "@/pages/constraints";

/**
 * Convert "" / NaN inputs into null so the server stores "no value
 * configured" instead of 0 (which would mean "no pitcher can throw").
 */
function parseOptionalInt(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

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

  // Per-team permission gate. 'full' tier can edit team branding +
  // tournament defaults + constraint editor; everyone else gets a
  // disabled form (server still 403s as the source of truth).
  const { can } = usePermission();
  const canEditTeam = can("full");

  const [teamName, setTeamName] = useState("");
  const [teamShortName, setTeamShortName] = useState("");
  const [battingStyle, setBattingStyle] = useState<"continuous" | "nine_man">(
    "continuous"
  );
  // Free-form tournament defaults. Strings in form state so the coach
  // can clear the field without us coercing to 0.
  const [defaultDailyMax, setDefaultDailyMax] = useState<string>("");
  const [defaultTournamentMax, setDefaultTournamentMax] = useState<string>("");
  const [defaultRestTiers, setDefaultRestTiers] = useState<RestTier[] | null>(null);
  const [innings, setInnings] = useState(6);
  const [maxPos, setMaxPos] = useState(2);
  const [maxBench, setMaxBench] = useState(2);
  const [ensureAll, setEnsureAll] = useState(true);
  const [pitcherRotation, setPitcherRotation] = useState(false);
  const [alwaysLockPC, setAlwaysLockPC] = useState(false);
  const [showFairness, setShowFairness] = useState(true);
  const [showEquityTips, setShowEquityTips] = useState(true);
  const [usesGameChanger, setUsesGameChanger] = useState(false);

  useEffect(() => {
    if (teamQuery.data) {
      setTeamName(teamQuery.data.teamName);
      setTeamShortName(teamQuery.data.teamShortName);
      setBattingStyle(
        teamQuery.data.battingStyle === "nine_man" ? "nine_man" : "continuous"
      );
      setDefaultDailyMax(
        teamQuery.data.defaultDailyPitchMax != null
          ? String(teamQuery.data.defaultDailyPitchMax)
          : ""
      );
      setDefaultTournamentMax(
        teamQuery.data.defaultTournamentPitchMax != null
          ? String(teamQuery.data.defaultTournamentPitchMax)
          : ""
      );
      setDefaultRestTiers(
        (teamQuery.data.defaultRestTiers as RestTier[] | null | undefined) ?? null
      );
      setUsesGameChanger(teamQuery.data.usesGameChanger ?? false);
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
      setShowFairness(prefsQuery.data.showFairnessScore);
      setShowEquityTips(prefsQuery.data.showEquitySuggestions);
    }
  }, [prefsQuery.data]);

  // Auto-scroll to the constraints section when arriving from the
  // /constraints redirect (which appends the hash). Wouter doesn't do
  // hash-scroll out of the box.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#constraints-section") return;
    const el = document.getElementById("constraints-section");
    if (el) {
      // Defer one frame so the section has rendered.
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth" }));
    }
  }, []);

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
        defaultDailyPitchMax: parseOptionalInt(defaultDailyMax),
        defaultTournamentPitchMax: parseOptionalInt(defaultTournamentMax),
        defaultRestTiers,
        usesGameChanger,
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
        showFairnessScore: showFairness,
        showEquitySuggestions: showEquityTips,
      },
    });
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <div className="eyebrow text-primary/70">Configuration</div>
        <h1 className="page-title text-foreground mt-1">Settings</h1>
        <p className="text-sm text-muted-foreground mt-2">
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
              disabled={teamLoading || !canEditTeam}
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
              disabled={teamLoading || !canEditTeam}
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
              disabled={teamLoading || !canEditTeam}
              data-testid="switch-batting-style"
            />
          </div>

          <div className="rounded-lg border p-3 space-y-4">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-purple-600" />
              <Label className="text-sm font-medium">Tournament defaults</Label>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Used to seed every new tournament — the coach can override per tournament. Leave blank for "no team default".
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="defaultDailyMax" className="text-xs">Pitches per day (max)</Label>
                <Input
                  id="defaultDailyMax"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={500}
                  value={defaultDailyMax}
                  onChange={(e) => setDefaultDailyMax(e.target.value)}
                  placeholder="e.g. 85"
                  disabled={teamLoading || !canEditTeam}
                  data-testid="input-default-daily-max"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="defaultTournamentMax" className="text-xs">Pitches per tournament (max)</Label>
                <Input
                  id="defaultTournamentMax"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={2000}
                  value={defaultTournamentMax}
                  onChange={(e) => setDefaultTournamentMax(e.target.value)}
                  placeholder="e.g. 200"
                  disabled={teamLoading || !canEditTeam}
                  data-testid="input-default-tournament-max"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Rest tiers</Label>
              <p className="text-xs text-muted-foreground -mt-1">
                After throwing X pitches in a single day, a pitcher must rest Y calendar days before pitching again.
              </p>
              <RestTiersEditor
                value={defaultRestTiers}
                onChange={setDefaultRestTiers}
                disabled={teamLoading || !canEditTeam}
                testIdPrefix="default-rest-tier"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={onSaveTeam}
              disabled={updateTeam.isPending || teamLoading || !canEditTeam}
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

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5 pr-3">
              <Label htmlFor="showFairness" className="text-sm font-medium">
                Show Fairness Score
              </Label>
              <p className="text-xs text-muted-foreground">
                Display the Fairness Score card on the Dashboard and the
                fairness bar on the Rotation Report. Turn off if you'd rather
                not see the metric.
              </p>
            </div>
            <Switch
              id="showFairness"
              checked={showFairness}
              onCheckedChange={setShowFairness}
              disabled={prefsLoading}
              data-testid="switch-show-fairness"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5 pr-3">
              <Label htmlFor="usesGameChanger" className="text-sm font-medium">
                We use GameChanger
              </Label>
              <p className="text-xs text-muted-foreground">
                Show a "Box score not imported" reminder on the dashboard
                for every past game whose GameChanger box score hasn't
                been uploaded yet. Each reminder can be dismissed
                individually.
              </p>
            </div>
            <Switch
              id="usesGameChanger"
              checked={usesGameChanger}
              onCheckedChange={(v) => {
                setUsesGameChanger(v);
                // Persist ONLY this field so we don't clobber unsaved
                // edits the coach has typed into the Team Branding card
                // above (the PATCH route accepts partial updates).
                updateTeam.mutate({ data: { usesGameChanger: v } });
              }}
              disabled={teamLoading || !canEditTeam}
              data-testid="switch-uses-gamechanger"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5 pr-3">
              <Label htmlFor="showEquityTips" className="text-sm font-medium">
                Show equitable lineup suggestions
              </Label>
              <p className="text-xs text-muted-foreground">
                Show the "Make this lineup more equitable" tip box above a
                game's lineup when one or more players are getting noticeably
                less playing time than the rest.
              </p>
            </div>
            <Switch
              id="showEquityTips"
              checked={showEquityTips}
              onCheckedChange={setShowEquityTips}
              disabled={prefsLoading}
              data-testid="switch-show-equity-tips"
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

      {/* Constraints — moved out of the sidebar and into Settings so all
          team-wide rule configuration lives in one place. The /constraints
          URL still works and redirects here. */}
      <div id="constraints-section" className="scroll-mt-20 pt-2 space-y-3">
        <div className="flex items-center gap-2">
          <Sliders className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Constraints</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Lineup rules applied automatically whenever you generate a lineup.
        </p>
        <Constraints embedded />
      </div>
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
