import { Shield, ChevronDown, LogOut, Wifi, Users, Settings as SettingsIcon, ShieldCheck, CalendarDays, Trophy, Clipboard, BarChart2, Activity } from "lucide-react";

const navy =
  "linear-gradient(135deg, hsl(220 85% 18%) 0%, hsl(220 85% 24%) 60%, hsl(220 85% 20%) 100%)";
const gold = "hsl(42 95% 55%)";

const NAV: Array<{ label: string; active?: boolean; openMenu?: { icon: any; label: string; active?: boolean }[] }> = [
  { label: "Dashboard", active: true },
  {
    label: "Team",
    openMenu: [
      { icon: Users, label: "Roster" },
      { icon: SettingsIcon, label: "Settings" },
    ],
  },
  {
    label: "Events",
    openMenu: [
      { icon: CalendarDays, label: "Schedule" },
      { icon: Trophy, label: "Tournaments" },
      { icon: Clipboard, label: "Practices" },
    ],
  },
  {
    label: "Statistics",
    openMenu: [
      { icon: BarChart2, label: "Rotation Report" },
      { icon: Activity, label: "Season Stats" },
    ],
  },
  { label: "Admin" },
];

export function TeamGroupedDesktop() {
  return (
    <div className="min-h-screen bg-[hsl(40_30%_97%)] font-['Roboto']">
      <header
        className="relative border-b shadow-md"
        style={{ background: navy, borderColor: "hsl(220 85% 14%)" }}
      >
        <div className="flex h-[72px] items-center gap-4 px-6">
          <div className="flex items-center gap-3 shrink-0">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full shrink-0"
              style={{ background: gold, boxShadow: "0 0 0 2px rgba(0,0,0,0.18)" }}
            >
              <Shield className="h-5 w-5" style={{ color: "hsl(220 85% 22%)" }} />
            </div>
            <div className="flex flex-col leading-tight">
              <h1 className="font-['Oswald'] text-2xl font-bold uppercase tracking-wider text-white whitespace-nowrap leading-none">
                Plymouth Wayzata 10AA
              </h1>
              <span className="font-['Oswald'] text-[11px] uppercase tracking-[0.18em] mt-0.5" style={{ color: gold }}>
                Lineup Lab
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <nav className="flex items-center gap-0.5">
              {NAV.map((n) => {
                const isAdmin = n.label === "Admin";
                const isTeam = n.label === "Team";
                return (
                  <div key={n.label} className="relative">
                    <button
                      className={`relative whitespace-nowrap px-2.5 py-2 rounded-md font-['Oswald'] uppercase tracking-[0.1em] text-[13px] flex items-center gap-1 ${
                        n.active ? "text-white bg-white/10" :
                        isAdmin ? "text-white/70" :
                        isTeam ? "text-white bg-white/10" : "text-white/70"
                      }`}
                    >
                      {isAdmin && <ShieldCheck className="h-3.5 w-3.5 opacity-80" />}
                      {n.label}
                      {n.openMenu && <ChevronDown className="h-3 w-3 opacity-70" />}
                      {n.active && (
                        <span className="absolute -bottom-[7px] left-2.5 right-2.5 h-[3px] rounded-full" style={{ background: gold, boxShadow: `0 0 8px ${gold}` }} />
                      )}
                    </button>
                    {/* Render the open menu inline as a floating preview so reviewer sees the contents */}
                    {n.openMenu && isTeam && (
                      <div className="absolute left-0 top-full mt-1 z-10 w-[180px] rounded-md border border-[hsl(220_15%_88%)] bg-white shadow-lg p-1">
                        {n.openMenu.map((m) => {
                          const Ic = m.icon;
                          return (
                            <div key={m.label} className="flex items-center gap-2 px-2 py-1.5 rounded text-[13px] font-['Oswald'] uppercase tracking-[0.1em] text-[hsl(220_15%_15%)] hover:bg-[hsl(220_15%_96%)]">
                              <Ic className="h-4 w-4" /> {m.label}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>

            <div className="shrink-0 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[11px] uppercase tracking-wide text-white/80">
              <Wifi className="h-3 w-3" />
              Synced
            </div>

            <button className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/5 px-2.5 py-1.5 text-[13px] text-white">
              <span className="font-['Oswald'] uppercase tracking-wide">Lineup Lab</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>

            <div className="shrink-0 flex flex-col leading-tight max-w-[180px]">
              <span className="text-sm font-medium text-white truncate">Coach Pettersen</span>
              <span className="text-[11px] text-white/60 truncate uppercase tracking-wide">Head Coach</span>
            </div>

            <button className="shrink-0 inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-[13px] text-white">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[3px]" style={{ background: gold }} />
      </header>

      <div className="px-6 py-6">
        <div className="font-['Oswald'] uppercase tracking-[0.18em] text-xs text-[hsl(220_15%_45%)]">
          Dashboard
        </div>
        <div className="mt-3 text-[13px] text-[hsl(220_15%_45%)] max-w-2xl leading-relaxed">
          Top-level items dropped from <b>6 → 4</b> (plus Admin for master-admins).
          The Team menu is shown open here so you can see what it contains;
          on real hover it appears after ~0ms and closes 140ms after your cursor leaves.
        </div>
      </div>
    </div>
  );
}
