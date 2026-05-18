import { tournamentDateAsLocal } from "./tournament-date";

/**
 * Tournament status + record helpers shared by the tournaments listing
 * card and the tournament-detail status hero.
 *
 * Status is computed from the tournament's date range relative to
 * "today" (local). We never trust the server for this — the coach's
 * device clock is what matters for "is the tournament live right now?"
 * since the answer drives at-a-glance UI like a pulsing dot.
 *
 * Record is derived from the linked games' (ourScore, opponentScore)
 * pairs — same source of truth as the dashboard W-L-T pill, so the two
 * stay consistent even though the tournament page doesn't go through
 * the dashboard's aggregator.
 */

export type TournamentStatusKind = "upcoming" | "live" | "completed";

export interface TournamentStatus {
  kind: TournamentStatusKind;
  /** Short label suitable for a pill badge (e.g. "DAY 2 OF 3"). */
  label: string;
  /** Long-form sentence for tooltips / aria-label ("Day 2 of 3 — ends Sun May 18"). */
  detail: string;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayDiff(a: Date, b: Date): number {
  // Both args assumed to be start-of-day; Math.round shields against
  // DST-transition millisecond drift.
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export function computeTournamentStatus(
  startISO: string,
  endISO: string,
  now: Date = new Date(),
): TournamentStatus {
  const start = startOfLocalDay(tournamentDateAsLocal(startISO));
  const end = startOfLocalDay(tournamentDateAsLocal(endISO));
  const today = startOfLocalDay(now);
  const totalDays = Math.max(1, dayDiff(end, start) + 1);

  if (today < start) {
    const days = dayDiff(start, today);
    return {
      kind: "upcoming",
      label: days === 1 ? "TOMORROW" : days === 0 ? "TODAY" : `IN ${days} DAYS`,
      detail: `Starts ${start.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`,
    };
  }
  if (today > end) {
    return { kind: "completed", label: "COMPLETED", detail: "Tournament complete" };
  }
  const dayNum = dayDiff(today, start) + 1;
  return {
    kind: "live",
    label: totalDays === 1 ? "TODAY" : `DAY ${dayNum} OF ${totalDays}`,
    detail: `Day ${dayNum} of ${totalDays} · ends ${end.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`,
  };
}

export interface TournamentRecord {
  wins: number;
  losses: number;
  ties: number;
  played: number;
  total: number;
}

interface GameLike {
  status: string;
  ourScore?: number | null;
  opponentScore?: number | null;
}

export function computeTournamentRecord(games: GameLike[]): TournamentRecord {
  const rec: TournamentRecord = {
    wins: 0,
    losses: 0,
    ties: 0,
    played: 0,
    total: games.length,
  };
  for (const g of games) {
    if (g.status !== "completed") continue;
    const us = g.ourScore;
    const them = g.opponentScore;
    if (us == null || them == null) continue;
    rec.played += 1;
    if (us > them) rec.wins += 1;
    else if (us < them) rec.losses += 1;
    else rec.ties += 1;
  }
  return rec;
}

/** "3-1" / "3-1-1" — drops trailing zeros for cleanest at-a-glance read. */
export function formatRecord(r: TournamentRecord): string {
  if (r.played === 0) return "—";
  return r.ties > 0
    ? `${r.wins}-${r.losses}-${r.ties}`
    : `${r.wins}-${r.losses}`;
}
