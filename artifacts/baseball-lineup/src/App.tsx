import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  queryPersister,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE,
  purgePersistedQueryCache,
} from "@/lib/query-persister";
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
import { Layout } from "@/components/layout";
import { OnlineResumer } from "@/components/online-resumer";
import { useTeamSettings } from "@/hooks/use-team-settings";
import Dashboard from "@/pages/dashboard";
import Players from "@/pages/players";
import PlayerDetail from "@/pages/player-detail";
import Games from "@/pages/games";
import NewGame from "@/pages/new-game";
import GameDetail from "@/pages/game-detail";
import Tournaments from "@/pages/tournaments";
import TournamentDetail from "@/pages/tournament-detail";
import Practices from "@/pages/practices";
import PracticeDetail from "@/pages/practice-detail";
import FieldDisplay from "@/pages/field-display";
import Stats from "@/pages/stats";
import SeasonStats from "@/pages/season-stats";
import ArmWatch from "@/pages/arm-watch";
import Settings from "@/pages/settings";
import Admin from "@/pages/admin";
import AdminTeamDetail from "@/pages/admin-team-detail";
import Join from "@/pages/join";
import Landing from "@/pages/landing";
import Onboarding from "@/pages/onboarding";
import NotFound from "@/pages/not-found";

// gcTime must exceed the persister's max-age, otherwise React Query
// would garbage-collect entries the persister later tries to rehydrate.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: PERSIST_MAX_AGE,
    },
  },
});

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
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
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
  return (
    <>
      <Show when="signed-in">
        <PendingInviteRedirect />
        <OnboardingGate>
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
              <Switch>
                <Route path="/" component={Dashboard} />
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
                  <Redirect to="/settings#constraints-section" />
                </Route>
                <Route path="/settings" component={Settings} />
                {/* Master-admin only — server-side `requireMasterAdmin`
                    middleware 403s the underlying APIs for non-admins,
                    and the page itself shows an "access denied" panel.
                    The nav item that links here is also gated. */}
                <Route path="/admin/teams/:ownerUserId" component={AdminTeamDetail} />
                <Route path="/admin" component={Admin} />
                <Route component={NotFound} />
              </Switch>
            </Layout>
          </Route>
        </Switch>
        </OnboardingGate>
      </Show>
      <Show when="signed-out">
        <Switch>
          {/* Public marketing landing — only for the bare home route. Any
              other path stashes its destination and redirects to /sign-in
              so we can return there after auth (esp. /join/:token). */}
          <Route path="/" component={Landing} />
          <Route component={StashAndRedirectToSignIn} />
        </Switch>
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
        persistOptions={{
          persister: queryPersister,
          maxAge: PERSIST_MAX_AGE,
          buster: PERSIST_BUSTER,
          // Don't persist mutation state or in-flight queries — they
          // can't safely resume across reloads. Successful query
          // results (the data we want offline) are persisted by
          // default.
          dehydrateOptions: {
            shouldDehydrateMutation: () => false,
          },
        }}
      >
        <ClerkQueryClientCacheInvalidator />
        <OnlineResumer />
        <TooltipProvider>
          <Switch>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/join/:token" component={Join} />
            <Route component={ProtectedApp} />
          </Switch>
          <Toaster />
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
