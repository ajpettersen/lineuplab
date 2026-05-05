import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

type Accent = "neutral" | "win" | "loss" | "warn";

const ACCENT_NUMERAL_CLASS: Record<Accent, string> = {
  neutral: "text-foreground",
  win: "text-emerald-700 dark:text-emerald-400",
  loss: "text-destructive",
  warn: "text-amber-600 dark:text-amber-400",
};

interface BroadcastStatCardProps {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  icon?: LucideIcon;
  accent?: Accent;
  info?: React.ReactNode;
  testId?: string;
}

/**
 * Broadcast-style summary stat card. Used on the Dashboard and Rotation
 * Report. Visual recipe lifted from the Field Display lower-third:
 *   • thin gold stripe on the top edge
 *   • Oswald uppercase label with wide tracking (eyebrow utility)
 *   • Roboto Mono tabular numerals at large size for the value
 * Keeps the surrounding chrome plain (white card, soft border) so a wall
 * of these cards reads like a stadium scorebug rather than a rainbow.
 */
export function BroadcastStatCard({
  label,
  value,
  subtext,
  icon: Icon,
  accent = "neutral",
  info,
  testId,
}: BroadcastStatCardProps) {
  return (
    <Card
      className="relative overflow-hidden border-border/80 hover:shadow-md transition-shadow broadcast-stripe"
      data-testid={testId}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="eyebrow text-muted-foreground truncate">{label}</span>
            {info}
          </div>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
        </div>
        <div
          className={`mt-3 font-numeric text-4xl sm:text-5xl font-bold leading-none ${ACCENT_NUMERAL_CLASS[accent]}`}
        >
          {value}
        </div>
        {subtext != null && (
          <p className="text-xs text-muted-foreground mt-2">{subtext}</p>
        )}
      </div>
    </Card>
  );
}
