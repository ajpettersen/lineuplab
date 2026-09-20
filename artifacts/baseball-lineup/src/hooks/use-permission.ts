import { useTeamContext, type PermissionTier } from "./use-team-context";
import { useOfflineFallback } from "@/lib/offline-session";

const RANK: Record<PermissionTier, number> = {
  view: 0,
  upload: 1,
  partial: 2,
  full: 3,
};

export interface PermissionState {
  /** Caller's tier on the active team. Defaults to 'view' while loading. */
  tier: PermissionTier;
  /** True if the caller is the actual head coach of the active team. */
  isOwner: boolean;
  /** True if the caller is in the master-admin allow-list. */
  isMasterAdmin: boolean;
  /** True while the team context query is still in-flight. */
  isLoading: boolean;
  /**
   * Tier-rank check — `can('partial')` returns true for partial AND
   * full. Use this to gate write controls.
   */
  can: (level: PermissionTier) => boolean;
}

/**
 * Single read-only view of "what is this user allowed to do on the
 * currently active team?" Hide write controls based on `can(level)`;
 * the server enforces the same contract independently so a stale UI
 * isn't a security risk — it just avoids dead clicks.
 */
export function usePermission(): PermissionState {
  const { data: ctx, isLoading } = useTeamContext();
  const offlineFallback = useOfflineFallback();
  // Offline with an expired session: show the cached team, but read-only.
  // Queued writes would need an auth token we can't get, so we hide the
  // write controls entirely rather than lose a coach's edits later.
  const tier: PermissionTier = offlineFallback ? "view" : ctx?.currentUser?.permission ?? "view";
  const required = RANK[tier];
  return {
    tier,
    isOwner: !offlineFallback && !!ctx?.isOwner,
    isMasterAdmin: !offlineFallback && !!ctx?.currentUser?.isMasterAdmin,
    isLoading,
    can: (level) => required >= RANK[level],
  };
}
