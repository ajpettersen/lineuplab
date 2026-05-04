import { useGetTeamSettings } from "@workspace/api-client-react";

export function useTeamSettings() {
  const query = useGetTeamSettings();
  const battingStyle: "continuous" | "nine_man" =
    query.data?.battingStyle === "nine_man" ? "nine_man" : "continuous";
  return {
    teamName: query.data?.teamName ?? "",
    teamShortName: query.data?.teamShortName ?? "",
    battingStyle,
    isLoading: query.isLoading,
    isError: query.isError,
    raw: query,
  };
}
