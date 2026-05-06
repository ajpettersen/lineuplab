import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
  ownedTeam: TeamSummary;
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
    onSuccess: () => {
      qc.clear();
    },
  });
}

export interface TeamInvite {
  id: number;
  token: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
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
    mutationFn: (label?: string) =>
      fetchJson<TeamInvite>(`${BASE}/api/team/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      }),
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
    onSuccess: () => {
      // Wipe everything — we're now scoped to a different team.
      qc.clear();
    },
  });
}
