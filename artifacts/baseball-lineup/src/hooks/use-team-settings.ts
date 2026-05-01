import { useGetTeamSettings } from "@workspace/api-client-react";

export function useTeamSettings() {
  const query = useGetTeamSettings();
  return {
    teamName: query.data?.teamName ?? "",
    teamShortName: query.data?.teamShortName ?? "",
    isLoading: query.isLoading,
    isError: query.isError,
    raw: query,
  };
}
