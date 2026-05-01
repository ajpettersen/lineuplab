import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
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
import Dashboard from "@/pages/dashboard";
import Players from "@/pages/players";
import PlayerDetail from "@/pages/player-detail";
import Games from "@/pages/games";
import NewGame from "@/pages/new-game";
import GameDetail from "@/pages/game-detail";
import Stats from "@/pages/stats";
import Constraints from "@/pages/constraints";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

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
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ProtectedApp() {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/players" component={Players} />
            <Route path="/players/:id" component={PlayerDetail} />
            <Route path="/games/new" component={NewGame} />
            <Route path="/games/:id" component={GameDetail} />
            <Route path="/games" component={Games} />
            <Route path="/stats" component={Stats} />
            <Route path="/constraints" component={Constraints} />
            <Route path="/settings" component={Settings} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
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
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={ProtectedApp} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
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
