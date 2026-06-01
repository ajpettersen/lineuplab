import "./_group.css";
import { Crown, Wand2, Users, Copy, Clock } from "lucide-react";

type Pos = "PG" | "SG" | "SF" | "PF" | "C";

const POS_STYLE: Record<Pos, string> = {
  PG: "bg-[hsl(220_85%_22%)] text-white",
  SG: "bg-[hsl(220_60%_38%)] text-white",
  SF: "bg-[hsl(168_60%_30%)] text-white",
  PF: "bg-[hsl(28_80%_42%)] text-white",
  C: "bg-[hsl(280_45%_38%)] text-white",
};

type Player = { num: number; name: string; pref: Pos };
const ROSTER: Player[] = [
  { num: 4, name: "Marcus Hill", pref: "PG" },
  { num: 7, name: "Aiden Cole", pref: "SG" },
  { num: 11, name: "Diego Vargas", pref: "SF" },
  { num: 23, name: "Jordan Lee", pref: "PF" },
  { num: 32, name: "Malik Stone", pref: "C" },
  { num: 5, name: "Nate Harper", pref: "PG" },
  { num: 9, name: "Eli Chambers", pref: "SG" },
  { num: 14, name: "Owen Tran", pref: "SF" },
  { num: 21, name: "Caleb Pierce", pref: "PF" },
  { num: 33, name: "Darius Webb", pref: "C" },
];

// 5 on the court per quarter, every player gets exactly 2 quarters (and sits 2).
const GRID: Record<string, (Pos | "BENCH")[]> = {
  "Marcus Hill": ["PG", "BENCH", "BENCH", "PG"],
  "Aiden Cole": ["SG", "BENCH", "SG", "BENCH"],
  "Diego Vargas": ["SF", "BENCH", "SF", "BENCH"],
  "Jordan Lee": ["PF", "BENCH", "BENCH", "PF"],
  "Malik Stone": ["C", "BENCH", "C", "BENCH"],
  "Nate Harper": ["BENCH", "PG", "PG", "BENCH"],
  "Eli Chambers": ["BENCH", "SG", "BENCH", "SG"],
  "Owen Tran": ["BENCH", "SF", "BENCH", "SF"],
  "Caleb Pierce": ["BENCH", "PF", "PF", "BENCH"],
  "Darius Webb": ["BENCH", "C", "BENCH", "C"],
};

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

function Chip({ value }: { value: Pos | "BENCH" }) {
  if (value === "BENCH") {
    return (
      <span className="inline-flex min-w-[3.25rem] justify-center rounded-full border border-dashed border-[hsl(220_18%_80%)] px-3 py-1 text-xs font-medium text-[hsl(220_12%_55%)]">
        Bench
      </span>
    );
  }
  return (
    <span
      className={`bball-display inline-flex min-w-[3.25rem] justify-center rounded-full px-3 py-1 text-sm font-semibold tracking-wide shadow-sm ${POS_STYLE[value]}`}
    >
      {value}
    </span>
  );
}

export function FairMinutesLineup() {
  return (
    <div className="bball min-h-screen bg-[hsl(220_30%_97%)] p-8 text-[hsl(220_25%_16%)]">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="rounded-t-2xl bg-[hsl(220_85%_22%)] px-7 py-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-[hsl(42_95%_70%)]">
                <Crown className="h-4 w-4" />
                <span className="bball-display text-xs font-semibold uppercase tracking-[0.18em]">
                  Tournament · Pool Play
                </span>
              </div>
              <h1 className="bball-display mt-1 text-3xl font-bold uppercase tracking-wide">
                Northside Hoops{" "}
                <span className="font-light text-white/70">vs.</span> Westfield Force
              </h1>
              <p className="mt-1 text-sm text-white/70">
                Sat, Jun 6 · 10:00 AM · Riverside Court 2
              </p>
            </div>
            <div className="text-right">
              <div className="bball-display text-xs uppercase tracking-widest text-white/60">
                Format
              </div>
              <div className="bball-mono mt-1 text-2xl font-semibold text-[hsl(42_95%_62%)]">
                4 × 8:00
              </div>
              <div className="text-xs text-white/60">quarters</div>
            </div>
          </div>

          {/* Tabs — note: no Batting Order / Pitch Counts for basketball */}
          <div className="mt-5 flex gap-1">
            {["Lineup", "Minutes by Position"].map((t, i) => (
              <span
                key={t}
                className={`bball-display rounded-t-lg px-4 py-2 text-sm font-medium uppercase tracking-wide ${
                  i === 0
                    ? "bg-[hsl(220_30%_97%)] text-[hsl(220_85%_22%)]"
                    : "text-white/70"
                }`}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Action row */}
        <div className="flex flex-wrap items-center gap-2 border-x border-[hsl(220_18%_88%)] bg-white px-7 py-3">
          <button className="bball-display inline-flex items-center gap-2 rounded-md bg-[hsl(220_85%_22%)] px-3.5 py-2 text-sm font-medium uppercase tracking-wide text-white">
            <Wand2 className="h-4 w-4" /> Generate Fair Minutes
          </button>
          <button className="inline-flex items-center gap-2 rounded-md border border-[hsl(220_18%_85%)] bg-white px-3.5 py-2 text-sm font-medium text-[hsl(220_25%_25%)]">
            <Users className="h-4 w-4" /> Edit Available
          </button>
          <button className="inline-flex items-center gap-2 rounded-md border border-[hsl(220_18%_85%)] bg-white px-3.5 py-2 text-sm font-medium text-[hsl(220_25%_25%)]">
            <Copy className="h-4 w-4" /> Copy to Sheets
          </button>
          <div className="ml-auto flex items-center gap-2 text-sm text-[hsl(220_12%_46%)]">
            <Clock className="h-4 w-4" />
            Fairness <span className="bball-mono font-semibold text-[hsl(168_60%_30%)]">94</span>
          </div>
        </div>

        {/* Rotation grid */}
        <div className="overflow-hidden border-x border-b border-[hsl(220_18%_88%)] bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[hsl(220_30%_95%)]">
                <th className="bball-display px-6 py-3 text-left text-xs font-semibold uppercase tracking-widest text-[hsl(220_12%_46%)]">
                  Player
                </th>
                {QUARTERS.map((q) => (
                  <th key={q} className="px-3 py-3 text-center">
                    <span className="bball-display inline-flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(220_85%_22%)] text-xs font-bold text-white">
                      {q}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROSTER.map((p, idx) => (
                <tr
                  key={p.name}
                  className={idx % 2 === 0 ? "bg-white" : "bg-[hsl(220_30%_98%)]"}
                >
                  <td className="px-6 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="bball-mono flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(220_85%_22%)]/10 text-xs font-bold text-[hsl(220_85%_22%)]">
                        {p.num}
                      </span>
                      <span className="font-medium">{p.name}</span>
                      <span className="bball-display text-[0.7rem] font-semibold uppercase tracking-wide text-[hsl(220_12%_60%)]">
                        {p.pref}
                      </span>
                    </div>
                  </td>
                  {GRID[p.name].map((cell, qi) => (
                    <td key={qi} className="px-3 py-2.5 text-center">
                      <Chip value={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 px-1 text-xs text-[hsl(220_12%_46%)]">
          Every player is rostered for exactly 2 of 4 quarters — the same fairness
          engine that balances innings in baseball now balances minutes on the court.
        </p>
      </div>
    </div>
  );
}
