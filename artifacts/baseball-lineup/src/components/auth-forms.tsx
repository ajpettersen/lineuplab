import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postAuth, useAuth } from "@/lib/auth";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SETUP_TOKEN_KEY = "lineupLab.passwordSetupToken";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="w-[440px] max-w-full rounded-2xl border border-[hsl(220,14%,88%)] bg-white p-6 shadow-xl sm:p-8">
      <div className="mb-4 flex justify-center">
        <img src={`${BASE}/logo.svg`} alt="Lineup Lab" className="h-12 w-12" />
      </div>
      <h1 className="text-center text-xl font-bold text-[hsl(220,30%,12%)]">{title}</h1>
      {subtitle && <p className="mt-1 text-center text-sm text-[hsl(220,14%,40%)]">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-[hsl(0,72%,90%)] bg-[hsl(0,72%,97%)] p-3 text-sm font-medium text-[hsl(0,72%,51%)]">
      {message}
    </p>
  );
}

/** After signing in, go home; PendingInviteRedirect then resumes a stashed join link or page. */
function useFinishSignIn() {
  const { refresh } = useAuth();
  const [, setLocation] = useLocation();
  return async () => {
    await refresh();
    setLocation("/", { replace: true });
  };
}

function useRedirectIfSignedIn() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (isLoaded && isSignedIn) setLocation("/", { replace: true });
  }, [isLoaded, isSignedIn, setLocation]);
}

export function SignInForm() {
  useRedirectIfSignedIn();
  const finish = useFinishSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await postAuth("sign-in", { email, password });
      await finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Welcome back, Coach" subtitle="Sign in to manage your team and lineups">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="sign-in-email">Email</Label>
          <Input id="sign-in-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-sign-in-email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sign-in-password">Password</Label>
          <Input id="sign-in-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-sign-in-password" />
        </div>
        <ErrorText message={error} />
        <Button type="submit" className="w-full" disabled={busy} data-testid="button-sign-in">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-[hsl(220,14%,40%)]">
        Forgot your password? Ask the Lineup Lab admin for a reset link.
      </p>
      <p className="mt-2 text-center text-sm text-[hsl(220,14%,40%)]">
        New coach? <Link href="/sign-up" className="font-semibold text-[hsl(220,85%,22%)] hover:underline">Create an account</Link>
      </p>
    </AuthCard>
  );
}

export function SignUpForm() {
  useRedirectIfSignedIn();
  const finish = useFinishSignIn();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await postAuth("sign-up", { name, email, password });
      await finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your account.");
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Create your coach account" subtitle="Set up your roster, schedule, and lineups">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="sign-up-name">Your name</Label>
          <Input id="sign-up-name" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-sign-up-name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sign-up-email">Email</Label>
          <Input id="sign-up-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-sign-up-email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sign-up-password">Password</Label>
          <Input id="sign-up-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-sign-up-password" />
          <p className="text-xs text-[hsl(220,14%,40%)]">At least 8 characters.</p>
        </div>
        <ErrorText message={error} />
        <Button type="submit" className="w-full" disabled={busy} data-testid="button-sign-up">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-[hsl(220,14%,40%)]">
        Already have an account? <Link href="/sign-in" className="font-semibold text-[hsl(220,85%,22%)] hover:underline">Sign in</Link>
      </p>
    </AuthCard>
  );
}

/** /set-password#<token> — the page a password link opens. */
export function SetPasswordForm() {
  const finish = useFinishSignIn();
  const [token] = useState(() => {
    const fromHash = window.location.hash.slice(1);
    if (fromHash) {
      try { sessionStorage.setItem(SETUP_TOKEN_KEY, fromHash); } catch { /* storage unavailable */ }
      history.replaceState(null, "", window.location.pathname + window.location.search);
      return fromHash;
    }
    try { return sessionStorage.getItem(SETUP_TOKEN_KEY) ?? ""; } catch { return ""; }
  });
  const [linkEmail, setLinkEmail] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<"checking" | "valid" | "invalid">(token ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checked = useRef(false);

  useEffect(() => {
    if (!token || checked.current) return;
    checked.current = true;
    postAuth<{ valid: boolean; email?: string }>("password-setup/validate", { token })
      .then((result) => {
        setLinkState(result.valid ? "valid" : "invalid");
        setLinkEmail(result.email ?? null);
      })
      .catch(() => setLinkState("invalid"));
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await postAuth("password-setup/complete", { token, password });
      try { sessionStorage.removeItem(SETUP_TOKEN_KEY); } catch { /* storage unavailable */ }
      await finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set your password.");
      setBusy(false);
    }
  };

  if (linkState === "checking") {
    return (
      <AuthCard title="Set your password">
        <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-[hsl(220,85%,22%)]" /></div>
      </AuthCard>
    );
  }
  if (linkState === "invalid") {
    return (
      <AuthCard title="This link doesn't work" subtitle="It may have expired or already been used. Ask the Lineup Lab admin for a new one.">
        <Link href="/sign-in" className="block text-center text-sm font-semibold text-[hsl(220,85%,22%)] hover:underline">Go to sign in</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Set your password" subtitle={linkEmail ? `For ${linkEmail}. You'll sign in with this email from now on.` : undefined}>
      <form onSubmit={submit} className="space-y-4">
        {linkEmail && <input type="email" autoComplete="username" value={linkEmail} readOnly hidden />}
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-[hsl(220,14%,40%)]">At least 8 characters.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Type it again</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <ErrorText message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save password and sign in
        </Button>
      </form>
    </AuthCard>
  );
}
