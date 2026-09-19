import { useGetTeamSettings } from "@workspace/api-client-react";
import { getSportProfile, type SportId, type SportProfile } from "@workspace/sport-profiles";

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
  // Defensive Lineup → Select Positions button visibility. Hidden by
  // default; coaches who swap field formats game-to-game enable it
  // from Settings → Defaults.
  const showSelectPositions: boolean = query.data?.showSelectPositions ?? false;
  // Per-team sport (default baseball so existing teams are untouched). The
  // resolved profile drives positions, period labels, on-court count, and
  // which baseball-only features show across the app.
  const sport: SportId = query.data?.sport === "basketball" ? "basketball" : "baseball";
  const sportProfile: SportProfile = getSportProfile(sport);
  // Calendar-sync fields are returned by GET /team-settings but aren't in
  // the generated OpenAPI type (they're managed by the hand-rolled
  // /api/calendar routes, not the settings PATCH).
  const cal = query.data as
    | {
        icalUrl?: string | null;
        icalLastSyncAt?: string | null;
        icalLastSyncError?: string | null;
        icalLastSyncCount?: number | null;
      }
    | undefined;
  return {
    calendar: {
      url: cal?.icalUrl ?? null,
      lastSyncAt: cal?.icalLastSyncAt ?? null,
      lastSyncError: cal?.icalLastSyncError ?? null,
      gameCount: cal?.icalLastSyncCount ?? null,
    },
    teamName: query.data?.teamName ?? "",
    teamShortName: query.data?.teamShortName ?? "",
    sport,
    sportProfile,
    battingStyle,
    activeFieldPositions,
    usesTournaments,
    showSelectPositions,
    onboardingCompletedAt: query.data?.onboardingCompletedAt ?? null,
    createdAt: query.data?.createdAt ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    raw: query,
  };
}
