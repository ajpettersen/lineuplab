import { formatClock, formatMinutes, type RotationResult, type RotationRow } from "@/lib/basketball-rotation";

import { Fragment } from "react";

/** Names joined with commas; a line can break between names but never inside one. */
function list(names: string[]) {
  if (names.length === 0) return "—";
  return names.map((name, i) => (
    <Fragment key={name}>
      {i > 0 && ", "}
      <span className="bench-name">{name}</span>
    </Fragment>
  ));
}

function HalfTable({ half, rows }: { half: 1 | 2; rows: RotationRow[] }) {
  return (
    <table className="bench-table">
      <caption>{half === 1 ? "1st half" : "2nd half"}</caption>
      <thead>
        <tr>
          <th className="bench-clock">Clock</th>
          {(rows[0]?.groups ?? []).map((g) => (
            <th key={g.key} className={g.key === "guard" ? "bench-col-guards" : "bench-col-front"}>{g.label}</th>
          ))}
          <th className="bench-col-bench">Bench</th>
          <th className="bench-col-sub">In</th>
          <th className="bench-col-sub">Out</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.shift} className={row.flex ? "bench-flex" : undefined}>
            <td className="bench-clock">{row.clock}</td>
            {row.flex ? (
              <td colSpan={row.groups.length + 3}><strong>FLEX</strong> / Coach's pick</td>
            ) : (
              <>
                {row.groups.map((g) => <td key={g.key}>{list(g.names)}</td>)}
                <td className="bench-muted">{list(row.bench)}</td>
                <td>{row.in.length ? list(row.in) : ""}</td>
                <td>{row.out.length ? list(row.out) : ""}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The one-page bench sheet. Styled by `.bench-sheet` rules in index.css so the
 * on-screen preview and the printout are the same thing.
 */
export function BenchSheetTable({ teamName, result, hasFlex }: { teamName: string; result: RotationResult; hasFlex: boolean }) {
  const shiftCount = result.halves.reduce((n, h) => n + h.rows.length, 0);
  // Shrink the type for long games or big rosters so it still fits one page.
  const density = shiftCount + result.minutes.length;
  // Checked by printing the 9-player, 16-shift test case to PDF: 11pt fits a
  // letter page with room to spare.
  const fontSize = density <= 26 ? 11 : density <= 32 ? 10 : density <= 40 ? 9 : 8;

  return (
    <div className="bench-sheet" style={{ ["--bench-font" as string]: `${fontSize}pt` }}>
      <header className="bench-header">
        <h2>{teamName || "Team"}</h2>
        <span>Bench sheet</span>
      </header>

      {result.warnings.length > 0 && (
        <ul className="bench-warnings">
          {result.warnings.map(w => <li key={w}>⚠ {w}</li>)}
        </ul>
      )}

      {result.halves.map(h => <HalfTable key={h.half} half={h.half} rows={h.rows} />)}

      {result.minutes.length > 0 && (
        <div className="bench-notes">
          <table className="bench-table">
            <caption>Minutes before flex</caption>
            <thead>
              <tr><th>Player</th><th>Role</th><th className="bench-num">Min</th></tr>
            </thead>
            <tbody>
              {result.minutes.map(m => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>
                    {m.role === "guard" ? "Guard" : m.big ? "Front (Big)" : "Front"}
                    {m.playingAs && <em> → {m.playingAs} today</em>}
                  </td>
                  <td className="bench-num">{formatMinutes(m.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div>
            <h3>Longest sit</h3>
            <ul className="bench-sits">
              {[...result.minutes].sort((a, b) => a.name.localeCompare(b.name)).map(m => (
                <li key={m.id}>
                  <strong>{m.name}</strong>{" "}
                  {m.longestSit > 0 ? `${formatClock(m.longestSit)} from ${m.longestSitFrom}` : "never sits"}
                </li>
              ))}
            </ul>
            {hasFlex && (
              <>
                <h3>Flex suggestion</h3>
                <p>{result.flexSuggestion.length ? result.flexSuggestion.join(", ") : "—"}</p>
                <p className="bench-muted bench-small">Fewest minutes, plus anyone who sat the 2 shifts before the flex.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
