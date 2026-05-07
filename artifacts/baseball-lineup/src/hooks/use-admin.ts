import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
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

export interface AdminMe {
  isMasterAdmin: boolean;
}

/**
 * Lightweight signed-in-only query so the layout can decide whether
 * to render the Admin nav item. Cached for the session — the env
 * allow-list doesn't change without a server restart.
 */
export function useAdminMe() {
  return useQuery<AdminMe>({
    queryKey: ["admin", "me"],
    queryFn: () => fetchJson<AdminMe>(`${BASE}/api/admin/me`),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}

export interface AdminTeamRow {
  ownerUserId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  teamName: string;
  teamShortName: string;
  memberCount: number;
  gameCount: number;
  playerCount: number;
  lastActivityAt: string | null;
}

export function useAdminTeams(enabled: boolean) {
  return useQuery<AdminTeamRow[]>({
    queryKey: ["admin", "teams"],
    queryFn: () => fetchJson<AdminTeamRow[]>(`${BASE}/api/admin/teams`),
    enabled,
    retry: false,
  });
}

export interface AdminMember {
  memberUserId: string;
  memberEmail: string | null;
  memberName: string | null;
  displayName: string | null;
  role: string | null;
  permission: string;
  isOwner: boolean;
  joinedAt: string;
}

export interface AdminGameRow {
  id: number;
  opponent: string;
  gameDate: string;
  status: string;
}

export interface AdminTeamDetail {
  ownerUserId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  teamName: string;
  teamShortName: string;
  members: AdminMember[];
  recentGames: AdminGameRow[];
}

export function useAdminTeamDetail(ownerUserId: string | null, enabled: boolean) {
  return useQuery<AdminTeamDetail>({
    queryKey: ["admin", "teams", ownerUserId],
    queryFn: () =>
      fetchJson<AdminTeamDetail>(
        `${BASE}/api/admin/teams/${encodeURIComponent(ownerUserId!)}`,
      ),
    enabled: enabled && !!ownerUserId,
    retry: false,
  });
}

export interface AdminUserRow {
  userId: string;
  email: string | null;
  name: string | null;
  teams: Array<{
    ownerUserId: string;
    isOwner: boolean;
    displayName: string | null;
    role: string | null;
    permission: string;
  }>;
  lastSeenAt: string | null;
  minutesActive24h: number;
  minutesActive7d: number;
  minutesActive30d: number;
}

export interface AdminAiUsageTeam {
  ownerUserId: string;
  teamName: string;
  teamShortName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  last24h: number;
  last7d: number;
  last30d: number;
  lastCallAt: string | null;
  featureCounts: Record<string, number>;
}

export interface AdminAiUsage {
  budgetPerDay: number;
  totals: { last24h: number; last7d: number; last30d: number };
  perTeam: AdminAiUsageTeam[];
}

export function useAdminAiUsage(enabled: boolean) {
  return useQuery<AdminAiUsage>({
    queryKey: ["admin", "ai-usage"],
    queryFn: () => fetchJson<AdminAiUsage>(`${BASE}/api/admin/ai-usage`),
    enabled,
    retry: false,
    // The dashboard is a debugging surface — refetch on focus so it
    // reflects whatever just happened in another tab.
    refetchOnWindowFocus: true,
  });
}

export function useAdminUsers(enabled: boolean) {
  return useQuery<AdminUserRow[]>({
    queryKey: ["admin", "users"],
    queryFn: () => fetchJson<AdminUserRow[]>(`${BASE}/api/admin/users`),
    enabled,
    retry: false,
  });
}

export interface AdminAiQuestionRow {
  id: number;
  ownerUserId: string;
  askedByUserId: string;
  gameId: number | null;
  question: string;
  intent: string;
  responsePreview: string | null;
  createdAt: string;
  teamName: string;
  askerName: string | null;
  askerEmail: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
}

export interface AdminAiQuestions {
  questions: AdminAiQuestionRow[];
}

export function useAdminAiQuestions(enabled: boolean) {
  return useQuery<AdminAiQuestions>({
    queryKey: ["admin", "ai-questions"],
    queryFn: () =>
      fetchJson<AdminAiQuestions>(`${BASE}/api/admin/ai-questions?limit=100`),
    enabled,
    retry: false,
    refetchOnWindowFocus: true,
  });
}
