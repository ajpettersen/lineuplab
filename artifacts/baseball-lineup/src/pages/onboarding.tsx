import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTeamSettings,
  useUpdateTeamSettings,
  getGetTeamSettingsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Trophy,
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
  Sparkles,
  Users,
  Mail,
  Copy,
  Plus,
  X,
  CalendarDays,
  ListChecks,
  Palette,
  ClipboardList,
} from "lucide-react";
import {
  useTeamContext,
  useUpdateCoachProfile,
  useCreateInvite,
  type TeamInvite,
} from "@/hooks/use-team-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SPORT_IDS,
  getSportProfile,
  DEFAULT_SPORT,
  type SportId,
} from "@workspace/sport-profiles";
import { withSync } from "@/lib/sync-envelope";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const APP_DEFAULT_PRIMARY = "220 85% 22%";
const APP_DEFAULT_SECONDARY = "42 95% 55%";

const PRIMARY_PRESETS = [
  { label: "Skipper navy", value: APP_DEFAULT_PRIMARY },
  { label: "Royal blue", value: "215 90% 38%" },
  { label: "Forest green", value: "150 65% 25%" },
  { label: "Maroon", value: "350 70% 30%" },
  { label: "Burnt orange", value: "20 90% 38%" },
  { label: "Carolina blue", value: "200 80% 45%" },
  { label: "Charcoal", value: "220 15% 22%" },
  { label: "Plum", value: "280 50% 30%" },
];

const SECONDARY_PRESETS = [
  { label: "Gold", value: APP_DEFAULT_SECONDARY },
  { label: "Crimson", value: "350 75% 50%" },
  { label: "Sky", value: "200 85% 55%" },
  { label: "Lime", value: "85 65% 50%" },
  { label: "Coral", value: "12 85% 60%" },
  { label: "Teal", value: "175 70% 40%" },
  { label: "Lavender", value: "265 60% 65%" },
  { label: "Silver", value: "220 10% 70%" },
];

type StepId =
  | "welcome"
  | "profile"
  | "team"
  | "sport"
  | "colors"
  | "roster"
  | "invites"
  | "tour";

