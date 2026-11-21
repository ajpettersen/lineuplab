import {
  formatClock,
  formatMinutes,
  type BasketballPlayer,
  type CourtSpot,
  type PositionGroup,
  type RotationResult,
  type RotationRow,
} from "@/lib/basketball-rotation";

const SPOTS: CourtSpot[] = [1, 2, 3, 4, 5];
/** "Vinnie V" never splits across lines. */
const keepTogether = (name: string) => name.replace(/ /g, "\u00a0");

export interface GameSheetProps {
  title: string;
  result: RotationResult;
  players: BasketballPlayer[];
  /** Each non-flex shift's spot → player id (players who stay keep their spot). */
  spotsByShift: Map<number, Map<CourtSpot, string>>;
  halfMinutes: number;
  shiftMinutes: number;
  subSize: number;
  absentNames: string[];
  /** Season minutes before this game, by player id (seconds), if any games are recorded. */
  seasonSeconds?: Map<string, number> | null;
  notes?: string | null;
}

/**
 * The printable game bench sheet (landscape, one page): per half, one row per
 * shift with who's at the 1–5, who comes in (and at what spot), who goes out
 * and who's on the bench. Just-subbed-in players are highlighted; a guard
 * playing up a spot (a 1 at the 2, or a guard at the 3) is underlined.
 */
