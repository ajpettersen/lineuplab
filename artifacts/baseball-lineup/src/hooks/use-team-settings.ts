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
  return {
    teamName: query.data?.teamName ?? "",
    teamShortName: query.data?.teamShortName ?? "",
    battingStyle,
    activeFieldPositions,
    isLoading: query.isLoading,
    isError: query.isError,
    raw: query,
  };
}
