import { useEffect, useRef, lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import {
  QueryClient,
  MutationCache,
  useQueryClient,
  type MutationOptions,
  type MutationState,
} from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  queryPersister,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE,
  purgePersistedQueryCache,
} from "@/lib/query-persister";
import { registerMutationDefaults } from "@/lib/mutation-defaults";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useClerk,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/lib/confirm";
import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { OnlineResumer } from "@/components/online-resumer";
import { OfflinePrefetcher } from "@/components/offline-prefetcher";
import { ConflictListener } from "@/components/conflict-listener";
import { PushNavigationListener } from "@/components/push-navigation-listener";
import { TeamThemeApplier } from "@/components/team-theme-applier";
import { useTeamSettings } from "@/hooks/use-team-settings";

// Route components are code-split via React.lazy so the initial JS
// bundle only contains the app shell + whatever route the user
// landed on. Big wins for Lighthouse / first-load metrics:
//   - Recharts (Stats, Season Stats, Player Detail) is a chunky
//     dep that previously shipped with every page.
//   - dnd-kit, the lineup canvas, and the AI assistant only get
//     downloaded when the coach actually opens a game.
//   - The signed-out marketing landing now boots without pulling
//     down any of the authed-app pages.
// Layout, ErrorBoundary, and the auth surface stay eagerly imported
// because the shell renders them on every navigation.
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Ask = lazy(() => import("@/pages/ask"));
const Players = lazy(() => import("@/pages/players"));
const PlayerDetail = lazy(() => import("@/pages/player-detail"));
const Games = lazy(() => import("@/pages/games"));
const NewGame = lazy(() => import("@/pages/new-game"));
const GameDetail = lazy(() => import("@/pages/game-detail"));
const Tournaments = lazy(() => import("@/pages/tournaments"));
const TournamentDetail = lazy(() => import("@/pages/tournament-detail"));
const Practices = lazy(() => import("@/pages/practices"));
const PracticeDetail = lazy(() => import("@/pages/practice-detail"));
const FieldDisplay = lazy(() => import("@/pages/field-display"));
const Stats = lazy(() => import("@/pages/stats"));
const SeasonStats = lazy(() => import("@/pages/season-stats"));
const ArmWatch = lazy(() => import("@/pages/arm-watch"));
const Settings = lazy(() => import("@/pages/settings"));
const Teams = lazy(() => import("@/pages/teams"));
const Help = lazy(() => import("@/pages/help"));
// /depth-chart now mounts the combined Roster+Depth Chart page (it
// detects the path and opens to the Depth Chart tab). Keeps old
// bookmarks + the nav link working without a separate component.
const DepthChart = lazy(() => import("@/pages/players"));
const Admin = lazy(() => import("@/pages/admin"));
const AdminTeamDetail = lazy(() => import("@/pages/admin-team-detail"));
const Join = lazy(() => import("@/pages/join"));
const Landing = lazy(() => import("@/pages/landing"));
const Onboarding = lazy(() => import("@/pages/onboarding"));
const NotFound = lazy(() => import("@/pages/not-found"));

// Tiny fallback shown while a route chunk is fetching. Deliberately
// minimal — a full skeleton would itself bloat the initial bundle
// and most route chunks are <50 KB gzipped so this rarely lingers.
function RouteFallback() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-[40vh] items-center justify-center"
    >
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
    </div>
  );
}

// gcTime must exceed the persister's max-age, otherwise React Query
// would garbage-collect entries the persister later tries to rehydrate.
//
// staleTime: 30 s default. With React Query's default of 0 every page
// mount triggered a background refetch and showed a loading spinner
// even when the data was already in the cache from 5 seconds ago —
// navigating between Dashboard / Schedule / Roster / Stats felt
// laggy on every tap. With a 30 s freshness window, intra-app
// navigation paints from cache instantly (no spinner, no flicker)
// and only revalidates after the user has been somewhere else for
// half a minute. Mutations still invalidate explicitly via
// `qc.invalidateQueries`, so this does NOT make writes look stale —
// it only kills the flash on read-only navigation.
//
// Long-lived background data (team context, admin lookups, per-player
// game logs) sets its own staleTime locally and overrides this default.
/**
 * MutationCache that prefers the mutationFn registered via
 * `setMutationDefaults` (see lib/mutation-defaults.ts) over the one the
 * generated Orval hooks bake in.
 *
 * Why: the generated hooks ALWAYS supply their own `mutationFn`, and
 * React Query's option merge lets hook options win over defaults — so
 * the sync-aware default fn (the one that turns `vars._sync` into
 * `Idempotency-Key` / `If-Match` headers) would only ever run for
 * REPLAYED paused mutations, never for live saves. That silently
 * downgraded every live edit to last-writer-wins. Overriding `build`
 * makes live and replayed mutations take the identical code path.
 */
