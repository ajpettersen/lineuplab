import type { BasketballPlayer, BasketballRole, BasketballSettings, GuardPosition, RotationInput } from "@/lib/basketball-rotation";

// The team's Bench Sheet setup (GET /api/basketball-rotation), shared by the
// Bench Sheet page and the basketball court display.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const BASKETBALL_SETUP_KEY = ["basketball-rotation"] as const;

export interface SetupTags { role: BasketballRole; big: boolean; position: GuardPosition | null }
export interface SetupPlayer extends SetupTags { id: number; name: string; number: number | null; tagged: boolean }
/** The Bench Sheet's default game day: who's out and the starting order across all groups. */
export interface SetupGameDay { absentIds: number[]; order: number[] }
export interface BasketballSetup {
  settings: BasketballSettings;
  players: SetupPlayer[];
  gameDay: SetupGameDay;
  /** Subs at a time for new game lineups; null = ask each time. */
  defaultSubSize: number | null;
  saved: boolean;
}

/** A game's own lineup (game page → Set Lineup). */
export interface GameLineup {
  absentIds: number[];
  /** Starting order across all position groups. */
  order: number[];
  subSize: number;
  /** This game only; null = the team's Bench Sheet setting. */
  shiftMinutes?: number | null;
  /** Shifts at the end left to the coach (0 = none); null = the team's setting. */
  flexShifts?: number | null;
}

export const gameLineupKey = (gameId: number) => ["basketball-game-lineup", gameId] as const;

type Legacy = { order?: number[]; guardOrder?: number[]; frontOrder?: number[] };
const orderOf = (x: Legacy | null | undefined): number[] =>
  Array.isArray(x?.order) ? x!.order! : [...(x?.guardOrder ?? []), ...(x?.frontOrder ?? [])];

/**
 * The app keeps copies of fetched data on the device (offline support), so a
 * copy saved by an older version can come back in an older shape. These fill
 * in anything missing so the pages never crash on it; fresh data replaces it
 * as soon as the device is online.
 */
export function normalizeSetup(raw: BasketballSetup): BasketballSetup {
  const day = (raw?.gameDay ?? {}) as SetupGameDay & Legacy;
  return {
    ...raw,
    settings: { ...raw.settings, groupLayout: raw.settings?.groupLayout ?? "guards-front" },
    players: Array.isArray(raw.players) ? raw.players : [],
    gameDay: { absentIds: Array.isArray(day.absentIds) ? day.absentIds : [], order: orderOf(day) },
    defaultSubSize: raw.defaultSubSize === undefined ? 2 : raw.defaultSubSize,
  };
}

export function normalizeLineup(raw: GameLineup | null): GameLineup | null {
  if (!raw) return null;
  const legacy = raw as GameLineup & Legacy;
  return {
    ...raw,
    absentIds: Array.isArray(raw.absentIds) ? raw.absentIds : [],
    order: orderOf(legacy),
    subSize: typeof raw.subSize === "number" ? raw.subSize : 2,
  };
}

export async function fetchGameLineup(gameId: number): Promise<GameLineup | null> {
  const r = await fetch(`${BASE}/api/basketball-games/${gameId}/lineup`);
  if (!r.ok) throw new Error(`GET /api/basketball-games/${gameId}/lineup failed (${r.status})`);
  return normalizeLineup(((await r.json()) as { lineup: GameLineup | null }).lineup);
}

export async function saveGameLineup(gameId: number, lineup: GameLineup): Promise<void> {
  const r = await fetch(`${BASE}/api/basketball-games/${gameId}/lineup`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lineup),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Couldn't save the lineup (${r.status})`);
  }
}

/**
 * The rotation inputs for a game: the team's roles and game settings, plus
 * the game's own lineup if it has one, else the Bench Sheet's game day and
 * the default subs at a time (2 when the team asks each time).
 */
export function gameRotationInput(setup: BasketballSetup, lineup: GameLineup | null): RotationInput {
  const day = lineup ?? setup.gameDay;
  return {
    players: rotationPlayers(setup),
    settings: {
      ...setup.settings,
      subSize: lineup?.subSize ?? setup.defaultSubSize ?? 2,
      shiftMinutes: lineup?.shiftMinutes ?? setup.settings.shiftMinutes,
      flexShifts: lineup?.flexShifts ?? setup.settings.flexShifts,
    },
    order: day.order.map(String),
    absentIds: day.absentIds.map(String),
  };
}

export async function fetchBasketballSetup(): Promise<BasketballSetup> {
  const r = await fetch(`${BASE}/api/basketball-rotation`);
  if (!r.ok) throw new Error(`GET /api/basketball-rotation failed (${r.status})`);
  return normalizeSetup((await r.json()) as BasketballSetup);
}

/** Setup players as the rotation sees them (string ids). */
export function rotationPlayers(setup: BasketballSetup): BasketballPlayer[] {
  return setup.players.map((p) => ({ id: String(p.id), name: p.name, role: p.role, big: p.big, position: p.position }));
}
