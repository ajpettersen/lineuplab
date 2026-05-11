import { useState, type ComponentType } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Trophy,
  Users,
  ListChecks,
  Sparkles,
  CalendarDays,
  ClipboardList,
} from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Each feature card renders a screenshot above the icon/title. The
// `image` paths point at `public/feature-shots/<slug>.png` — drop a
// real screenshot in there and it'll just show up. Until a file
// exists, `<FeatureImage>` falls back to a stylized icon-on-gradient
// placeholder (see component below).
const FEATURES = [
  {
    icon: Sparkles,
    image: "feature-shots/ai-lineups.png",
    title: "AI lineups in seconds",
    body:
      "Generate fair, balanced lineups from your roster, batting order, and fielding history — or talk to the assistant in plain English.",
  },
  {
    icon: Users,
    image: "feature-shots/roster.png",
    title: "Roster + multi-coach",
    body:
      "Bulk-import players from a screenshot, share the team with assistant coaches, and give each helper exactly the access they need.",
  },
  {
    icon: ListChecks,
    image: "feature-shots/stats.png",
    title: "Stats that mean something",
    body:
      "Box-score import from GameChanger screenshots, season batting and pitching aggregates, and a fairness score for playing time.",
  },
  {
    icon: CalendarDays,
    image: "feature-shots/schedule.png",
    title: "Schedule + practices",
    body:
      "Paste an iCal URL to import games, plan practices with AI-generated drill blocks, and track tournament pitching rules.",
  },
  {
    icon: ClipboardList,
    image: "feature-shots/field-display.png",
    title: "Field display for the dugout",
    body:
      "iPad-friendly view that works offline so you can adjust positions on the fence without losing your spot.",
  },
  {
    icon: Trophy,
    image: "feature-shots/youth-coaches.png",
    title: "Built for youth coaches",
    body:
      "Designed around the way real coaches juggle a season — fast inputs, big tap targets, and a workflow that respects your time.",
  },
];

function FeatureImage({
  src,
  alt,
  Icon,
}: {
  src: string;
  alt: string;
  Icon: ComponentType<{ className?: string }>;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border/60 bg-gradient-to-br from-primary/15 via-primary/5 to-accent/15">
      {!failed ? (
        <img
          src={`${basePath}/${src}`}
          alt={alt}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Icon className="h-14 w-14 text-primary/30" />
        </div>
      )}
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header
        className="border-b border-border/60 bg-card/40"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <img
              src={`${basePath}/logo.svg`}
              alt="Lineup Lab"
              className="h-9 w-9"
            />
            <span className="font-display text-xl font-bold tracking-tight">
              Lineup Lab
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/sign-in">
              <Button variant="ghost" data-testid="link-landing-sign-in">
                Sign in
              </Button>
            </Link>
            <Link href="/sign-up">
              <Button
                size="lg"
                className="shadow-md shadow-primary/20"
                data-testid="link-landing-sign-up-top"
              >
                Get started
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Promo video */}
        <section className="mx-auto max-w-6xl px-4 pt-10 sm:px-6 sm:pt-14">
          {/*
            On mobile, a 16:9 frame at viewport width is only ~200 px
            tall, which crushes the scene text + animations. Use a
            taller 4:5 frame on phones so the video composition (which
            absolutely-positions to fill its container) has real estate
            to render legibly. Snap back to 16:9 from `sm` up where the
            wide cinematic crop is intended.
          */}
          <div className="relative aspect-[4/5] overflow-hidden rounded-xl border border-border bg-black shadow-lg sm:aspect-video">
            {/* No `loading="lazy"` here — this iframe is the very first
                visible content above the fold, so deferring it just
                leaves a black box during the initial render. We want the
                promo bundle to start fetching as soon as possible. */}
            <iframe
              src="/promo-video/"
              title="Lineup Lab promo"
              className="absolute inset-0 h-full w-full"
              allow="autoplay"
              data-testid="iframe-landing-promo"
            />
          </div>
        </section>

        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Built for youth baseball
            </span>
            <h1 className="mt-5 font-display text-4xl font-bold tracking-tight sm:text-6xl">
              Better lineups.
              <br />
              <span className="text-primary">Less paper-shuffling.</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
              Lineup Lab is the all-in-one team binder for youth baseball and
              softball coaches — rosters, schedules, AI-generated lineups,
              practice plans, and box-score stats in one tidy place.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/sign-up">
                <Button
                  size="lg"
                  className="h-14 px-10 text-lg font-semibold shadow-lg shadow-primary/25 transition-transform hover:-translate-y-0.5"
                  data-testid="link-landing-sign-up"
                >
                  Create your team
                </Button>
              </Link>
              <Link href="/sign-in">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-14 px-8 text-base"
                  data-testid="link-landing-sign-in-hero"
                >
                  I already have an account
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-border/60 bg-card/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Everything a head coach actually needs
              </h2>
              <p className="mt-3 text-muted-foreground">
                Built around real game-day workflows — not a calendar app
                wearing a baseball hat.
              </p>
            </div>
            <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, image, title, body }) => (
                <div
                  key={title}
                  className="overflow-hidden rounded-xl border border-border bg-background shadow-sm transition-shadow hover:shadow-md"
                  data-testid={`feature-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  <div className="p-3 pb-0">
                    <FeatureImage src={image} alt={title} Icon={Icon} />
                  </div>
                  <div className="p-6 pt-5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 font-display text-lg font-semibold">
                      {title}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Ready for a calmer season?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Set up your team in under five minutes. We'll walk you through
            every step.
          </p>
          <div className="mt-8">
            <Link href="/sign-up">
              <Button
                size="lg"
                className="px-10 text-base"
                data-testid="link-landing-sign-up-bottom"
              >
                Create my account
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 bg-card/40 py-8 text-center text-xs text-muted-foreground">
        Lineup Lab · Built for youth baseball and softball coaches
      </footer>
    </div>
  );
}