class SyncAwareMutationCache extends MutationCache {
  override build<TData, TError, TVariables, TContext>(
    client: QueryClient,
    options: MutationOptions<TData, TError, TVariables, TContext>,
    state?: MutationState<TData, TError, TVariables, TContext>,
  ) {
    if (options.mutationKey) {
      const defaults = client.getMutationDefaults(options.mutationKey);
      if (defaults.mutationFn) {
        options = {
          ...options,
          mutationFn: defaults.mutationFn as typeof options.mutationFn,
        };
      }
    }
    return super.build(client, options, state);
  }
}

const queryClient = new QueryClient({
  mutationCache: new SyncAwareMutationCache(),
  defaultOptions: {
    queries: {
      gcTime: PERSIST_MAX_AGE,
      staleTime: 30_000,
    },
  },
});

// Wire up `mutationFn` defaults for the offline-allowlisted mutations
// BEFORE PersistQueryClientProvider rehydrates, so any paused mutations
// restored from IndexedDB find a callable function and `resumePausedMutations`
// (fired by OnlineResumer on boot/reconnect) can actually replay them.
// See `lib/mutation-defaults.ts` for the allowlist + rationale.
registerMutationDefaults(queryClient);

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in env");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(220, 85%, 22%)",
    colorForeground: "hsl(220, 30%, 12%)",
    colorMutedForeground: "hsl(220, 14%, 40%)",
    colorDanger: "hsl(0, 72%, 51%)",
    colorBackground: "hsl(0, 0%, 100%)",
    colorInput: "hsl(215, 30%, 98%)",
    colorInputForeground: "hsl(220, 30%, 12%)",
    colorNeutral: "hsl(220, 14%, 80%)",
    fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
    borderRadius: "0.6rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl border border-[hsl(220,14%,88%)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[hsl(220,30%,12%)] font-bold",
    headerSubtitle: "text-[hsl(220,14%,40%)]",
    socialButtonsBlockButtonText: "text-[hsl(220,30%,12%)] font-medium",
    formFieldLabel: "text-[hsl(220,30%,12%)] font-medium",
    footerActionLink: "text-[hsl(220,85%,22%)] font-semibold hover:underline",
    footerActionText: "text-[hsl(220,14%,40%)]",
    dividerText: "text-[hsl(220,14%,40%)]",
    identityPreviewEditButton: "text-[hsl(220,85%,22%)]",
    formFieldSuccessText: "text-[hsl(145,63%,40%)]",
    alertText: "text-[hsl(0,72%,51%)]",
    logoBox: "flex justify-center mb-2",
    logoImage: "h-12 w-12",
    socialButtonsBlockButton:
      "border border-[hsl(220,14%,80%)] hover:bg-[hsl(215,30%,96%)]",
    formButtonPrimary:
      "bg-[hsl(220,85%,22%)] hover:bg-[hsl(220,85%,18%)] text-white font-semibold",
    formFieldInput:
      "border border-[hsl(220,14%,80%)] bg-white text-[hsl(220,30%,12%)]",
    footerAction: "text-center",
    dividerLine: "bg-[hsl(220,14%,88%)]",
    alert: "bg-[hsl(0,72%,97%)] border border-[hsl(0,72%,90%)]",
    otpCodeFieldInput:
      "border border-[hsl(220,14%,80%)] bg-white text-[hsl(220,30%,12%)]",
    formFieldRow: "gap-2",
    main: "gap-4",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  const valueProps = [
    "AI-generated lineups in seconds",
    "Box-score import from GameChanger screenshots",
    "iPad-friendly dugout view that works offline",
    "Schedule, roster, and practices in one place",
  ];
  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-2">
      {/* Left: brand / value */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[hsl(220,85%,16%)] p-10 text-white lg:flex">
        {/* Decorative gradient blobs */}
        <div
          className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, hsl(42,95%,55%), transparent)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -right-24 h-[28rem] w-[28rem] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, hsl(220,85%,55%), transparent)" }}
        />
        {/* Logo + brand */}
        <a
          href={basePath || "/"}
          className="relative z-10 inline-flex items-center gap-3"
          data-testid="link-signup-logo"
        >
          <img
            src={`${basePath}/logo.svg`}
            alt="Lineup Lab"
            className="h-10 w-10"
          />
          <span className="font-display text-2xl font-bold tracking-tight">
            Lineup Lab
          </span>
        </a>
        {/* Headline + bullets */}
        <div className="relative z-10 max-w-md space-y-8">
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight">
            Better lineups.
            <br />
            <span className="text-[hsl(42,95%,65%)]">Less paper-shuffling.</span>
          </h2>
          <ul className="space-y-3 text-base text-white/80">
            {valueProps.map((vp) => (
              <li key={vp} className="flex items-start gap-3">
                <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(42,95%,55%)]" />
                <span>{vp}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-sm text-white/60">
          The team binder for youth baseball and softball coaches.
        </p>
      </div>

      {/* Right: sign-up form */}
      <div className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        {/* Mobile-only logo */}
        <a
          href={basePath || "/"}
          className="mb-6 inline-flex items-center gap-2 lg:hidden"
          data-testid="link-signup-logo-mobile"
        >
          <img
            src={`${basePath}/logo.svg`}
            alt="Lineup Lab"
            className="h-8 w-8"
          />
          <span className="font-display text-lg font-bold tracking-tight">
            Lineup Lab
          </span>
        </a>
        <SignUp
          routing="path"
          path={`${basePath}/sign-up`}
          signInUrl={`${basePath}/sign-in`}
        />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          By creating an account you agree to our terms.
        </p>
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
        // Also wipe the IndexedDB-persisted cache directly. qc.clear()
        // alone isn't enough: the persister has a 1s write throttle,
        // so a dehydrate scheduled before the user change can still
        // overwrite IDB *after* the clear, leaking data into the next
        // sign-in on a shared iPad. See purgePersistedQueryCache().
        void purgePersistedQueryCache();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

/**
 * After a user finishes the sign-in flow that started from a /join/:token
 * link, they land on "/" because that's Clerk's default post-sign-in
 * destination. We stashed the token in sessionStorage before redirecting
 * to /sign-in — read it here and bounce them back to the join page so
 * they can finish accepting the invite.
 */
const PENDING_INVITE_KEY = "lineupLab.pendingInviteToken";
const RETURN_URL_KEY = "lineupLab.returnUrl";

function PendingInviteRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    let token: string | null = null;
    let returnUrl: string | null = null;
    try {
      token = sessionStorage.getItem(PENDING_INVITE_KEY);
      returnUrl = sessionStorage.getItem(RETURN_URL_KEY);
    } catch {
      // sessionStorage unavailable — nothing to do.
    }
    // Invite token wins over generic return URL — the user explicitly clicked
    // a join link and that flow needs to complete before anything else.
    if (token) {
      try {
        sessionStorage.removeItem(PENDING_INVITE_KEY);
        sessionStorage.removeItem(RETURN_URL_KEY);
      } catch {
        // ignore
      }
      setLocation(`/join/${token}`);
      return;
    }
    if (returnUrl) {
      try {
        sessionStorage.removeItem(RETURN_URL_KEY);
      } catch {
        // ignore
      }
      setLocation(returnUrl);
    }
  }, [setLocation]);
  return null;
}

