import { lazy, Suspense } from "react";
import { useTeamSettings } from "@/hooks/use-team-settings";

// /games/:id: the lineup builder for baseball teams, a simpler game page for
// basketball teams (their rotation lives on the Bench Sheet).
const GameDetail = lazy(() => import("@/pages/game-detail"));
const BasketballGame = lazy(() => import("@/pages/basketball-game"));

function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-[40vh] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
    </div>
  );
}

export default function GamePage() {
  const { sport, isLoading } = useTeamSettings();
  if (isLoading) return <Loading />;
  return <Suspense fallback={<Loading />}>{sport === "basketball" ? <BasketballGame /> : <GameDetail />}</Suspense>;
}
