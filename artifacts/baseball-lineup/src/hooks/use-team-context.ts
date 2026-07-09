import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { purgePersistedQueryCache } from "@/lib/query-persister";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Wipe + refetch EVERYTHING after the active team scope changes
 * (switch team / create team / accept invite).
 *
 * Why resetQueries and not qc.clear(): clear() silently REMOVES all
 * queries without notifying mounted observers — components keep
 * rendering their last data until something else forces a re-render,
 * so the header/team name would stay on the OLD team after a switch.
 * resetQueries() resets every query to initial state AND notifies
 * observers, refetching all active queries under the new team scope.
 * We also purge the IndexedDB-persisted cache so a throttled dehydrate
 * of the old team's data can't be restored later.
 */
async function resetTeamScopedCache(qc: QueryClient): Promise<void> {
  void purgePersistedQueryCache().catch(() => {});
  await qc.resetQueries();
}

export type PermissionTier = "full" | "partial" | "upload" | "view";

export interface TeamSummary {
  ownerUserId: string;
  teamName: string;
  teamShortName: string;
}

/**
 * Per-team profile + access info for the calling user. Populated by the
 * server based on the user's row in `team_memberships` for the active
 * team. Master admins on a foreign team get a synthesized 'full' tier
 * with `profileComplete = true` (no prompt — they're not really on the
 * team, just visiting in support mode).
 */
export interface CurrentUserContext {
  displayName: string | null;
  role: string | null;
  permission: PermissionTier;
  profileComplete: boolean;
  isMasterAdmin: boolean;
}

export interface TeamContext {
  userId: string;
  activeOwnerUserId: string;
  isOwner: boolean;
  /** The user's personal (first) team — kept for the admin "return to my team" flow. */
  ownedTeam: TeamSummary;
  /** ALL teams the user is head coach of: personal team first, then extra teams. */
  ownedTeams: TeamSummary[];
  memberOf: TeamSummary[];
  currentUser: CurrentUserContext;
}

export const teamContextQueryKey = ["team", "context"] as const;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      // ignore
    }
    const msg =
      (body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : null) ?? `Request failed (${resp.status})`;
    throw new Error(msg);
  }
  return (await resp.json()) as T;
}

/**
 * Single source of truth for the active team. Every page that scopes
 * data to "the current team" depends on this query — when it changes
 * (e.g. user switches teams), we clear the React Query cache so all
 * downstream queries refetch under the new team's scope.
 */
export function useTeamContext() {
  return useQuery<TeamContext>({
    queryKey: teamContextQueryKey,
    queryFn: () => fetchJson<TeamContext>(`${BASE}/api/team/context`),
    staleTime: 30_000,
  });
}

/**
 * Switch the currently-active team. After the server-side pointer is
 * updated, we wipe the entire React Query cache so any subsequent query
 * (players, games, lineups, ai memory, etc.) refetches against the new
 * team. This is the same pattern used when a user signs in/out.
 */
export function useSwitchTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ownerUserId: string) =>
      fetchJson<{ activeOwnerUserId: string }>(`${BASE}/api/team/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerUserId }),
      }),
    onSuccess: async () => {
      await resetTeamScopedCache(qc);
    },
  });
}

export interface CreateTeamInput {
  teamName: string;
  teamShortName?: string;
}

/**
 * Create an ADDITIONAL team owned by the calling user (new season/year,
 * second squad, …). The server switches the active team to the new one,
 * so on success we wipe the React Query cache — same as switching teams.
 */
export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTeamInput) =>
      fetchJson<TeamSummary>(`${BASE}/api/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await resetTeamScopedCache(qc);
    },
  });
}

export interface TeamInvite {
  id: number;
  token: string;
  label: string | null;
  invitedEmail: string | null;
  sentEmailAt: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
}

export interface CreateInviteInput {
  label?: string;
  email?: string;
}

export interface TeamMember {
  id: number;
  memberUserId: string;
  memberEmail: string | null;
  memberName: string | null;
  displayName: string | null;
  role: string | null;
  permission: PermissionTier;
  isOwner: boolean;
  joinedAt: string;
}

export const teamInvitesQueryKey = ["team", "invites"] as const;
export const teamMembersQueryKey = ["team", "members"] as const;

export function useTeamInvites(enabled = true) {
  return useQuery<TeamInvite[]>({
    queryKey: teamInvitesQueryKey,
    queryFn: () => fetchJson<TeamInvite[]>(`${BASE}/api/team/invites`),
    enabled,
  });
}

export function useTeamMembers(enabled = true) {
  return useQuery<TeamMember[]>({
    queryKey: teamMembersQueryKey,
    queryFn: () => fetchJson<TeamMember[]>(`${BASE}/api/team/members`),
    enabled,
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input?: string | CreateInviteInput) => {
      // Back-compat: existing callsites pass a bare label string.
      const body =
        typeof input === "string" || input === undefined
          ? { label: input }
          : input;
      return fetchJson<TeamInvite>(`${BASE}/api/team/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamInvitesQueryKey });
    },
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/team/invites/${id}`, { method: "DELETE" }).then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamInvitesQueryKey });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberUserId: string) =>
      fetch(`${BASE}/api/team/members/${encodeURIComponent(memberUserId)}`, {
        method: "DELETE",
      }).then(async (r) => {
        if (!r.ok) {
          let msg = `Request failed (${r.status})`;
          try {
            const body = (await r.json()) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            // ignore
          }
          throw new Error(msg);
        }
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamMembersQueryKey });
    },
  });
}

export interface UpdateMemberInput {
  memberUserId: string;
  displayName?: string | null;
  role?: string | null;
  permission?: PermissionTier;
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberUserId, ...patch }: UpdateMemberInput) =>
      fetchJson<TeamMember>(
        `${BASE}/api/team/members/${encodeURIComponent(memberUserId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamMembersQueryKey });
      void qc.invalidateQueries({ queryKey: teamContextQueryKey });
    },
  });
}

export interface UpdateCoachProfileInput {
  displayName: string;
  role?: string | null;
}

/**
 * Update the calling user's per-team coach profile (the displayName +
 * free-form role label shown to teammates). Used by the first-time
 * onboarding prompt and from the coach's own row in the Coaches card.
 */
export function useUpdateCoachProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCoachProfileInput) =>
      fetchJson<{
        displayName: string | null;
        role: string | null;
        permission: PermissionTier;
      }>(`${BASE}/api/coach-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamContextQueryKey });
      void qc.invalidateQueries({ queryKey: teamMembersQueryKey });
    },
  });
}

export interface InvitePreview {
  status: "ok" | "revoked" | "expired" | "accepted" | "self" | "already_member";
  teamName: string;
  teamShortName: string;
  expiresAt: string;
}

export function useInvitePreview(token: string) {
  return useQuery<InvitePreview>({
    queryKey: ["invite", token],
    queryFn: () => fetchJson<InvitePreview>(`${BASE}/api/invites/${encodeURIComponent(token)}`),
    enabled: token.length > 0,
    retry: false,
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      fetchJson<TeamSummary>(`${BASE}/api/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
      }),
    onSuccess: async () => {
      // Wipe everything — we're now scoped to a different team.
      await resetTeamScopedCache(qc);
    },
  });
}
