import { useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { Show, useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { useInvitePreview, useAcceptInvite } from "@/hooks/use-team-context";
import { useToast } from "@/hooks/use-toast";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const PENDING_INVITE_KEY = "lineupLab.pendingInviteToken";

/**
 * Standalone landing page for invite links. Lives outside ProtectedApp
 * so that signed-out visitors don't get the "redirect to /sign-in" loop
 * that would lose the token. We stash the token in sessionStorage before
 * sending them to sign-in; the post-sign-in handler in App.tsx reads it
 * and bounces them back here.
 */
export default function Join() {
  const [, params] = useRoute("/join/:token");
  const token = params?.token ?? "";

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <Show when="signed-out">
          <SignInRedirect token={token} />
        </Show>
        <Show when="signed-in">
          <AcceptFlow token={token} />
        </Show>
      </Card>
    </div>
  );
}

function SignInRedirect({ token }: { token: string }) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (token) {
      try {
        sessionStorage.setItem(PENDING_INVITE_KEY, token);
      } catch {
        // sessionStorage might be unavailable (private mode, etc.) — the
        // user can re-open the link after signing in instead.
      }
    }
    // Redirect on next tick so React doesn't complain about transitions.
    const t = setTimeout(() => setLocation("/sign-in"), 50);
    return () => clearTimeout(t);
  }, [token, setLocation]);

  return (
    <>
      <CardHeader className="text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
          <Shield className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>You've been invited to coach</CardTitle>
        <CardDescription>
          Sign in to accept the invite and join the team.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </CardContent>
    </>
  );
}

function AcceptFlow({ token }: { token: string }) {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const { toast } = useToast();
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite();

  // Clear any pending-invite redirect breadcrumb now that we've made it
  // back to the join page after sign-in.
  useEffect(() => {
    try {
      sessionStorage.removeItem(PENDING_INVITE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const onAccept = () => {
    accept.mutate(token, {
      onSuccess: (team) => {
        toast({
          title: `Welcome to ${team.teamName}`,
          description: "You now have full access to this team's data.",
        });
        setLocation("/");
      },
      onError: (err) => {
        toast({
          title: "Couldn't accept invite",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      },
    });
  };

  if (preview.isLoading) {
    return (
      <CardContent className="py-12 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </CardContent>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <>
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
            <XCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>Invite not found</CardTitle>
          <CardDescription>
            This invite link is invalid or has been deleted. Ask your head
            coach for a fresh one.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button variant="outline" onClick={() => setLocation("/")}>
            Go to my team
          </Button>
        </CardContent>
      </>
    );
  }

  const p = preview.data;

  if (p.status === "expired" || p.status === "revoked" || p.status === "accepted") {
    const titles = {
      expired: "Invite expired",
      revoked: "Invite revoked",
      accepted: "Invite already used",
    } as const;
    const messages = {
      expired:
        "This link has expired. Ask the head coach to send you a fresh invite.",
      revoked: "The head coach revoked this invite. Ask them for a new one.",
      accepted:
        "Each invite can only be used once. Ask the head coach for a new link if you need to join again.",
    } as const;
    return (
      <>
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center mb-2">
            <AlertTriangle className="h-6 w-6 text-amber-700" />
          </div>
          <CardTitle>{titles[p.status]}</CardTitle>
          <CardDescription>{messages[p.status]}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button variant="outline" onClick={() => setLocation("/")}>
            Go to my team
          </Button>
        </CardContent>
      </>
    );
  }

  if (p.status === "self") {
    return (
      <>
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center mb-2">
            <AlertTriangle className="h-6 w-6 text-amber-700" />
          </div>
          <CardTitle>That's your own team</CardTitle>
          <CardDescription>
            You created this invite — share the link with another coach
            instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button variant="outline" onClick={() => setLocation("/")}>
            Back to dashboard
          </Button>
        </CardContent>
      </>
    );
  }

  if (p.status === "already_member") {
    return (
      <>
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mb-2">
            <CheckCircle2 className="h-6 w-6 text-green-700" />
          </div>
          <CardTitle>You're already on this team</CardTitle>
          <CardDescription>
            You've already accepted an invite from {p.teamName}. Use the team
            switcher in the header to jump in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button onClick={() => setLocation("/")}>Continue</Button>
        </CardContent>
      </>
    );
  }

  return (
    <>
      <CardHeader className="text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
          <Shield className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>Join {p.teamName}</CardTitle>
        <CardDescription>
          You've been invited to be an assistant coach for{" "}
          <strong>{p.teamName}</strong>. Accepting gives you full access to
          their roster, schedule, lineups, and AI memory.
          {user?.primaryEmailAddress?.emailAddress && (
            <>
              {" "}
              You're signing in as{" "}
              <strong>{user.primaryEmailAddress.emailAddress}</strong>.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          onClick={onAccept}
          disabled={accept.isPending}
          className="w-full gap-2"
          data-testid="button-accept-invite"
        >
          {accept.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Accept invite
        </Button>
        <Button
          variant="outline"
          onClick={() => setLocation("/")}
          disabled={accept.isPending}
          className="w-full"
        >
          Not now
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          You can leave the team any time from Settings.
        </p>
      </CardContent>
    </>
  );
}
