import { lazy, Suspense } from "react";
import { useTeamSettings } from "@/hooks/use-team-settings";

// /games/:id/display: the baseball field for baseball teams, the half court
// for basketball teams. Both are split out so each sport only downloads its own.
const FieldDisplay = lazy(() => import("@/pages/field-display"));
const CourtDisplay = lazy(() => import("@/pages/basketball-court-display"));

function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-[100dvh] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
    </div>
  );
}

export default function GameDisplay() {
  const { sport, isLoading } = useTeamSettings();
  if (isLoading) return <Loading />;
  return <Suspense fallback={<Loading />}>{sport === "basketball" ? <CourtDisplay /> : <FieldDisplay />}</Suspense>;
}
