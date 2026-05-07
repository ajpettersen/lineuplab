import { Shield, ChevronDown, LogOut, Wifi, Settings, UserCog } from "lucide-react";

const navy =
  "linear-gradient(135deg, hsl(220 85% 18%) 0%, hsl(220 85% 24%) 60%, hsl(220 85% 20%) 100%)";
const gold = "hsl(42 95% 55%)";

const NAV = [
  { label: "Dashboard", active: true },
  { label: "Roster" },
  { label: "Events", caret: true },
  { label: "Stats", caret: true },
  { label: "Practices" },
  { label: "Settings" },
  { label: "Admin" },
];

export function SmallBundle() {
  return (
    <div className="min-h-screen bg-[hsl(40_30%_97%)] font-['Roboto']">
      <header
        className="relative border-b shadow-md"
        style={{ background: navy, borderColor: "hsl(220 85% 14%)" }}
      >
        <div className="flex h-[72px] items-center gap-4 px-6">
          {/* (b) MERGED brand + team-switcher: shield + name now ONE clickable button.
              Caret signals it's a switcher. Eyebrow ("Lineup Lab") removed for density. */}
          <button className="group flex items-center gap-3 shrink-0 rounded-lg px-2 py-1 -ml-2 hover:bg-white/5 transition">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full shrink-0"
              style={{ background: gold, boxShadow: "0 0 0 2px rgba(0,0,0,0.18)" }}
            >
              <Shield className="h-5 w-5" style={{ color: "hsl(220 85% 22%)" }} />
            </div>
            <div className="flex items-center gap-1.5">
              <h1 className="font-['Oswald'] text-2xl font-bold uppercase tracking-wider text-white whitespace-nowrap leading-none">
                Plymouth Wayzata 10AA
              </h1>
              <ChevronDown className="h-4 w-4 text-white/60 group-hover:text-white" />
            </div>
          </button>

          {/* Nav + right cluster */}
          <div className="flex items-center gap-2 ml-auto">
            <nav className="flex items-center gap-0.5">
              {NAV.map((n) => (
                <a
                  key={n.label}
                  className={`relative whitespace-nowrap px-2.5 py-2 rounded-md font-['Oswald'] uppercase tracking-[0.1em] text-[13px] flex items-center gap-1 ${
                    n.active
                      ? "text-white bg-white/10"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  {n.label}
                  {n.caret && <ChevronDown className="h-3 w-3 opacity-70" />}
                  {/* (c) SINGLE GOLD ACCENT lives here — the active underline. */}
                  {n.active && (
                    <span
                      className="absolute -bottom-[7px] left-2.5 right-2.5 h-[3px] rounded-full"
                      style={{ background: gold, boxShadow: `0 0 8px ${gold}` }}
                    />
                  )}
                </a>
              ))}
            </nav>

            {/* Sync chip — kept, no gold */}
            <div className="shrink-0 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[11px] uppercase tracking-wide text-white/80">
              <Wifi className="h-3 w-3" />
              Synced
            </div>

            {/* (a) AVATAR DROPDOWN replaces identity text + sign-out button.
                Single tap target, opens menu with name/role/sign-out. */}
            <div className="relative shrink-0">
              <button
                className="flex h-9 w-9 items-center justify-center rounded-full font-['Oswald'] uppercase text-sm font-bold text-[hsl(220_85%_22%)] ring-2 ring-white/30 hover:ring-white/60 transition"
                style={{ background: gold }}
                aria-label="Account menu"
              >
                CP
              </button>
              {/* Floating preview of opened menu (visual hint) */}
              <div className="absolute right-0 top-12 w-56 rounded-lg border border-[hsl(220_15%_88%)] bg-white shadow-lg p-1 text-[hsl(220_15%_15%)] text-sm">
                <div className="px-3 py-2 border-b border-[hsl(220_15%_92%)]">
                  <div className="font-medium">Coach Pettersen</div>
                  <div className="text-[11px] uppercase tracking-wide text-[hsl(220_15%_50%)]">
                    Head Coach
                  </div>
                </div>
                <button className="w-full flex items-center gap-2 px-3 py-1.5 rounded hover:bg-[hsl(220_15%_96%)]">
                  <UserCog className="h-4 w-4" /> Profile
                </button>
                <button className="w-full flex items-center gap-2 px-3 py-1.5 rounded hover:bg-[hsl(220_15%_96%)]">
                  <Settings className="h-4 w-4" /> Settings
                </button>
                <div className="border-t border-[hsl(220_15%_92%)] my-1" />
                <button className="w-full flex items-center gap-2 px-3 py-1.5 rounded hover:bg-[hsl(220_15%_96%)] text-[hsl(0_70%_45%)]">
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
        {/* (c) NO bottom gold stripe — accent is reserved for active state only. */}
      </header>

      {/* Page hint */}
      <div className="px-6 py-6">
        <div className="font-['Oswald'] uppercase tracking-[0.18em] text-xs text-[hsl(220_15%_45%)]">
          Dashboard
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <div className="h-20 rounded-md border border-[hsl(220_15%_88%)] bg-white" />
          <div className="h-20 rounded-md border border-[hsl(220_15%_88%)] bg-white" />
          <div className="h-20 rounded-md border border-[hsl(220_15%_88%)] bg-white" />
        </div>
      </div>
    </div>
  );
}
