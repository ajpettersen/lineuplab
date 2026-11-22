import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface SeasonGame {
  gameId: number;
  date: string | null;
  opponent: string | null;
  /** Length as tracked (player-seconds ÷ 5). */
  gameSec: number;
}

export interface SeasonPlayer {
  playerId: number;
  name: string;
  number: number | null;
  games: number;
  starts: number;
  seconds: number;
  availableGames: number;
  availableSec: number;
  outGames: number;
  benchSec: number;
  /** Share of available minutes played (0–1). */
  pctAvailable: number | null;
  perGame: { gameId: number; seconds: number; started: boolean; available: boolean }[];
}

export interface BasketballSeason {
  gamesTracked: number;
  games: SeasonGame[];
  fairnessScore: number | null;
  players: SeasonPlayer[];
}

export const BASKETBALL_SEASON_KEY = ["basketball-season"] as const;

export async function fetchBasketballSeason(): Promise<BasketballSeason> {
  const r = await fetch(`${BASE}/api/basketball-season`);
  if (!r.ok) throw new Error(`GET /api/basketball-season failed (${r.status})`);
  return normalizeSeason((await r.json()) as Partial<BasketballSeason>);
}

/**
 * Fill in anything missing: the app keeps copies of fetched data on the
 * device, and one saved by an older version can come back in an older shape.
 */
export function normalizeSeason(raw: Partial<BasketballSeason> | null | undefined): BasketballSeason {
  const data = raw ?? {};
  return {
    gamesTracked: data.gamesTracked ?? 0,
    games: data.games ?? [],
    fairnessScore: data.fairnessScore ?? null,
    players: (data.players ?? []).map((p: Partial<SeasonPlayer>) => ({
      ...p,
      availableGames: p.availableGames ?? 0,
      availableSec: p.availableSec ?? 0,
      outGames: p.outGames ?? 0,
      benchSec: p.benchSec ?? 0,
      pctAvailable: p.pctAvailable ?? null,
      perGame: p.perGame ?? [],
    })) as SeasonPlayer[],
  };
}

/** Season playing time (basketball): one source for the Rotation Report, player cards and the dashboard. */
export function useBasketballSeason(enabled = true) {
  return useQuery({ queryKey: BASKETBALL_SEASON_KEY, queryFn: fetchBasketballSeason, enabled, select: normalizeSeason });
}

export const fmtMinutes = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
