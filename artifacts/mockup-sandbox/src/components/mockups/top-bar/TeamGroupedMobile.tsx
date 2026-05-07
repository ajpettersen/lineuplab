import { Shield, Menu, ChevronDown, LogOut, Home, Users, Settings as SettingsIcon, CalendarRange, BarChart2, ShieldCheck, CalendarDays, Trophy, Clipboard, Activity } from "lucide-react";

const navy =
  "linear-gradient(135deg, hsl(220 85% 18%) 0%, hsl(220 85% 24%) 60%, hsl(220 85% 20%) 100%)";
const gold = "hsl(42 95% 55%)";

const SECTIONS: Array<
  | { kind: "leaf"; icon: any; label: string; active?: boolean }
  | { kind: "group"; icon: any; label: string; children: { icon: any; label: string; active?: boolean }[] }
> = [
  { kind: "leaf", icon: Home, label: "Dashboard", active: true },
  { kind: "group", icon: Users, label: "Team", children: [
    { icon: Users, label: "Roster" },
    { icon: SettingsIcon, label: "Settings" },
  ]},
  { kind: "group", icon: CalendarRange, label: "Events", children: [
    { icon: CalendarDays, label: "Schedule" },
    { icon: Trophy, label: "Tournaments" },
    { icon: Clipboard, label: "Practices" },
  ]},
  { kind: "group", icon: BarChart2, label: "Statistics", children: [
    { icon: BarChart2, label: "Rotation Report" },
    { icon: Activity, label: "Season Stats" },
  ]},
  { kind: "leaf", icon: ShieldCheck, label: "Admin (master only)" },
];

export function TeamGroupedMobile() {
  return (
    <div className="min-h-screen bg-[hsl(40_30%_97%)] font-['Roboto']">
      {/* Mobile bar: hamburger + brand + team switcher pill */}
      <header className="relative border-b shadow-md" style={{ background: navy, borderColor: "hsl(220 85% 14%)" }}>
        <div className="flex h-[64px] items-center gap-3 px-3">
          <button className="shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-md bg-white text-[hsl(220_85%_22%)]">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 flex-1 justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: gold }}>
              <Shield className="h-4 w-4" style={{ color: "hsl(220 85% 22%)" }} />
            </div>
            <h1 className="font-['Oswald'] text-base font-bold uppercase tracking-wider text-white whitespace-nowrap">
              Plymouth Wayzata 10AA
            </h1>
          </div>
          <button className="shrink-0 inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-white">
            <span className="font-['Oswald'] uppercase tracking-wide">Lineup Lab</span>
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: gold }} />
      </header>

      {/* Open drawer rendered inline so reviewer sees both at once */}
      <div className="px-3 pt-2 pb-3 text-[11px] uppercase tracking-[0.16em] font-['Oswald'] text-[hsl(220_15%_45%)]">
        ↓ tap hamburger opens this drawer
      </div>
      <div className="mx-3 rounded-lg shadow-lg overflow-hidden" style={{ background: "hsl(220 85% 22%)" }}>
        <div className="flex items-center gap-2.5 px-4 py-3 border-b-2" style={{ borderColor: gold }}>
          <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: gold }}>
            <Shield className="h-4 w-4" style={{ color: "hsl(220 85% 22%)" }} />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-['Oswald'] text-[15px] font-bold uppercase tracking-wide text-white">
              Plymouth Wayzata 10AA
            </span>
            <span className="font-['Oswald'] text-[10px] uppercase tracking-[0.18em]" style={{ color: gold }}>
              Lineup Lab
            </span>
          </div>
        </div>
        <nav className="p-2 space-y-1">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            if (s.kind === "leaf") {
              return (
                <div
                  key={s.label}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-['Oswald'] uppercase tracking-[0.12em] ${
                    s.active ? "bg-white/10 text-white border-l-[3px]" : "text-white/70 border-l-[3px] border-transparent"
                  }`}
                  style={s.active ? { borderColor: gold } : {}}
                >
                  <Icon className="h-4 w-4" />
                  {s.label}
                </div>
              );
            }
            return (
              <div key={s.label} className="mt-1">
                <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-['Oswald'] uppercase tracking-[0.18em] text-white/45">
                  <Icon className="h-3.5 w-3.5" />
                  {s.label}
                </div>
                <div className="ml-2 border-l border-white/15 pl-2">
                  {s.children.map((c) => {
                    const C = c.icon;
                    return (
                      <div
                        key={c.label}
                        className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-['Oswald'] uppercase tracking-[0.12em] text-white/75 border-l-[3px] border-transparent"
                      >
                        <C className="h-4 w-4" />
                        {c.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="text-[11px] text-white/60 mb-2 truncate">
            coach@example.com · <span className="text-white/40">Head Coach</span>
          </div>
          <button className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-[12px] text-white">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
