import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTeamSettings,
  useUpdateTeamSettings,
  getGetTeamSettingsQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Palette, RotateCcw, Check } from "lucide-react";
import { usePermission } from "@/hooks/use-permission";

const APP_DEFAULT_PRIMARY = "220 85% 22%";
const APP_DEFAULT_SECONDARY = "42 95% 55%";

type Swatch = { label: string; value: string };

const PRIMARY_PRESETS: Swatch[] = [
  { label: "Skipper navy", value: APP_DEFAULT_PRIMARY },
  { label: "Royal blue", value: "215 90% 38%" },
  { label: "Forest green", value: "150 65% 25%" },
  { label: "Maroon", value: "350 70% 30%" },
  { label: "Burnt orange", value: "20 90% 38%" },
  { label: "Carolina blue", value: "200 80% 45%" },
  { label: "Charcoal", value: "220 15% 22%" },
  { label: "Plum", value: "280 50% 30%" },
];

const SECONDARY_PRESETS: Swatch[] = [
  { label: "Gold", value: APP_DEFAULT_SECONDARY },
  { label: "Crimson", value: "350 75% 50%" },
  { label: "Sky", value: "200 85% 55%" },
  { label: "Lime", value: "85 65% 50%" },
  { label: "Coral", value: "12 85% 60%" },
  { label: "Teal", value: "175 70% 40%" },
  { label: "Lavender", value: "265 60% 65%" },
  { label: "Silver", value: "220 10% 70%" },
];

function eqHsl(a: string | null | undefined, b: string): boolean {
  return (a ?? "").trim() === b;
}

function SwatchGrid({
  presets,
  selected,
  onPick,
  disabled,
  testIdPrefix,
}: {
  presets: Swatch[];
  selected: string;
  onPick: (value: string) => void;
  disabled: boolean;
  testIdPrefix: string;
}) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
      {presets.map((s) => {
        const active = eqHsl(selected, s.value);
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => onPick(s.value)}
            disabled={disabled}
            title={`${s.label} (hsl(${s.value}))`}
            data-testid={`${testIdPrefix}-${s.value.replace(/[^a-z0-9]/gi, "")}`}
            className={`relative h-10 w-full rounded-md border-2 transition-all ${
              active
                ? "border-foreground ring-2 ring-foreground/30 scale-[1.05]"
                : "border-border hover:border-foreground/40"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            style={{ backgroundColor: `hsl(${s.value})` }}
            aria-label={s.label}
          >
            {active && (
              <Check className="h-4 w-4 absolute inset-0 m-auto text-white drop-shadow" />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TeamColorsCard() {
  const { data, isLoading } = useGetTeamSettings();
  const update = useUpdateTeamSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermission();
  const canEdit = can("full");

  const [primary, setPrimary] = useState<string>(APP_DEFAULT_PRIMARY);
  const [secondary, setSecondary] = useState<string>(APP_DEFAULT_SECONDARY);

  useEffect(() => {
    if (!data) return;
    setPrimary(data.primaryColor ?? APP_DEFAULT_PRIMARY);
    setSecondary(data.secondaryColor ?? APP_DEFAULT_SECONDARY);
  }, [data?.primaryColor, data?.secondaryColor, data]);

  const dirty =
    primary !== (data?.primaryColor ?? APP_DEFAULT_PRIMARY) ||
    secondary !== (data?.secondaryColor ?? APP_DEFAULT_SECONDARY);

  const handleSave = () => {
    update.mutate(
      {
        data: {
          primaryColor: primary === APP_DEFAULT_PRIMARY ? null : primary,
          secondaryColor:
            secondary === APP_DEFAULT_SECONDARY ? null : secondary,
        },
      },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getGetTeamSettingsQueryKey() });
          toast({ title: "Team colors saved" });
        },
        onError: (err) => {
          toast({
            title: "Couldn't save team colors",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleReset = () => {
    setPrimary(APP_DEFAULT_PRIMARY);
    setSecondary(APP_DEFAULT_SECONDARY);
  };

  return (
    <Card data-testid="card-team-colors">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" /> Team Colors
        </CardTitle>
        <CardDescription>
          Pick a primary and secondary color to brand the app for your team.
          Changes apply across the header, buttons, badges, and accents the
          moment you save.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Primary color</Label>
            <span
              className="h-6 w-12 rounded border border-border"
              style={{ backgroundColor: `hsl(${primary})` }}
            />
          </div>
          <SwatchGrid
            presets={PRIMARY_PRESETS}
            selected={primary}
            onPick={setPrimary}
            disabled={isLoading || !canEdit}
            testIdPrefix="swatch-primary"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Secondary color</Label>
            <span
              className="h-6 w-12 rounded border border-border"
              style={{ backgroundColor: `hsl(${secondary})` }}
            />
          </div>
          <SwatchGrid
            presets={SECONDARY_PRESETS}
            selected={secondary}
            onPick={setSecondary}
            disabled={isLoading || !canEdit}
            testIdPrefix="swatch-secondary"
          />
        </div>

        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Preview
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-3 py-1.5 rounded-md text-sm font-medium text-white"
              style={{ backgroundColor: `hsl(${primary})` }}
            >
              Primary button
            </span>
            <span
              className="px-3 py-1.5 rounded-md text-sm font-medium"
              style={{
                backgroundColor: `hsl(${secondary})`,
                color: "hsl(220 85% 18%)",
              }}
            >
              Accent badge
            </span>
            <span
              className="px-3 py-1.5 rounded-md text-sm font-medium border"
              style={{ borderColor: `hsl(${primary})`, color: `hsl(${primary})` }}
            >
              Outline link
            </span>
          </div>
        </div>

        <div className="flex justify-between items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isLoading || !canEdit}
            className="gap-2"
            data-testid="button-reset-team-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to defaults
          </Button>
          <Button
            onClick={handleSave}
            disabled={update.isPending || isLoading || !canEdit || !dirty}
            className="gap-2"
            data-testid="button-save-team-colors"
          >
            {update.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save colors
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
