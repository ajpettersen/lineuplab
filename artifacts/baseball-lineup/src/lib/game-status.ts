// Shared helpers for deriving an "effective" game status.
//
// The DB stores `status` as one of "upcoming" | "completed" | "cancelled",
// but a game can sit in "upcoming" forever after its date has passed (e.g. the
// coach forgot to enter the score). The UI shouldn't keep calling those games
// "Upcoming" — they should read as "Past" so coaches notice they need a result
// (or at least know the game already happened).
//
// We derive this client-side rather than mutating the DB so that:
//  - Coaches can still mark such games Complete (with score) at any time.
//  - There's no time-zone-sensitive cron job needed on the server.
//  - The badge always reflects "now" without a refresh from the API.

export type GameLike = { status: string; gameDate: string };

export type EffectiveStatus = "upcoming" | "past" | "completed" | "cancelled";

export function effectiveStatus(g: GameLike, now: Date = new Date()): EffectiveStatus {
  if (g.status === "completed") return "completed";
  if (g.status === "cancelled") return "cancelled";
  // Stored as "upcoming" — split into truly upcoming vs. past-but-unrecorded
  // by comparing the scheduled start to right now.
  const t = new Date(g.gameDate).getTime();
  if (Number.isFinite(t) && t < now.getTime()) return "past";
  return "upcoming";
}

export const isTrulyUpcoming = (g: GameLike, now: Date = new Date()): boolean =>
  effectiveStatus(g, now) === "upcoming";

export const isPastUnrecorded = (g: GameLike, now: Date = new Date()): boolean =>
  effectiveStatus(g, now) === "past";
