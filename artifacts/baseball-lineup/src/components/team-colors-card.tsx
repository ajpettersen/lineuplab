import { useEffect, useMemo, useRef, useState } from "react";
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
import { Slider } from "@/components/ui/slider";
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

// HSL string is stored as "H S% L%" (matches the CSS-var convention used
// by --primary etc. in index.css), so parse/format on those bounds.
type Hsl = { h: number; s: number; l: number };

function parseHsl(v: string | null | undefined): Hsl {
  if (!v) return { h: 0, s: 0, l: 0 };
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) return { h: 0, s: 0, l: 0 };
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

function formatHsl({ h, s, l }: Hsl): string {
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

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

/**
 * Circular HSL picker. The disc renders the full hue spectrum
 * (conic-gradient by angle) blended with a radial white→transparent
 * gradient so saturation grows from 0 at the center to 100% at the
 * edge. Click or drag anywhere inside the disc to set hue +
 * saturation; a separate slider underneath controls lightness so
 * coaches can dial in dark navys or pastel pinks from the same
 * picker.
 *
 * Why a disc instead of an HTML <input type="color">? The native
 * picker hides the relationship between hue/saturation/lightness, and
 * the team brand UX leans heavily on "hue family + how dark/light"
 * intuition (e.g. "make my navy a touch lighter"). A visible disc +
 * lightness rail surfaces both axes the coach actually thinks in.
 */
function ColorWheel({
  value,
  onChange,
  disabled,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  testId: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const parsed = useMemo(() => parseHsl(value), [value]);

  // Marker position derived from current H/S. Hue 0 (red) sits at the
  // 12 o'clock position; we rotate the disc so colors read intuitively
  // (red top → yellow → green → cyan → blue → magenta → red).
  const markerStyle = useMemo(() => {
    const angleRad = ((parsed.h - 90) * Math.PI) / 180;
    const radius = parsed.s / 100; // 0..1
    const x = 50 + radius * 50 * Math.cos(angleRad);
    const y = 50 + radius * 50 * Math.sin(angleRad);
    return { left: `${x}%`, top: `${y}%` };
  }, [parsed.h, parsed.s]);

  const pickFromEvent = (e: { clientX: number; clientY: number }) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const r = rect.width / 2;
    const dist = Math.min(r, Math.hypot(dx, dy));
    // Angle in degrees, 0 at 12 o'clock, sweeping clockwise to match
    // the color-wheel convention coaches expect.
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    const hue = (angle + 360) % 360;
    const sat = (dist / r) * 100;
    onChange(formatHsl({ h: hue, s: sat, l: parsed.l }));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    draggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // older browsers
    }
    pickFromEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    pickFromEvent(e);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={ref}
        role="application"
        aria-label="Color wheel"
        data-testid={testId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative h-44 w-44 sm:h-52 sm:w-52 rounded-full shadow-inner ring-1 ring-border touch-none ${
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-crosshair"
        }`}
        style={{
          background:
            // Hue ring (full spectrum sweeping from the top, clockwise)
            // composited with a center→edge white gradient that fades
            // saturation toward the middle. The browser blends them so
            // the disc reads as a proper HSL picker.
            "conic-gradient(from 0deg, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))",
        }}
      >
        {/* Saturation fade — white in the middle, transparent at the
            edge — sits on top of the hue ring. */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at center, white 0%, rgba(255,255,255,0) 70%)",
          }}
        />
        {/* Lightness overlay — black multiplied in proportional to how
            dark the user dialed the lightness slider. At 50% lightness
            (pure hue) this is fully transparent; at 0% it's solid
            black; at 100% it's solid white. */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none mix-blend-multiply"
          style={{
            background:
              parsed.l <= 50
                ? `rgba(0,0,0,${(50 - parsed.l) / 50})`
                : "transparent",
          }}
        />
        <div
          className="absolute inset-0 rounded-full pointer-events-none mix-blend-screen"
          style={{
            background:
              parsed.l > 50
                ? `rgba(255,255,255,${(parsed.l - 50) / 50})`
                : "transparent",
          }}
        />
        {/* Crosshair marker at current H/S position. */}
        <div
          aria-hidden="true"
          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)] pointer-events-none"
          style={{
            ...markerStyle,
            backgroundColor: `hsl(${formatHsl(parsed)})`,
          }}
        />
      </div>
      <div className="w-full max-w-xs space-y-1">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
          <span>Lightness</span>
          <span className="font-mono tabular-nums">{Math.round(parsed.l)}%</span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[parsed.l]}
          disabled={disabled}
          onValueChange={(v) =>
            onChange(formatHsl({ ...parsed, l: v[0] ?? parsed.l }))
          }
          data-testid={`${testId}-lightness`}
          aria-label="Lightness"
        />
      </div>
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
          Use the quick swatches below for common picks, or grab any color from
          the wheel. Changes apply across the header, buttons, badges, and
          accents the moment you save.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
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
          <ColorWheel
            value={primary}
            onChange={setPrimary}
            disabled={isLoading || !canEdit}
            testId="wheel-primary"
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
          <ColorWheel
            value={secondary}
            onChange={setSecondary}
            disabled={isLoading || !canEdit}
            testId="wheel-secondary"
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
