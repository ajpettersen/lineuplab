import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// Lineup Lab's own sign-in. The server keeps the session in an HttpOnly
// cookie, so the browser never sees a token; this only asks the server who
// is signed in and calls the sign-in endpoints.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SessionInfo {
  signedIn: boolean;
  userId?: string;
  email?: string | null;
  displayName?: string | null;
}

interface AuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  email: string | null;
  displayName: string | null;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** POSTs JSON to an /api/auth endpoint and returns the JSON, or throws the server's message. */
export async function postAuth<T = unknown>(path: string, body: unknown = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/auth/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach Lineup Lab. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Something went wrong. Please try again.");
  }
  return data as T;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${BASE}/api/auth/session`, { credentials: "same-origin", cache: "no-store" });
      setSession(response.ok ? await response.json() : { signedIn: false });
    } catch {
      // Offline: keep what we knew. On a cold boot with no signal this
      // means "signed out", and the signed-out tree falls back to the
      // cached team when this device has been signed in before.
      setSession((current) => current ?? { signedIn: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refresh]);

  const value = useMemo<AuthState>(() => ({
    isLoaded: session !== null,
    isSignedIn: !!session?.signedIn,
    userId: session?.signedIn ? session.userId ?? null : null,
    email: session?.signedIn ? session.email ?? null : null,
    displayName: session?.signedIn ? session.displayName ?? null : null,
    refresh,
  }), [refresh, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

/** Renders its children only once the session is known and matches `when`. */
export function Show({ when, children }: { when: "signed-in" | "signed-out"; children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return (when === "signed-in") === isSignedIn ? <>{children}</> : null;
}

/** Ends the session on the server, then refreshes so the app sees it. */
export async function signOut(refresh: () => Promise<void>): Promise<void> {
  await postAuth("sign-out").catch(() => {});
  await refresh();
}
