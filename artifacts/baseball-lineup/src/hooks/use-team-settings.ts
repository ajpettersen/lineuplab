import { useGetTeamSettings } from "@workspace/api-client-react";

const DEFAULT_FIELD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;

export function useTeamSettings() {
  const query = useGetTeamSettings();
  const battingStyle: "continuous" | "nine_man" =
    query.data?.battingStyle === "nine_man" ? "nine_man" : "continuous";
  // Fall back to the standard 9 when the team has never picked, so existing
  // teams behave exactly the same as before this feature shipped.
  const stored = query.data?.activeFieldPositions;
  const activeFieldPositions: readonly string[] =
    Array.isArray(stored) && stored.length > 0 ? stored : DEFAULT_FIELD_POSITIONS;
  // Tournament feature flag — defaults true so any team that hasn't
  // explicitly turned it off in Settings keeps the existing behavior
  // (Tournaments visible in the Events nav, Tournament option in the
  // game-type picker). While the query is loading we also assume true
  // so the nav doesn't flash an item in/out on every page load.
  const usesTournaments: boolean = query.data?.usesTournaments ?? true;
  return {
    teamName: query.data?.teamName ?? "",
    teamShortName: query.data?.teamShortName ?? "",
    battingStyle,
    activeFieldPositions,
    usesTournaments,
    onboardingCompletedAt: query.data?.onboardingCompletedAt ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    raw: query,
  };
}
