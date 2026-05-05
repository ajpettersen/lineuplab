import { useTeamContext, type PermissionTier } from "./use-team-context";

const RANK: Record<PermissionTier, number> = { view: 0, partial: 1, full: 2 };

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
  const tier: PermissionTier = ctx?.currentUser?.permission ?? "view";
  const required = RANK[tier];
  return {
    tier,
    isOwner: !!ctx?.isOwner,
    isMasterAdmin: !!ctx?.currentUser?.isMasterAdmin,
    isLoading,
    can: (level) => required >= RANK[level],
  };
}
