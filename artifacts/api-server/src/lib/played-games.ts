/**
 * Which games count toward season playing time (Rotation Report, player
 * stats, the assistant's rotation answers).
 *
 * A game counts once it's been played: either the coach marked it
 * completed, or its start time has passed and it wasn't cancelled.
 * Coaches often skip "Record result" (no score to enter), and the old
 * completed-only rule silently left those games out of the report.
 * Draft lineups on future games still don't count. A past game with no
 * lineup has no entries, so it adds nothing either way.
 */
export function isPlayedGame(
  g: { type: string | null; status: string; gameDate: Date },
  now: Date = new Date(),
): boolean {
  if (g.type !== "game") return false;
  if (g.status === "completed") return true;
  return g.status !== "cancelled" && g.gameDate.getTime() <= now.getTime();
}
