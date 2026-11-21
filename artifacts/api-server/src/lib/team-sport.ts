import { eq } from "drizzle-orm";
import { db, teamSettingsTable } from "@workspace/db";
import { getSportProfile, type SportId } from "@workspace/sport-profiles";

/** The team's sport (baseball unless the team picked basketball). */
export async function teamSport(userId: string): Promise<SportId> {
  const [row] = await db
    .select({ sport: teamSettingsTable.sport })
    .from(teamSettingsTable)
    .where(eq(teamSettingsTable.userId, userId));
  return getSportProfile(row?.sport).id;
}

/**
 * Extra context for the AI prompts on a basketball team. The app started as
 * baseball-only, so the base prompts describe baseball; this tells the model
 * how basketball teams use it instead.
 */
export const BASKETBALL_PROMPT_NOTE = `
THIS TEAM PLAYS BASKETBALL. Ignore everything above that only applies to baseball/softball (innings, batting order, pitching, pitch counts, box-score import, field positions, tournaments, the lineup builder and position locks). For basketball:
- Positions are PG (1), SG (2), SF (3), PF (4), C (5). The roster stores each player's positions as preferred positions.
- Bench Sheet (/bench-sheet, Team menu): each player's role (Guard = only plays the 1/2, Front = flexes across 3/4/5, optional Big tag for 4s/5s, optional "plays the 1/2" tag), game settings (half length, shift length, guard and front spots, flex shifts at the end), who's here, and the starting order (reshuffle or drag). It builds the rotation: two queues; each sub is one guard and one front player (whoever has been on longest comes out, whoever has sat longest goes in), continuing through halftime. It prints as a one-page bench sheet.
- Court display (a game's Field Display, /games/<id>/display): half court with the five at the 1–5 spots, a running game clock, sub alerts, playing time from the clock, and on-the-fly changes (sub now / jump ahead, undo, skip, swap two players, take a player out or put them back, set the clock).
- Each game page (/games/<id>) links to both and shows the starters and minutes recorded on the court display, plus the final score.
- Rotation Report (/stats) shows each player's games, starts, minutes and minutes per game.
- Depth Chart (Team → Depth Chart) ranks players at PG/SG/SF/PF/C.`;
