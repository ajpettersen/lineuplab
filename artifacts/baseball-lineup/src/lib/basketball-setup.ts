import type { BasketballPlayer, BasketballRole, BasketballSettings, GuardPosition, RotationInput } from "@/lib/basketball-rotation";

// The team's Bench Sheet setup (GET /api/basketball-rotation), shared by the
// Bench Sheet page and the basketball court display.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const BASKETBALL_SETUP_KEY = ["basketball-rotation"] as const;

export interface SetupTags { role: BasketballRole; big: boolean; position: GuardPosition | null }
export interface SetupPlayer extends SetupTags { id: number; name: string; number: number | null; tagged: boolean }
export interface SetupGameDay { absentIds: number[]; guardOrder: number[]; frontOrder: number[] }
export interface BasketballSetup {
  settings: BasketballSettings;
  players: SetupPlayer[];
  gameDay: SetupGameDay;
  /** Subs at a time for new game lineups; null = ask each time. */
  defaultSubSize: number | null;
  saved: boolean;
}

/** A game's own lineup (game page → Set Lineup). */
export interface GameLineup { absentIds: number[]; guardOrder: number[]; frontOrder: number[]; subSize: number }

export const gameLineupKey = (gameId: number) => ["basketball-game-lineup", gameId] as const;

export async function fetchGameLineup(gameId: number): Promise<GameLineup | null> {
  const r = await fetch(`${BASE}/api/basketball-games/${gameId}/lineup`);
  if (!r.ok) throw new Error(`GET /api/basketball-games/${gameId}/lineup failed (${r.status})`);
  return ((await r.json()) as { lineup: GameLineup | null }).lineup;
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
    settings: { ...setup.settings, subSize: lineup?.subSize ?? setup.defaultSubSize ?? 2 },
    guardOrder: day.guardOrder.map(String),
    frontOrder: day.frontOrder.map(String),
    absentIds: day.absentIds.map(String),
  };
}

export async function fetchBasketballSetup(): Promise<BasketballSetup> {
  const r = await fetch(`${BASE}/api/basketball-rotation`);
  if (!r.ok) throw new Error(`GET /api/basketball-rotation failed (${r.status})`);
  return (await r.json()) as BasketballSetup;
}

/** Setup players as the rotation sees them (string ids). */
export function rotationPlayers(setup: BasketballSetup): BasketballPlayer[] {
  return setup.players.map((p) => ({ id: String(p.id), name: p.name, role: p.role, big: p.big, position: p.position }));
}
