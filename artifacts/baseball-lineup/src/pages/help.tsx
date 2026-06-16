import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { HelpCard } from "@/components/help-card";
import { QuickTour } from "@/components/quick-tour";
import { LifeBuoy, PlayCircle, ListChecks } from "lucide-react";

/**
 * Help / FAQ page (`/help`). Three stacked surfaces:
 *   1. A "Quick Tour" slideshow (`<QuickTour>`) — real app screenshots with
 *      captions, rendered IN-APP (not an iframe).
 *   2. The AI "Ask the app" card (reused from the dashboard).
 *   3. A static FAQ accordion covering the core coaching workflow.
 *
 * The tour is built inside this deployable app (reusing the same real
 * `public/feature-shots/*.webp` as the landing page) rather than embedding the
 * separate, non-deployable `help-tour` video artifact — which was blank in
 * published builds.
 */

interface FaqEntry {
  q: string;
  a: React.ReactNode;
}

const FAQ: FaqEntry[] = [
  {
    q: "How do I add players to my roster?",
    a: (
      <>
        Open{" "}
        <Link href="/players" className="text-primary underline underline-offset-2">
          Roster
        </Link>{" "}
        and add players one at a time, or use bulk import to paste a list of
        names or upload a screenshot of your roster — the app reads it for you.
        Set each player's preferred positions so lineups know where they fit
        best.
      </>
    ),
  },
  {
    q: "How do I schedule a game?",
    a: (
      <>
        Go to{" "}
        <Link href="/games" className="text-primary underline underline-offset-2">
          Schedule
        </Link>{" "}
        and add a game with the opponent, date, and location. To import a whole
        season at once, paste an iCal / webcal link from your league and the
        games will be pulled in automatically.
      </>
    ),
  },
  {
    q: "How do I create a lineup?",
    a: (
      <>
        Open any game and generate a lineup automatically — the app builds a
        fair rotation across positions and innings. You can also describe what
        you want in plain English, copy a lineup from a past game, or import one
        from a screenshot. Everything is editable with drag-and-drop afterward.
      </>
    ),
  },
  {
    q: "What is the Fairness dial?",
    a: (
      <>
        The Fairness dial (0–100) controls how strictly the lineup generator
        equalizes playing time and bench rest across your players. Higher means
        the app works harder to balance who sits and who plays the premium
        positions. The Fairness Score and{" "}
        <Link href="/stats" className="text-primary underline underline-offset-2">
          Rotation Report
        </Link>{" "}
        show how even things have been across the season.
      </>
    ),
  },
  {
    q: "Can I lock a player into a position?",
    a: (
      <>
        Yes. While editing a lineup you can lock a player into a specific
        position for a single inning or for all innings. The generator works
        around your locks when it fills in the rest of the field.
      </>
    ),
  },
  {
    q: "How do I run the game from the dugout?",
    a: (
      <>
        Open a game and launch the Field Display — a large, iPad-optimized view
        showing the live lineup, fielding positions by inning, and the
        scoreboard. It's built for at-a-distance reading in the dugout and keeps
        working even if your signal drops, syncing back up when you're online
        again.
      </>
    ),
  },
  {
    q: "How do I track batting and pitching stats?",
    a: (
      <>
        Visit{" "}
        <Link href="/season-stats" className="text-primary underline underline-offset-2">
          Season Stats
        </Link>{" "}
        for batting and pitching totals. If your team uses GameChanger, you can
        import a box score from 1–4 phone screenshots — the app extracts each
        player's stats and the final score into an editable preview.
      </>
    ),
  },
  {
    q: "How do I share my team with another coach?",
    a: (
      <>
        From{" "}
        <Link href="/settings" className="text-primary underline underline-offset-2">
          Settings
        </Link>{" "}
        you can invite other coaches and give each one a permission level —
        from view-only, to a stat-keeper who can only enter box scores, up to a
        full co-coach who can edit everything. The owner always keeps full
        control.
      </>
    ),
  },
  {
    q: "How does tournament mode work?",
    a: (
      <>
        Turn on tournaments in{" "}
        <Link href="/settings" className="text-primary underline underline-offset-2">
          Settings
        </Link>
        , then create a tournament and add its games. You get pitch tracking
        with your own pitch-count rules, pool vs. bracket stages, optional time
        limits with a dugout countdown, and a hub showing your record and
        available pitchers at a glance.
      </>
    ),
  },
  {
    q: "Can I change my team colors and name?",
    a: (
      <>
        Yes. In{" "}
        <Link href="/settings" className="text-primary underline underline-offset-2">
          Settings
        </Link>{" "}
        the head coach can set the team name (used throughout the app) and pick
        team colors from preset swatches. The whole app re-themes to match.
      </>
    ),
  },
  {
    q: "Does it work offline, and can I install it?",
    a: (
      <>
        The Field Display keeps working without a connection and saves your
        changes locally, then syncs when you're back online. You can also
        install the app to your phone or iPad's home screen from your browser's
        share / install menu for a full-screen, app-like experience.
      </>
    ),
  },
];

export default function Help() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <LifeBuoy className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-broadcast uppercase tracking-wide">Help</h1>
          <p className="text-sm text-muted-foreground">
            A quick tour, answers to common questions, and an assistant that
            knows the app.
          </p>
        </div>
      </div>

      <Card data-testid="card-help-tour">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <PlayCircle className="h-4 w-4 text-primary" />
            Quick Tour
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            A 60-second walkthrough of the most important things a coach does.
          </p>
        </CardHeader>
        <CardContent>
          <QuickTour />
        </CardContent>
      </Card>

      <HelpCard />

      <Card data-testid="card-help-faq">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            Frequently asked questions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {FAQ.map((item, i) => (
              <AccordionItem key={i} value={`faq-${i}`} data-testid={`faq-item-${i}`}>
                <AccordionTrigger className="text-sm font-medium">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
