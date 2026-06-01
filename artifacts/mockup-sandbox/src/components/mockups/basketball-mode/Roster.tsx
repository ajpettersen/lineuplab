import "./_group.css";
import { UserPlus, Sparkles, Search, Pencil } from "lucide-react";

type Pos = "PG" | "SG" | "SF" | "PF" | "C";

const POS_STYLE: Record<Pos, string> = {
  PG: "bg-[hsl(220_85%_22%)] text-white",
  SG: "bg-[hsl(220_60%_38%)] text-white",
  SF: "bg-[hsl(168_60%_30%)] text-white",
  PF: "bg-[hsl(28_80%_42%)] text-white",
  C: "bg-[hsl(280_45%_38%)] text-white",
};

type Player = { num: number; name: string; prefs: Pos[]; grade: string };
const ROSTER: Player[] = [
  { num: 4, name: "Marcus Hill", prefs: ["PG"], grade: "8th" },
  { num: 5, name: "Nate Harper", prefs: ["PG", "SG"], grade: "7th" },
  { num: 7, name: "Aiden Cole", prefs: ["SG"], grade: "8th" },
  { num: 9, name: "Eli Chambers", prefs: ["SG", "SF"], grade: "8th" },
  { num: 11, name: "Diego Vargas", prefs: ["SF"], grade: "7th" },
  { num: 14, name: "Owen Tran", prefs: ["SF", "PF"], grade: "8th" },
  { num: 21, name: "Caleb Pierce", prefs: ["PF"], grade: "7th" },
  { num: 23, name: "Jordan Lee", prefs: ["PF", "C"], grade: "8th" },
  { num: 32, name: "Malik Stone", prefs: ["C"], grade: "8th" },
  { num: 33, name: "Darius Webb", prefs: ["C"], grade: "7th" },
];

function PosPill({ p }: { p: Pos }) {
  return (
    <span
      className={`bball-display inline-flex min-w-[2.5rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${POS_STYLE[p]}`}
    >
      {p}
    </span>
  );
}

export function Roster() {
  return (
    <div className="bball min-h-screen bg-[hsl(220_30%_97%)] p-8 text-[hsl(220_25%_16%)]">
      <div className="mx-auto max-w-5xl">
        {/* Page header */}
        <div className="flex items-end justify-between">
          <div>
            <div className="bball-display text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(220_12%_55%)]">
              Northside Hoops
            </div>
            <h1 className="bball-display text-4xl font-bold uppercase tracking-wide text-[hsl(220_85%_22%)]">
              Roster
            </h1>
            <p className="mt-1 text-sm text-[hsl(220_12%_46%)]">
              10 players · Guards, Forwards &amp; Centers
            </p>
          </div>
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-2 rounded-md border border-[hsl(220_18%_85%)] bg-white px-3.5 py-2 text-sm font-medium text-[hsl(220_25%_25%)]">
              <Sparkles className="h-4 w-4 text-[hsl(42_85%_45%)]" /> AI Import
            </button>
            <button className="bball-display inline-flex items-center gap-2 rounded-md bg-[hsl(220_85%_22%)] px-3.5 py-2 text-sm font-medium uppercase tracking-wide text-white">
              <UserPlus className="h-4 w-4" /> Add Player
            </button>
          </div>
        </div>

        {/* Search + position filter */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-[hsl(220_18%_85%)] bg-white px-3 py-2 text-sm text-[hsl(220_12%_46%)]">
            <Search className="h-4 w-4" />
            <span>Search players…</span>
          </div>
          <div className="flex gap-1.5">
            {(["PG", "SG", "SF", "PF", "C"] as Pos[]).map((p) => (
              <button
                key={p}
                className="bball-display rounded-full border border-[hsl(220_18%_85%)] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[hsl(220_25%_30%)] hover:border-[hsl(220_85%_22%)]"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Roster table */}
        <div className="mt-5 overflow-hidden rounded-2xl border border-[hsl(220_18%_88%)] bg-white shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[hsl(220_30%_95%)]">
                <th className="bball-display px-6 py-3 text-left text-xs font-semibold uppercase tracking-widest text-[hsl(220_12%_46%)]">
                  #
                </th>
                <th className="bball-display px-2 py-3 text-left text-xs font-semibold uppercase tracking-widest text-[hsl(220_12%_46%)]">
                  Player
                </th>
                <th className="bball-display px-6 py-3 text-left text-xs font-semibold uppercase tracking-widest text-[hsl(220_12%_46%)]">
                  Preferred Positions
                </th>
                <th className="bball-display px-6 py-3 text-left text-xs font-semibold uppercase tracking-widest text-[hsl(220_12%_46%)]">
                  Grade
                </th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {ROSTER.map((p, idx) => (
                <tr
                  key={p.name}
                  className={idx % 2 === 0 ? "bg-white" : "bg-[hsl(220_30%_98%)]"}
                >
                  <td className="px-6 py-3">
                    <span className="bball-mono flex h-9 w-9 items-center justify-center rounded-md bg-[hsl(220_85%_22%)] text-sm font-bold text-white">
                      {p.num}
                    </span>
                  </td>
                  <td className="px-2 py-3 font-medium">{p.name}</td>
                  <td className="px-6 py-3">
                    <div className="flex gap-1.5">
                      {p.prefs.map((pos) => (
                        <PosPill key={pos} p={pos} />
                      ))}
                    </div>
                  </td>
                  <td className="bball-mono px-6 py-3 text-sm text-[hsl(220_12%_46%)]">
                    {p.grade}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Pencil className="ml-auto h-4 w-4 text-[hsl(220_12%_60%)]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 px-1 text-xs text-[hsl(220_12%_46%)]">
          Same roster tools as baseball — bulk AI import, search, preferred
          positions — just with basketball spots (PG / SG / SF / PF / C). No
          pitching fields.
        </p>
      </div>
    </div>
  );
}
