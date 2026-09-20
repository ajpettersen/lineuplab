/**
 * Query options for the handful of endpoints that don't have generated
 * hooks (Arm Watch, season batting/pitching, imported fielding history).
 *
 * They live here so the pages that read them and the offline prefetcher
 * (lib/prefetch-offline.ts) use identical keys and fetchers — otherwise a
 * prefetch writes a cache entry the page never reads, and the page looks
 * empty offline.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`GET ${path} failed (${r.status})`);
  return (await r.json()) as T;
}

export const armWatchQuery = <T,>() => ({
  queryKey: ["arm-watch"] as const,
  queryFn: () => getJson<T>("/api/arm-watch"),
});

export const battingStatsQuery = <T,>() => ({
  queryKey: ["batting-stats"] as const,
  queryFn: () => getJson<T>("/api/batting"),
});

export const pitchingStatsQuery = <T,>() => ({
  queryKey: ["pitching-stats"] as const,
  queryFn: async (): Promise<T[]> => {
    const data = await getJson<unknown>("/api/pitching");
    return Array.isArray(data) ? (data as T[]) : [];
  },
});

export const historicalFieldingQuery = <T,>() => ({
  queryKey: ["history-fielding"] as const,
  queryFn: () => getJson<T[]>("/api/history/fielding"),
});
