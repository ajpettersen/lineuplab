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

const FEATURES = [
  {
    icon: Sparkles,
    title: "AI lineups in seconds",
    body:
      "Generate fair, balanced lineups from your roster, batting order, and fielding history — or talk to the assistant in plain English.",
  },
  {
    icon: Users,
    title: "Roster + multi-coach",
    body:
      "Bulk-import players from a screenshot, share the team with assistant coaches, and give each helper exactly the access they need.",
  },
  {
    icon: ListChecks,
    title: "Stats that mean something",
    body:
      "Box-score import from GameChanger screenshots, season batting and pitching aggregates, and a fairness score for playing time.",
  },
  {
    icon: CalendarDays,
    title: "Schedule + practices",
    body:
      "Paste an iCal URL to import games, plan practices with AI-generated drill blocks, and track tournament pitching rules.",
  },
  {
    icon: ClipboardList,
    title: "Field display for the dugout",
    body:
      "iPad-friendly view that works offline so you can adjust positions on the fence without losing your spot.",
  },
  {
    icon: Trophy,
    title: "Built for youth coaches",
    body:
      "Designed around the way real coaches juggle a season — fast inputs, big tap targets, and zero billing screens.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/60 bg-card/40">
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
              <Button data-testid="link-landing-sign-up-top">Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Free for every coach
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
                  className="px-8 text-base"
                  data-testid="link-landing-sign-up"
                >
                  Sign up free
                </Button>
              </Link>
              <Link href="/sign-in">
                <Button
                  size="lg"
                  variant="outline"
                  className="px-8 text-base"
                  data-testid="link-landing-sign-in-hero"
                >
                  I already have an account
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              No credit card. No trials. No paywalls — Lineup Lab is just free.
            </p>
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
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div
                  key={title}
                  className="rounded-xl border border-border bg-background p-6 shadow-sm transition-shadow hover:shadow-md"
                  data-testid={`feature-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">{body}</p>
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
                Create my free account
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
