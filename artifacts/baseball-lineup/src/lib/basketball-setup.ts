import type { BasketballPlayer, BasketballRole, BasketballSettings, GuardPosition } from "@/lib/basketball-rotation";

// The team's Bench Sheet setup (GET /api/basketball-rotation), shared by the
// Bench Sheet page and the basketball court display.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const BASKETBALL_SETUP_KEY = ["basketball-rotation"] as const;

export interface SetupTags { role: BasketballRole; big: boolean; position: GuardPosition | null }
export interface SetupPlayer extends SetupTags { id: number; name: string; number: number | null; tagged: boolean }
export interface SetupGameDay { absentIds: number[]; guardOrder: number[]; frontOrder: number[] }
export interface BasketballSetup { settings: BasketballSettings; players: SetupPlayer[]; gameDay: SetupGameDay; saved: boolean }

export async function fetchBasketballSetup(): Promise<BasketballSetup> {
  const r = await fetch(`${BASE}/api/basketball-rotation`);
  if (!r.ok) throw new Error(`GET /api/basketball-rotation failed (${r.status})`);
  return (await r.json()) as BasketballSetup;
}

/** Setup players as the rotation sees them (string ids). */
export function rotationPlayers(setup: BasketballSetup): BasketballPlayer[] {
  return setup.players.map((p) => ({ id: String(p.id), name: p.name, role: p.role, big: p.big, position: p.position }));
}
