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

async function postSeed(): Promise<SeedResponse> {
  const resp = await fetch(`${BASE}/api/demo/seed`, { method: "POST" });
  if (!resp.ok) throw new Error(`Seed failed (${resp.status})`);
  return (await resp.json()) as SeedResponse;
}

/**
 * Imperative mutation hook for the "Load demo data" button on the Settings
 * page. Fires the seed endpoint and invalidates player/game queries on
 * success so the UI re-renders with the new rows. The endpoint is
 * idempotent — if the team already has any data the server returns
 * `created: false` and we surface that with a toast instead of an error.
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
    onError: () => {
      toast({
        title: "Couldn't load demo data",
        description: "Try again, or add a player manually.",
        variant: "destructive",
      });
    },
  });
}
