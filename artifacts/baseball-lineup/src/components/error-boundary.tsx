import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // After a new deploy, a page still running the old version can fail to
    // load a code file that no longer exists (Chrome: "Failed to fetch
    // dynamically imported module", Safari: "Importing a module script
    // failed"). Reload once to pick up the new version instead of showing
    // an error; the guard stops a reload loop if something is truly broken.
    if (/dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|Loading chunk|ChunkLoadError/i.test(error.message)) {
      try {
        const key = "lineupLab.chunkReloadedAt";
        const last = Number(sessionStorage.getItem(key) ?? "0");
        if (Date.now() - last > 60_000) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
          return;
        }
      } catch {
        // storage blocked: fall through to the error screen
      }
    }
    // Surface in dev console at minimum so QA / coaches in the field
    // can read off the error if asked. We intentionally don't ship a
    // remote-logging dependency just for this boundary.
    if (typeof console !== "undefined") {
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div
        role="alert"
        className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-12 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          This page hit an unexpected error. Try reloading — if it keeps
          happening, let us know what you were doing.
        </p>
        <pre className="max-h-40 w-full overflow-auto rounded-md border bg-muted/40 p-3 text-left text-xs text-muted-foreground">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <Button variant="outline" onClick={this.reset}>
            Try again
          </Button>
          <Button onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
      </div>
    );
  }
}
