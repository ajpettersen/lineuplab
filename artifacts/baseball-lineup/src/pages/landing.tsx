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
  UserPlus,
  Wand2,
  Tablet,
} from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Each feature card renders a screenshot above the icon/title. The
// `image` paths point at `public/feature-shots/<slug>.webp` — drop a
// new webp in there and it'll just show up. Until a file exists,
// `<FeatureImage>` falls back to a stylized icon-on-gradient
// placeholder (see component below).
//
// We standardized on WebP (was PNG) to slash landing-page weight —
// the six screenshots dropped from ~1.4 MB total to ~250 KB. Modern
// Safari, Chrome, Firefox, and Edge all support it; the only thing
// that doesn't is IE11 which we don't target.
const FEATURES = [
  {
    icon: Sparkles,
    image: "feature-shots/ai-lineups.webp",
    title: "AI lineups in seconds",
    body:
      "Fair lineups and rotations from your roster and playing-time history: batting orders and positions for baseball and softball, sub rotations for basketball. Or just ask the assistant in plain English.",
  },
  {
    icon: Users,
    image: "feature-shots/roster.webp",
    title: "Roster + multi-coach",
    body:
      "Bulk-import players from a screenshot, share the team with assistant coaches, and give each helper exactly the access they need.",
  },
  {
    icon: ListChecks,
    image: "feature-shots/stats.webp",
    title: "Stats that mean something",
    body:
      "Season playing time, starts, and a fairness score for every sport, plus plus/minus for basketball and GameChanger box scores, batting, and pitching for baseball and softball.",
  },
  {
    icon: CalendarDays,
    image: "feature-shots/schedule.webp",
    title: "Schedule + practices",
    body:
      "Paste a calendar link to import games, plan practices with AI-generated drill blocks, and run tournament days with pool-play standings.",
  },
  {
    icon: ClipboardList,
    image: "feature-shots/field-display.webp",
    title: "Game-day display",
    body:
      "A field or court display for your iPad or phone: positions or sub alerts, playing time, and the score. It keeps working without a signal.",
  },
  {
    icon: Trophy,
    image: "feature-shots/youth-coaches.webp",
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
        {/* Hero — moved above the promo video so the <h1> + value prop
            are the first content the page (and any crawler) sees. The
            video still appears immediately after, before the fold on
            most laptops. */}
        <section className="mx-auto max-w-6xl px-4 pt-10 sm:px-6 sm:pt-14">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Built for youth sports coaches
            </span>
            <h1 className="mt-5 font-display text-4xl font-bold tracking-tight sm:text-6xl">
              Better lineups.
              <br />
              <span className="text-primary">Less paper-shuffling.</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
              Lineup Lab is the all-in-one team binder for youth baseball,
              softball, and basketball coaches: rosters, schedules, fair
              lineups and rotations, practice plans, and playing-time stats
              in one tidy place.
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
            <p className="mt-4 text-xs text-muted-foreground">
              Free to use · No credit card · Set up in 5 minutes
            </p>
          </div>
        </section>

        {/* Promo video */}
        <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6 sm:pt-16">
          {/*
            On mobile, a 16:9 frame at viewport width is only ~200 px
            tall, which crushes the scene text + animations. Use a
            taller 4:5 frame on phones so the video composition (which
            absolutely-positions to fill its container) has real estate
            to render legibly. Snap back to 16:9 from `sm` up where the
            wide cinematic crop is intended.
          */}
          <div className="relative aspect-[4/5] overflow-hidden rounded-xl border border-border bg-black shadow-lg sm:aspect-video">
            {/* No `loading="lazy"` here — even though the video is now
                below the hero, on most desktops it's still in the
                first viewport, so deferring just leaves a black box
                during the initial render. */}
            <iframe
              src="/promo-video/"
              title="Lineup Lab promo"
              className="absolute inset-0 h-full w-full"
              allow="autoplay"
              data-testid="iframe-landing-promo"
            />
          </div>
        </section>

        {/* How it works — three concrete steps so coaches can mentally
            simulate using the app before signing up. Helps conversion
            and gives Google more keyword-rich landing-page copy. */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Up and running in three steps
            </h2>
            <p className="mt-3 text-muted-foreground">
              No spreadsheets, no setup wizards that take an hour.
            </p>
          </div>
          <ol className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              {
                icon: UserPlus,
                title: "1. Bring your roster",
                body:
                  "Snap a photo of your team list or paste it in — the AI splits names, jersey numbers, and preferred positions for you.",
              },
              {
                icon: Wand2,
                title: "2. Generate a fair lineup",
                body:
                  "Mark who's here. Lineup Lab builds a fair lineup or sub rotation that respects who sat last time.",
              },
              {
                icon: Tablet,
                title: "3. Coach from the bench",
                body:
                  "Open the Field or Court Display on your iPad or phone, make changes on the fly, and keep playing time fair, even with no signal.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="rounded-xl border border-border bg-card/40 p-6"
                data-testid={`how-it-works-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold">
                  {title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Features */}
        <section className="border-t border-border/60 bg-card/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Everything a head coach actually needs
              </h2>
              <p className="mt-3 text-muted-foreground">
                Built around real game-day workflows, not a calendar app
                with a whistle bolted on.
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

        {/* FAQ — answers the questions a parent-coach actually asks
            before signing up. Doubles as long-tail SEO copy. Rendered
            as native <details>/<summary> for built-in expand/collapse
            without pulling in another shadcn primitive. */}
        <section className="border-t border-border/60 bg-card/30">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Frequently asked questions
              </h2>
              <p className="mt-3 text-muted-foreground">
                Quick answers for new coaches checking us out.
              </p>
            </div>
            <div className="mt-10 space-y-3">
              {[
                {
                  q: "Is Lineup Lab free?",
                  a: "Yes. The full app (roster management, lineups and rotations, schedule import, practice plans, stats, and the game-day displays) is free for coaches to use today.",
                },
                {
                  q: "Which sports does it work for?",
                  a: "Baseball, softball, and basketball. Each team picks its sport. Baseball and softball get positions by inning, batting orders, and pitching rules (standard 9 or 10-player defense). Basketball gets sub rotations by position group, a court display with sub alerts, fouls and score, and playing-time targets.",
                },
                {
                  q: "How does the fair lineup generator work?",
                  a: "Lineup Lab tracks how much each player has played and sat across the season. New lineups and rotations give more time to kids who've sat the most, so playing time evens out across games. In baseball and softball it also rotates positions, with a fairness dial from 0 (skill-first) to 100 (strict equal time); in basketball, players behind on minutes or starts get the extra shift and the start.",
                },
                {
                  q: "Can my assistant coaches help?",
                  a: "Yes. Invite assistant coaches with a link and pick a permission tier — full access, partial (no settings), upload-only for a stat-keeper parent, or view-only.",
                },
                {
                  q: "Does it work without a signal at the field?",
                  a: "Yes. The Field and Court Displays keep your roster and lineup on the device, so you can keep coaching with no cellular signal, and changes sync automatically when you're back online.",
                },
                {
                  q: "Can I import my schedule from my league?",
                  a: "Yes. GameChanger, TeamSnap, and most league sites publish a calendar link. Connect it once and Lineup Lab fills in the season — opponents and start times included — and keeps it updated when games move.",
                },
                {
                  q: "Can I import GameChanger box scores?",
                  a: "Yes, for baseball and softball. Snap 1–4 phone screenshots of your GameChanger box score; the AI extracts batting and pitching lines plus the final score, with an editable preview before it saves.",
                },
              ].map(({ q, a }) => (
                <details
                  key={q}
                  className="group rounded-xl border border-border bg-background p-5 [&_summary::-webkit-details-marker]:hidden"
                  data-testid={`faq-${q.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-base font-semibold">
                    <span>{q}</span>
                    <span
                      aria-hidden="true"
                      className="text-xl text-muted-foreground transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm text-muted-foreground">{a}</p>
                </details>
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
        Lineup Lab · Built for youth baseball, softball, and basketball coaches
      </footer>
    </div>
  );
}