/**
 * Wraps `<Redirect to="/sign-in" />` for signed-out users so we remember the
 * URL they were trying to reach. Critical for the dugout / fence-iPad flow:
 * if the iPad's Clerk session expires mid-game, signing back in must drop the
 * coach right back on `/games/:id/display`, not on the home dashboard.
 */
function StashAndRedirectToSignIn() {
  const [location] = useLocation();
  useEffect(() => {
    // Don't stash auth-flow paths or the bare home route — only meaningful
    // destinations like /games/123/display, /games/123, etc.
    const skip =
      location === "/" ||
      location.startsWith("/sign-in") ||
      location.startsWith("/sign-up") ||
      location.startsWith("/join/");
    if (skip) return;
    try {
      sessionStorage.setItem(RETURN_URL_KEY, location);
    } catch {
      // ignore
    }
  }, [location]);
  return <Redirect to="/sign-in" />;
}

/**
 * Auto-redirect new signups into the /welcome wizard. We avoid the
 * "every coach with null onboardingCompletedAt" trap (which dragged
 * pre-wizard legacy teams back through "name your team" they'd
 * already set) by also requiring the team_settings row to have been
 * created on or after WIZARD_REENABLE_AT — i.e. only teams that
 * signed up after this guard shipped.
 *
 * Anyone created before the cutoff is left alone forever; they can
 * still visit /welcome manually if they want a guided setup pass.
 * Editing identity / colors / roster is always available from
 * Settings and the relevant pages.
 */