export function GameSheetPrint({
  title,
  result,
  players,
  spotsByShift,
  halfMinutes,
  shiftMinutes,
  subSize,
  absentNames,
  seasonSeconds,
  notes,
}: GameSheetProps) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const groupOfSpot = (spot: CourtSpot): PositionGroup | undefined => result.groups.find((g) => g.spots.includes(spot));
  const rows = result.halves.flatMap((h) => h.rows);

  // "Playing up": a guard tagged 1 at the 2, or anyone in a spot above their own group's spots.
  const playingUp = (id: string, spot: CourtSpot) => {
    const p = byId.get(id);
    if (!p) return false;
    if (p.position === "1" && spot === 2) return true;
    const own = result.groups.find((g) => g.key === p.role);
    return !!own && !own.spots.includes(spot) && spot > Math.max(...own.spots);
  };

  const firstFlex = rows.find((r) => r.flex);
  const lastPlanned = [...rows].reverse().find((r) => !r.flex);
  const flexInfo = (() => {
    if (!firstFlex || !lastPlanned) return null;
    const lastTwo = rows.filter((r) => !r.flex).slice(-2);
    const satBoth = lastTwo.length === 2
      ? players.filter((p) => !lastTwo.some((r) => spotsOf(r).includes(p.id)) && result.minutes.some((m) => m.id === p.id))
      : [];
    const rest = result.minutes
      .filter((m) => !satBoth.some((p) => p.id === m.id))
      .sort((a, b) => a.minutes - b.minutes || a.name.localeCompare(b.name))
      .slice(0, Math.max(0, 5 - satBoth.length));
    return { satBoth: satBoth.map((p) => p.name).sort(), lowest: rest.map((m) => m.name) };
  })();
  function spotsOf(row: RotationRow): string[] {
    return [...(spotsByShift.get(row.shift)?.values() ?? [])];
  }

  const longestSit = Math.max(0, ...result.minutes.map((m) => m.longestSit));

  const Half = ({ half }: { half: 1 | 2 }) => {
    const halfRows = result.halves.find((h) => h.half === half)?.rows ?? [];
    return (
      <>
        <h3 className="game-sheet-half">{half === 1 ? "1st half" : "2nd half"}</h3>
        <table className="game-sheet-table">
          <thead>
            <tr>
              <th className="gs-clock">Clock</th>
              {SPOTS.map((s) => <th key={s} className="gs-spot">{s}</th>)}
              <th className="gs-in">In (position)</th>
              <th className="gs-out">Out</th>
              <th className="gs-bench">Bench</th>
            </tr>
          </thead>
          <tbody>
            {halfRows.map((row) => {
              if (row.flex) {
                return (
                  <tr key={row.shift} className="gs-flex">
                    <td className="gs-clock">FLEX</td>
                    {SPOTS.map((s) => <td key={s} />)}
                    <td className="gs-in" colSpan={3}><strong>{flexInfo?.satBoth.length ? `${flexInfo.satBoth.join(", ")} + your pick` : "Your pick"}</strong></td>
                  </tr>
                );
              }
              const spots = spotsByShift.get(row.shift) ?? new Map<CourtSpot, string>();
              const justIn = new Set(row.in);
              const inWithSpot = row.in
                .map((n) => {
                  const entry = [...spots.entries()].find(([, id]) => nameOf(id) === n);
                  return entry ? `${n} (${entry[0]})` : n;
                });
              return (
                <tr key={row.shift}>
                  <td className="gs-clock">{row.clock}</td>
                  {SPOTS.map((s) => {
                    const id = spots.get(s);
                    if (!id || !groupOfSpot(s)) return <td key={s} />;
                    const name = nameOf(id);
                    const isIn = justIn.has(name);
                    const up = playingUp(id, s);
                    return (
                      <td key={s} className={isIn ? "gs-justin" : undefined}>
                        <span className={up ? "gs-up" : undefined}>{name}</span>
                      </td>
                    );
                  })}
                  <td className="gs-in">{row.shift === 0 ? "Start" : inWithSpot.join(", ")}</td>
                  <td className="gs-out">{row.shift === 0 ? "—" : row.out.join(", ")}</td>
                  <td className="gs-bench">{row.bench.map(keepTogether).join(", ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    );
  };

  const season = seasonSeconds && seasonSeconds.size > 0
    ? [...seasonSeconds.entries()]
        .filter(([id]) => byId.has(id))
        .sort((a, b) => b[1] - a[1])
        .map(([id, sec]) => `${nameOf(id)} ${formatClock(sec / 60)}`)
    : null;

  return (
    <div className="game-sheet">
      <h2 className="game-sheet-title">{title}</h2>
      <p className="game-sheet-sub">
        {formatMinutes(halfMinutes)}-min running halves · {formatMinutes(shiftMinutes)}-min shifts (sub at the first dead ball after each mark) ·{" "}
        {subSize} in / {subSize} out every sub
        {absentNames.length > 0 && <> · {absentNames.join(", ")} out</>} · <span className="gs-key-justin">Highlighted</span> = just came in ·{" "}
        <span className="gs-up">Underlined</span> = guard playing up a spot (1 at the 2, or 2 at the 3)
      </p>

      <Half half={1} />
      <Half half={2} />

      <div className="game-sheet-foot">
        <p>
          <strong>Planned minutes{firstFlex ? " before flex" : ""}:</strong>{" "}
          {result.minutes.map((m) => `${m.name} ${formatMinutes(m.minutes)}`).join(" · ")}
        </p>
        {season && (
          <p>
            <strong>Season minutes before this game:</strong> {season.join(" · ")}
          </p>
        )}
        {flexInfo && (
          <p>
            <strong>Flex:</strong>{" "}
            {flexInfo.satBoth.length > 0
              ? `${flexInfo.satBoth.join(" and ")} ${flexInfo.satBoth.length === 1 ? "has" : "have"} sat the last ${formatClock(shiftMinutes * 2)}, so ${flexInfo.satBoth.length === 1 ? "they go" : "they go"} in. `
              : ""}
            Lowest for the other {Math.max(0, 5 - flexInfo.satBoth.length)} spots: {flexInfo.lowest.join(", ")}.
          </p>
        )}
        <p>
          <strong>Notes:</strong> {notes ? `${notes} ` : ""}
          {longestSit > 0 ? `Nobody sits more than ${formatClock(longestSit)} in a row${firstFlex ? " before the flex" : ""}.` : ""}
          {result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : ""}
        </p>
      </div>
    </div>
  );
}
