import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getListPlayersQueryKey,
  getListGamesQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Demo seed is preview-only. In a production build (`vite build` for the
 * deployed app) `import.meta.env.DEV` is false, so the Settings page hides
 * the Demo data card entirely. The server endpoint is also gated on
 * NODE_ENV !== production as a defense-in-depth measure — a real coach
 * signing into the live app can never load demo data into their team.
 */
export const DEMO_SEED_ENABLED: boolean = import.meta.env.DEV;

type SeedResponse = {
  created: boolean;
  players: number;
  games: number;
};

/**
 * Custom error so `onError` can branch on the real HTTP status (401, 404,
 * 5xx, network) and surface a useful next-step message instead of a generic
 * "something broke" toast. Carries the raw status code so the UI doesn't
 * have to parse strings.
 */
class SeedError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "SeedError";
  }
}

async function postSeed(): Promise<SeedResponse> {
  let resp: Response;
  try {
    resp = await fetch(`${BASE}/api/demo/seed`, {
      method: "POST",
      // Belt-and-suspenders: in same-origin dev preview cookies travel
      // automatically, but be explicit so this also works if the API ever
      // moves to a sub-domain behind the proxy.
      credentials: "include",
    });
  } catch (e) {
    // Network failure — fetch threw before we got any response.
    throw new SeedError(0, e instanceof Error ? e.message : "Network error");
  }
  if (!resp.ok) {
    // Try to pull the server's error string for the toast description; fall
    // back to status text if the response body isn't JSON.
    let serverMsg = resp.statusText;
    try {
      const body = (await resp.json()) as { error?: string };
      if (typeof body.error === "string") serverMsg = body.error;
    } catch {
      /* ignore — body wasn't JSON */
    }
    throw new SeedError(resp.status, serverMsg);
  }
  return (await resp.json()) as SeedResponse;
}

/**
 * Imperative mutation hook for the "Load demo data" button on the Settings
 * page. Fires the seed endpoint and invalidates player/game queries on
 * success so the UI re-renders with the new rows. The endpoint is
 * idempotent — if the team already has any data the server returns
 * `created: false` and we surface that with a toast instead of an error.
 *
 * On error, branches on the HTTP status so the coach actually knows what to
 * do next (vs. the old generic "try again" message that hid auth/expired
 * session issues — which was the most common real failure mode).
 */
export function useSeedDemoMutation() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: postSeed,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: getListPlayersQueryKey() });
      void qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
      if (data.created) {
        toast({
          title: "Demo data loaded",
          description: `Added ${data.players} players and ${data.games} games. Delete anything you don't want.`,
        });
      } else {
        toast({
          title: "Already have data",
          description:
            "Demo seed only runs on a totally empty team. Clear your roster and schedule first.",
        });
      }
    },
    onError: (err) => {
      const status = err instanceof SeedError ? err.status : -1;
      let title = "Couldn't load demo data";
      let description = "Try again, or add a player manually.";
      if (status === 401) {
        title = "Please sign in again";
        description =
          "Your session expired. Refresh the page, sign in, then try Load demo data again.";
      } else if (status === 404) {
        title = "Demo data isn't available here";
        description =
          "The seed endpoint is preview/dev only. Add players and games manually.";
      } else if (status === 0) {
        title = "Network error";
        description = "Couldn't reach the server. Check your connection and retry.";
      } else if (status >= 500) {
        title = "Server error";
        description = `The seed failed (${status}). Try again in a moment.`;
      }
      toast({ title, description, variant: "destructive" });
    },
  });
}