const WIZARD_REENABLE_AT = new Date("2026-05-07T00:00:00Z").getTime();

function OnboardingGate({ children }: { children: React.ReactNode }) {
  const settings = useTeamSettings();
  const [location] = useLocation();

  // While the settings query is rehydrating we don't know yet — render
  // children rather than blank to avoid a layout flash for everyone.
  // For a brand-new signup the dashboard will briefly show empty state
  // before the redirect lands; that's an acceptable trade-off vs. a
  // global loading gate.
  if (settings.isLoading || settings.isError) return <>{children}</>;

  const createdAtMs = settings.createdAt ? new Date(settings.createdAt).getTime() : 0;
  const isNewSignup =
    !settings.onboardingCompletedAt &&
    Number.isFinite(createdAtMs) &&
    createdAtMs >= WIZARD_REENABLE_AT;

  // Don't redirect off /welcome itself, the join flow, or the
  // standalone field-display page (which is meant to be opened
  // directly on an iPad).
  const onWelcome = location === "/welcome";
  const onFieldDisplay = /^\/games\/[^/]+\/display$/.test(location);
  const onJoin = location.startsWith("/join/");

  if (isNewSignup && !onWelcome && !onFieldDisplay && !onJoin) {
    return <Redirect to="/welcome" />;
  }
  return <>{children}</>;
}