const STEPS: { id: StepId; label: string; optional?: boolean }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "profile", label: "About you" },
  { id: "team", label: "Team identity" },
  { id: "sport", label: "Sport", optional: true },
  { id: "colors", label: "Team colors", optional: true },
  { id: "roster", label: "Roster", optional: true },
  { id: "invites", label: "Invite coaches", optional: true },
  { id: "tour", label: "Quick tour" },
];

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: ctx } = useTeamContext();
  const { data: settings } = useGetTeamSettings();
  const updateProfile = useUpdateCoachProfile();
  const updateSettings = useUpdateTeamSettings();
  const createInvite = useCreateInvite();

  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx]!;
  const isLast = stepIdx === STEPS.length - 1;
  const [skipping, setSkipping] = useState(false);

  // Quiet escape hatch: stamps onboardingCompletedAt so the gate
  // doesn't bounce them back here on the next page load. Available
  // from every step except the final one (which has its own Finish).
  async function handleSkip() {
    setSkipping(true);
    try {
      const resp = await fetch(`${BASE}/api/team-settings/complete-onboarding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
      await qc.invalidateQueries({ queryKey: getGetTeamSettingsQueryKey() });
      setLocation("/");
    } catch (err) {
      toast({
        title: "Couldn't skip setup",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      setSkipping(false);
    }
  }

  // ── Step state ──────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("Head Coach");
  const [teamName, setTeamName] = useState("");
  const [teamShortName, setTeamShortName] = useState("");
  const [sport, setSport] = useState<SportId>(DEFAULT_SPORT);
  const [primaryColor, setPrimaryColor] = useState(APP_DEFAULT_PRIMARY);
  const [secondaryColor, setSecondaryColor] = useState(APP_DEFAULT_SECONDARY);
  const [rosterText, setRosterText] = useState("");
  const [rosterAdded, setRosterAdded] = useState<number | null>(null);
  const [importingRoster, setImportingRoster] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [createdInvites, setCreatedInvites] = useState<TeamInvite[]>([]);
  const [finishing, setFinishing] = useState(false);

  // Hydrate from existing settings/profile once they load. Lets a coach
  // who bailed mid-wizard pick up where they left off.
  useEffect(() => {
    if (ctx) {
      setDisplayName((cur) => (cur ? cur : ctx.currentUser.displayName ?? ""));
      setRole((cur) => ctx.currentUser.role || cur);
    }
  }, [ctx]);
  useEffect(() => {
    if (!settings) return;
    setTeamName((cur) =>
      cur ? cur : settings.teamName === "My Team" ? "" : settings.teamName,
    );
    setTeamShortName((cur) =>
      cur
        ? cur
        : settings.teamShortName === "Team" ? "" : settings.teamShortName,
    );
    if (settings.primaryColor) setPrimaryColor((c) => settings.primaryColor ?? c);
    if (settings.secondaryColor)
      setSecondaryColor((c) => settings.secondaryColor ?? c);
    if (settings.sport === "basketball" || settings.sport === "baseball") {
      setSport(settings.sport);
    }
  }, [settings]);

  // Auto-fill short name from team name when the coach hasn't typed one.
  useEffect(() => {
    if (!teamName) return;
    if (teamShortName) return;
    const guess = teamName.split(/\s+/).slice(-1)[0]?.slice(0, 12) ?? "";
    if (guess) setTeamShortName(guess);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamName]);

  // ── Per-step validation ────────────────────────────────────────
  const canAdvance = useMemo(() => {
    switch (step.id) {
      case "profile":
        return displayName.trim().length >= 2;
      case "team":
        // Only the full team name is required — the short name is
        // auto-derived (see effect above) and we fall back to it on
        // save, so we don't block a coach who cleared the short field.
        return teamName.trim().length >= 2;
      default:
        return true;
    }
  }, [step.id, displayName, teamName, teamShortName]);

  // ── Step actions (run on Next) ─────────────────────────────────
  async function persistCurrentStep(): Promise<boolean> {
    try {
      switch (step.id) {
        case "profile":
          await updateProfile.mutateAsync({
            displayName: displayName.trim(),
            role: role.trim() || null,
          });
          return true;
        case "team": {
          // Fall back to a derived short name if the coach cleared it —
          // the team gate only requires the full name now.
          const trimmedName = teamName.trim();
          const shortName =
            teamShortName.trim() ||
            trimmedName.split(/\s+/).slice(-1)[0]?.slice(0, 20) ||
            trimmedName.slice(0, 20);
          await updateSettings.mutateAsync(
            withSync(
              {
                data: {
                  teamName: trimmedName,
                  teamShortName: shortName,
                },
              },
              settings?.rowVersion,
            ),
          );
          await qc.invalidateQueries({ queryKey: getGetTeamSettingsQueryKey() });
          return true;
        }
        case "sport":
          await updateSettings.mutateAsync(
            withSync({ data: { sport } }, settings?.rowVersion),
          );
          await qc.invalidateQueries({ queryKey: getGetTeamSettingsQueryKey() });
          return true;
        case "colors":
          await updateSettings.mutateAsync(
            withSync(
              { data: { primaryColor, secondaryColor } },
              settings?.rowVersion,
            ),
          );
          await qc.invalidateQueries({ queryKey: getGetTeamSettingsQueryKey() });
          return true;
        default:
          return true;
      }
    } catch (err) {
      toast({
        title: "Couldn't save that step",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return false;
    }
  }

  async function handleNext() {
    const ok = await persistCurrentStep();
    if (!ok) return;
    if (isLast) return; // The last step has its own Finish button.
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  }

  async function handleImportRoster() {
    const lines = rosterText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast({
        title: "Add at least one player",
        description: "Type one player per line, then Import.",
        variant: "destructive",
      });
      return;
    }
    setImportingRoster(true);
    try {
      // Send the raw line as `name` and let the backend's bulk
      // transform split into firstName/lastName — keeps the parsing in
      // one place (api-server/src/routes/players.ts BulkPlayerSchema).
      const players = lines.map((name) => ({ name }));
      const resp = await fetch(`${BASE}/api/players/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${resp.status})`);
      }
      const json = (await resp.json()) as { created?: unknown[] };
      const count = Array.isArray(json.created) ? json.created.length : lines.length;
      setRosterAdded(count);
      toast({ title: `Added ${count} player${count === 1 ? "" : "s"} to your roster` });
    } catch (err) {
      toast({
        title: "Couldn't import roster",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setImportingRoster(false);
    }
  }

  async function handleAddInvite() {
    const email = pendingEmail.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({
        title: "Enter a valid email",
        variant: "destructive",
      });
      return;
    }
    try {
      const invite = await createInvite.mutateAsync({ email });
      setCreatedInvites((cur) => [...cur, invite]);
      setPendingEmail("");
    } catch (err) {
      toast({
        title: "Couldn't create invite",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  function inviteUrl(token: string): string {
    return `${window.location.origin}${BASE}/join/${token}`;
  }

  async function copyInvite(token: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      toast({ title: "Invite link copied" });
    } catch {
      toast({ title: "Copy failed — select the text manually", variant: "destructive" });
    }
  }

  async function handleFinish() {
    setFinishing(true);
    try {
      const resp = await fetch(`${BASE}/api/team-settings/complete-onboarding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
      await qc.invalidateQueries({ queryKey: getGetTeamSettingsQueryKey() });
      setLocation("/");
    } catch (err) {
      toast({
        title: "Couldn't finish setup",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      setFinishing(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto flex min-h-[100dvh] max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-12">
        {/* Stepper */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span data-testid="text-step-label">
              Step {stepIdx + 1} of {STEPS.length} · {step.label}
              {step.optional && (
                <span className="ml-1.5 text-muted-foreground/70 normal-case">
                  (optional)
                </span>
              )}
            </span>
            <div className="flex items-center gap-3">
              <span>{Math.round(((stepIdx + 1) / STEPS.length) * 100)}%</span>
              {!isLast && (
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={skipping || finishing}
                  className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                  data-testid="button-onboarding-skip"
                >
                  {skipping ? "Skipping…" : "Skip setup"}
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${((stepIdx + 1) / STEPS.length) * 100}%`,
              }}
              data-testid="progress-onboarding"
            />
          </div>
        </div>

        {/* Step body */}
        <div className="flex-1 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
          {step.id === "welcome" && (
            <WelcomeStep displayName={ctx?.currentUser.displayName ?? null} />
          )}
          {step.id === "profile" && (
            <ProfileStep
              displayName={displayName}
              role={role}
              setDisplayName={setDisplayName}
              setRole={setRole}
            />
          )}
          {step.id === "team" && (
            <TeamStep
              teamName={teamName}
              teamShortName={teamShortName}
              setTeamName={setTeamName}
              setTeamShortName={setTeamShortName}
            />
          )}
          {step.id === "sport" && (
            <SportStep sport={sport} setSport={setSport} />
          )}
          {step.id === "colors" && (
            <ColorsStep
              primary={primaryColor}
              secondary={secondaryColor}
              setPrimary={setPrimaryColor}
              setSecondary={setSecondaryColor}
            />
          )}
          {step.id === "roster" && (
            <RosterStep
              text={rosterText}
              setText={setRosterText}
              added={rosterAdded}
              importing={importingRoster}
              onImport={handleImportRoster}
              onSkip={() =>
                setStepIdx((i) => Math.min(i + 1, STEPS.length - 1))
              }
            />
          )}
          {step.id === "invites" && (
            <InvitesStep
              pendingEmail={pendingEmail}
              setPendingEmail={setPendingEmail}
              invites={createdInvites}
              onAdd={handleAddInvite}
              creating={createInvite.isPending}
              onCopy={copyInvite}
              urlOf={inviteUrl}
            />
          )}
          {step.id === "tour" && <TourStep />}
        </div>

        {/* Nav */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => setStepIdx((i) => Math.max(i - 1, 0))}
            disabled={stepIdx === 0 || finishing}
            data-testid="button-onboarding-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          {!isLast ? (
            <Button
              onClick={handleNext}
              disabled={
                !canAdvance ||
                updateProfile.isPending ||
                updateSettings.isPending
              }
              data-testid="button-onboarding-next"
            >
              {(updateProfile.isPending || updateSettings.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleFinish}
              disabled={finishing}
              data-testid="button-onboarding-finish"
            >
              {finishing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Take me to the dashboard
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step components ───────────────────────────────────────────────

function StepHeader({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="mb-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="mt-4 font-display text-2xl font-bold sm:text-3xl">
        {title}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function WelcomeStep({ displayName }: { displayName: string | null }) {
  return (
    <div>
      <StepHeader
        icon={Trophy}
        title={`Welcome${displayName ? `, ${displayName.split(/\s+/)[0]}` : ""}!`}
        body="We'll get your team set up in about five minutes — name, colors, roster, and invites for your assistant coaches. You can change anything later in Settings."
      />
      <ul className="mx-auto mt-6 max-w-sm space-y-2 text-sm text-muted-foreground">
        {[
          "Tell us who you are",
          "Name your team",
          "Pick your colors",
          "Add your roster (or skip)",
          "Invite assistant coaches",
          "Quick tour of the app",
        ].map((line) => (
          <li key={line} className="flex items-center gap-2">
            <Check className="h-4 w-4 text-primary" />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProfileStep({
  displayName,
  role,
  setDisplayName,
  setRole,
}: {
  displayName: string;
  role: string;
  setDisplayName: (s: string) => void;
  setRole: (s: string) => void;
}) {
  return (
    <div>
      <StepHeader
        icon={Users}
        title="Tell us who you are"
        body="This is how your name shows up next to lineup notes and on the Coaches list."
      />
      <div className="mx-auto grid max-w-md gap-4">
        <div className="grid gap-2">
          <Label htmlFor="onb-name">Your name</Label>
          <Input
            id="onb-name"
            autoFocus
            placeholder="e.g. Coach Sam"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            data-testid="input-onboarding-name"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="onb-role">Your role</Label>
          <Input
            id="onb-role"
            placeholder="Head Coach, Pitching Coach, etc."
            value={role}
            onChange={(e) => setRole(e.target.value)}
            maxLength={40}
            data-testid="input-onboarding-role"
          />
        </div>
      </div>
    </div>
  );
}

function TeamStep({
  teamName,
  teamShortName,
  setTeamName,
  setTeamShortName,
}: {
  teamName: string;
  teamShortName: string;
  setTeamName: (s: string) => void;
  setTeamShortName: (s: string) => void;
}) {
  return (
    <div>
      <StepHeader
        icon={CalendarDays}
        title="Name your team"
        body="The full name appears in the header and on schedule cards. The short name is used in compact spots like matchup badges."
      />
      <div className="mx-auto grid max-w-md gap-4">
        <div className="grid gap-2">
          <Label htmlFor="onb-team-name">Team name</Label>
          <Input
            id="onb-team-name"
            autoFocus
            placeholder="e.g. Plymouth Pirates 12U"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            maxLength={80}
            data-testid="input-onboarding-team-name"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="onb-team-short">Short name</Label>
          <Input
            id="onb-team-short"
            placeholder="e.g. Pirates"
            value={teamShortName}
            onChange={(e) => setTeamShortName(e.target.value)}
            maxLength={20}
            data-testid="input-onboarding-team-short"
          />
          <p className="text-xs text-muted-foreground">
            Up to 20 characters. We'll auto-fill from the full name as you type.
          </p>
        </div>
      </div>
    </div>
  );
}

function SportStep({
  sport,
  setSport,
}: {
  sport: SportId;
  setSport: (s: SportId) => void;
}) {
  const profile = getSportProfile(sport);
  return (
    <div>
      <StepHeader
        icon={ListChecks}
        title="What sport does this team play?"
        body="This tailors positions, period labels, and which features show up. You can change it later in Settings."
      />
      <div className="mx-auto grid max-w-md gap-4">
        <div className="grid gap-2">
          <Label htmlFor="onb-sport">Sport</Label>
          <Select value={sport} onValueChange={(v) => setSport(v as SportId)}>
            <SelectTrigger id="onb-sport" data-testid="select-onboarding-sport">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPORT_IDS.map((id) => (
                <SelectItem key={id} value={id} data-testid={`option-onboarding-sport-${id}`}>
                  {getSportProfile(id).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {profile.positions.map((p) => p.code).join(" · ")} · {profile.defaultPeriods}{" "}
            {profile.periodLabelPlural.toLowerCase()}
          </p>
        </div>
      </div>
    </div>
  );
}

function ColorsStep({
  primary,
  secondary,
  setPrimary,
  setSecondary,
}: {
  primary: string;
  secondary: string;
  setPrimary: (s: string) => void;
  setSecondary: (s: string) => void;
}) {
  return (
    <div>
      <StepHeader
        icon={Palette}
        title="Pick your team colors"
        body="These tint buttons, badges, and the active nav item. You can fine-tune them later."
      />
      <div className="mx-auto max-w-md space-y-6">
        <Swatches
          label="Primary"
          presets={PRIMARY_PRESETS}
          selected={primary}
          onPick={setPrimary}
          testIdPrefix="onb-primary"
        />
        <Swatches
          label="Accent"
          presets={SECONDARY_PRESETS}
          selected={secondary}
          onPick={setSecondary}
          testIdPrefix="onb-secondary"
        />
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Live preview
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className="inline-flex h-9 items-center rounded-md px-4 font-display text-sm font-semibold text-white"
              style={{ background: `hsl(${primary})` }}
            >
              Save lineup
            </span>
            <span
              className="inline-flex h-9 items-center rounded-md px-4 font-display text-sm font-semibold"
              style={{
                background: `hsl(${secondary})`,
                color: "hsl(220 30% 12%)",
              }}
            >
              Tournament
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Swatches({
  label,
  presets,
  selected,
  onPick,
  testIdPrefix,
}: {
  label: string;
  presets: { label: string; value: string }[];
  selected: string;
  onPick: (v: string) => void;
  testIdPrefix: string;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">{label}</div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {presets.map((p) => {
          const active = p.value === selected;
          return (
            <button
              key={p.value}
              type="button"
              title={p.label}
              onClick={() => onPick(p.value)}
              className={`relative h-10 w-full rounded-md border-2 transition-all ${
                active
                  ? "scale-105 border-foreground ring-2 ring-foreground/30"
                  : "border-border hover:border-foreground/40"
              }`}
              style={{ backgroundColor: `hsl(${p.value})` }}
              data-testid={`${testIdPrefix}-${p.value.replace(/[^a-z0-9]/gi, "")}`}
            >
              {active && (
                <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RosterStep({
  text,
  setText,
  added,
  importing,
  onImport,
  onSkip,
}: {
  text: string;
  setText: (s: string) => void;
  added: number | null;
  importing: boolean;
  onImport: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <StepHeader
        icon={ListChecks}
        title="Add your roster"
        body="One player per line — a first name is plenty; add a last name if you have it. You can also skip this and bulk-import from a screenshot later on the Players page."
      />
      <div className="mx-auto max-w-md space-y-3">
        <Textarea
          rows={8}
          placeholder={`Sam Johnson\nJordan Lee\nAlex Rivera\n…`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-testid="input-onboarding-roster"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {added != null
              ? `Added ${added} player${added === 1 ? "" : "s"} so far. Add more or continue.`
              : "Optional — add as many as you want."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onImport}
            disabled={importing || !text.trim()}
            data-testid="button-onboarding-import-roster"
          >
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add to roster
          </Button>
        </div>
        {/* Explicit Skip — distinct from the global Continue so coaches
            who don't have a roster typed up don't feel like they have
            to fake one to advance. We'll nudge them from the dashboard
            until they actually add players. */}
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            data-testid="button-onboarding-skip-roster"
          >
            Skip for now — I&apos;ll add players later
          </button>
        </div>
      </div>
    </div>
  );
}

function InvitesStep({
  pendingEmail,
  setPendingEmail,
  invites,
  onAdd,
  creating,
  onCopy,
  urlOf,
}: {
  pendingEmail: string;
  setPendingEmail: (s: string) => void;
  invites: TeamInvite[];
  onAdd: () => void;
  creating: boolean;
  onCopy: (token: string) => void;
  urlOf: (token: string) => string;
}) {
  return (
    <div>
      <StepHeader
        icon={Mail}
        title="Invite your assistant coaches"
        body="We generate a unique join link for each email. Copy and share it however you like — text, email, group chat. (We'll send the email automatically in a future update.)"
      />
      <div className="mx-auto max-w-md space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAdd();
          }}
          className="flex items-end gap-2"
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="onb-invite-email">Coach email</Label>
            <Input
              id="onb-invite-email"
              type="email"
              placeholder="assistant@example.com"
              value={pendingEmail}
              onChange={(e) => setPendingEmail(e.target.value)}
              data-testid="input-onboarding-invite-email"
            />
          </div>
          <Button
            type="submit"
            disabled={creating || !pendingEmail.trim()}
            data-testid="button-onboarding-add-invite"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </form>

        {invites.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            No invites yet. You can also skip this and invite folks later
            from Settings.
          </p>
        ) : (
          <ul className="space-y-2">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                data-testid={`row-onboarding-invite-${inv.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {inv.invitedEmail ?? "Unnamed invite"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {urlOf(inv.token)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onCopy(inv.token)}
                  data-testid={`button-copy-invite-${inv.id}`}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TourStep() {
  const cards = [
    {
      icon: Users,
      title: "Roster",
      body: "Add players, set preferred positions, and bulk-import from a screenshot.",
    },
    {
      icon: CalendarDays,
      title: "Schedule",
      body: "Add games one-by-one or paste an iCal URL to import a whole season.",
    },
    {
      icon: Sparkles,
      title: "AI lineups",
      body: "From any game, click Generate to get a fair lineup based on your settings.",
    },
    {
      icon: ClipboardList,
      title: "Field display",
      body: "On game day, open Field Display on an iPad — works offline and syncs back when reconnected.",
    },
  ];
  return (
    <div>
      <StepHeader
        icon={Trophy}
        title="You're all set"
        body="Here's where to find the most-used parts of the app. Click 'Take me to the dashboard' when you're ready."
      />
      <div className="mx-auto grid max-w-2xl gap-3 sm:grid-cols-2">
        {cards.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-xl border border-border bg-background p-4"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <h3 className="font-display text-base font-semibold">{title}</h3>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
