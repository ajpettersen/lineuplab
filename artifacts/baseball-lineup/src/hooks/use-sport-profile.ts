import { useTeamSettings } from "@/hooks/use-team-settings";
import type { SportId, SportProfile } from "@workspace/sport-profiles";

/**
 * Convenience hook for any surface that only needs the team's sport and its
 * resolved profile (positions, period label, on-court count, feature gating,
 * terminology). Thin wrapper over {@link useTeamSettings} so roster, lineup,
 * and onboarding screens don't each re-derive the sport. Defaults to baseball
 * while settings load so existing teams render unchanged.
 */
export function useSportProfile(): {
  sport: SportId;
  profile: SportProfile;
  isLoading: boolean;
} {
  const { sport, sportProfile, isLoading } = useTeamSettings();
  return { sport, profile: sportProfile, isLoading };
}