function ProtectedApp() {
  // We key the per-route ErrorBoundary on `location` so a render error
  // on one page (e.g. /stats) doesn't leave the fallback UI sticky when
  // the user navigates somewhere else — the new pathname rebuilds the
  // boundary, which clears its internal `error` state.
  const [location] = useLocation();
  return (
    <>
      <Show when="signed-in">
        {/* Inject the active team's primary/secondary colors as CSS vars on
            <html> for EVERY signed-in surface. This lives here (not inside
            Layout) so the Field Display and Onboarding — which render OUTSIDE
            the app shell — also pick up the team's brand colors. Mounted once
            above the route Switch so navigation never re-flickers the theme. */}
        <TeamThemeApplier />
        <PendingInviteRedirect />
        <OnboardingGate>
        {/* Single Suspense around the whole authed route tree so a
            chunk fetch shows the spinner once, not nested fallbacks. */}
        <Suspense fallback={<RouteFallback />}>
        <Switch>
          {/*
           * Dugout / fence-iPad display renders OUTSIDE the app shell so the
           * full screen is usable for at-a-distance reading. Still requires
           * sign-in (it's wrapped by the surrounding Show).
           */}
          <Route path="/games/:id/display" component={FieldDisplay} />
          {/* Onboarding wizard renders WITHOUT the app shell (its own
              focused layout) until the head coach completes setup. */}
          <Route path="/welcome" component={Onboarding} />
          <Route>
            <Layout>
              {/* Per-route error boundary so a render-time crash on one
                  page (e.g. /stats hitting an undefined field in API
                  data) doesn't blank the whole app shell. The user gets
                  a "try again / reload" UI instead of a white screen. */}
              <ErrorBoundary key={location}>
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/ask" component={Ask} />
                <Route path="/players" component={Players} />
                <Route path="/players/:id" component={PlayerDetail} />
                <Route path="/games/new" component={NewGame} />
                <Route path="/games/:id" component={GameDetail} />
                <Route path="/games" component={Games} />
                <Route path="/tournaments/:id" component={TournamentDetail} />
                <Route path="/tournaments" component={Tournaments} />
                <Route path="/practices/:id" component={PracticeDetail} />
                <Route path="/practices" component={Practices} />
                <Route path="/stats" component={Stats} />
                <Route path="/season-stats" component={SeasonStats} />
                <Route path="/arm-watch" component={ArmWatch} />
                {/* Constraints lives inside Settings now — keep the old URL alive for bookmarks. */}
                <Route path="/constraints">
                  <Redirect to="/settings#constraints" />
                </Route>
                <Route path="/depth-chart" component={DepthChart} />
                <Route path="/settings" component={Settings} />
                <Route path="/teams" component={Teams} />
                <Route path="/help" component={Help} />
                {/* Master-admin only — server-side `requireMasterAdmin`
                    middleware 403s the underlying APIs for non-admins,
                    and the page itself shows an "access denied" panel.
                    The nav item that links here is also gated. */}
                <Route path="/admin/teams/:ownerUserId" component={AdminTeamDetail} />
                <Route path="/admin" component={Admin} />
                <Route component={NotFound} />
              </Switch>
              </ErrorBoundary>
            </Layout>
          </Route>
        </Switch>
        </Suspense>
        </OnboardingGate>
      </Show>
      <Show when="signed-out">
        <Suspense fallback={<RouteFallback />}>
        <Switch>
          {/* Public marketing landing — only for the bare home route. Any
              other path stashes its destination and redirects to /sign-in
              so we can return there after auth (esp. /join/:token). */}
          <Route path="/" component={Landing} />
          <Route component={StashAndRedirectToSignIn} />
        </Switch>
        </Suspense>
      </Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back, Coach",
            subtitle: "Sign in to manage your team and lineups",
          },
        },
        signUp: {
          start: {
            title: "Create your coach account",
            subtitle: "Set up your roster, schedule, and lineups",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <PersistQueryClientProvider
        client={queryClient}
        // Fires once after the persister has finished asynchronously
        // rehydrating from IndexedDB. Any mutations restored in the
        // `paused` state (offline writes from a prior session) are
        // now in the MutationCache, so this is the earliest moment
        // we can replay them. OnlineResumer's mount effect runs
        // SYNCHRONOUSLY and would race the rehydrate, so we keep
        // boot-time resume logic here instead.
        onSuccess={() => {
          if (typeof navigator !== "undefined" && navigator.onLine) {
            void queryClient.resumePausedMutations();
          }
        }}
        persistOptions={{
          persister: queryPersister,
          maxAge: PERSIST_MAX_AGE,
          buster: PERSIST_BUSTER,
          // Persist queries (default) AND offline-paused mutations
          // from the allowlist registered in `mutation-defaults.ts`.
          // We only persist mutations whose state is `paused` (i.e.
          // fired offline with the default `networkMode: "online"`),
          // so successful / idle / pending mutations don't bloat
          // IndexedDB. This mirrors React Query's
          // `defaultShouldDehydrateMutation` but avoids importing it
          // — two `@tanstack/query-core` versions exist in the tree
          // (the persist-client package pulls an older one), and the
          // direct import triggers a type-identity clash. Hand-rolling
          // the predicate sidesteps that without changing semantics.
          // After rehydrate, OnlineResumer calls `resumePausedMutations`
          // which re-runs each paused mutation against the saved
          // `mutationFn` default.
          dehydrateOptions: {
            shouldDehydrateMutation: (m) => m.state.isPaused,
          },
        }}
      >
        <ClerkQueryClientCacheInvalidator />
        <OnlineResumer />
        <OfflinePrefetcher />
        <ConflictListener />
        <PushNavigationListener />
        <TooltipProvider>
          {/* ConfirmProvider mounts a single AlertDialog instance and
              exposes a promise-based `useConfirm()` helper used across
              the app in place of `window.confirm` — keeps native
              browser prompts off mobile/iPad. */}
          <ConfirmProvider>
            {/* Top-level Suspense covers the lazy <Join /> route below.
                Authed and signed-out trees inside ProtectedApp have
                their own nested boundaries so a route chunk swap shows
                the spinner where the page would render, not over the
                whole app. */}
            <Suspense fallback={<RouteFallback />}>
            <Switch>
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/join/:token" component={Join} />
              <Route component={ProtectedApp} />
            </Switch>
            </Suspense>
            <Toaster />
          </ConfirmProvider>
        </TooltipProvider>
      </PersistQueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
