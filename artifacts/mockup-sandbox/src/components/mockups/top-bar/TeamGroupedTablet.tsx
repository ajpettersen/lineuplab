import { Shield, ChevronDown, LogOut, Wifi, ChevronRight } from "lucide-react";

const navy =
  "linear-gradient(135deg, hsl(220 85% 18%) 0%, hsl(220 85% 24%) 60%, hsl(220 85% 20%) 100%)";
const gold = "hsl(42 95% 55%)";

// Same nav, rendered with the right cluster overflowing — at 768px the
// horizontal scroller kicks in and the right chevron arrow appears
// (just like real layout.tsx behavior).
const NAV = ["Dashboard", "Team ▾", "Events ▾", "Statistics ▾", "Admin"];

export function TeamGroupedTablet() {
  return (
    <div className="min-h-screen bg-[hsl(40_30%_97%)] font-['Roboto']">
      <header
        className="relative border-b shadow-md"
        style={{ background: navy, borderColor: "hsl(220 85% 14%)" }}
      >
        <div className="flex h-[72px] items-center gap-3 px-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full shrink-0"
              style={{ background: gold, boxShadow: "0 0 0 2px rgba(0,0,0,0.18)" }}
            >
              <Shield className="h-4 w-4" style={{ color: "hsl(220 85% 22%)" }} />
            </div>
            <div className="flex flex-col leading-tight">
              <h1 className="font-['Oswald'] text-lg font-bold uppercase tracking-wider text-white whitespace-nowrap leading-none">
                Plymouth Wayzata 10AA
              </h1>
              <span className="font-['Oswald'] text-[10px] uppercase tracking-[0.18em] mt-0.5" style={{ color: gold }}>
                Lineup Lab
              </span>
            </div>
          </div>

          {/* Right cluster — overflow-hidden with right-edge chevron, mimicking the real auto-scroll affordance */}
          <div className="relative flex-1 min-w-0 ml-auto overflow-hidden">
            <div className="flex items-center gap-1.5 ml-auto justify-end whitespace-nowrap">
              <nav className="flex items-center gap-0.5">
                {NAV.map((label, i) => (
                  <button
                    key={label}
                    className={`relative whitespace-nowrap px-2 py-2 rounded-md font-['Oswald'] uppercase tracking-[0.1em] text-[12px] ${
                      i === 0 ? "text-white bg-white/10" : "text-white/70"
                    }`}
                  >
                    {label}
                    {i === 0 && (
                      <span className="absolute -bottom-[7px] left-2 right-2 h-[3px] rounded-full" style={{ background: gold, boxShadow: `0 0 8px ${gold}` }} />
                    )}
                  </button>
                ))}
              </nav>
              <div className="shrink-0 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-wide text-white/80">
                <Wifi className="h-3 w-3" /> Synced
              </div>
              <button className="shrink-0 inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/5 px-2 py-1.5 text-[12px] text-white">
                <span className="font-['Oswald'] uppercase tracking-wide">Lineup Lab</span>
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
              <div className="shrink-0 flex flex-col leading-tight">
                <span className="text-[12px] font-medium text-white truncate">Coach Pettersen</span>
                <span className="text-[10px] text-white/60 truncate uppercase tracking-wide">Head Coach</span>
              </div>
              <button className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/5 px-2 py-1.5 text-[12px] text-white">
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </button>
            </div>
            {/* Right chevron — appears on real overflow, scrolls cluster */}
            <button
              aria-label="Scroll right"
              className="absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center w-7 cursor-pointer text-white"
              style={{ background: "linear-gradient(to left, hsl(220 85% 18%), hsl(220 85% 18% / 0.85), transparent)" }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[3px]" style={{ background: gold }} />
      </header>

      <div className="px-4 py-5">
        <div className="font-['Oswald'] uppercase tracking-[0.18em] text-xs text-[hsl(220_15%_45%)]">
          Dashboard
        </div>
        <div className="mt-2 text-[12px] text-[hsl(220_15%_45%)] leading-relaxed">
          iPad portrait (768px) — sits exactly on the <code>md:</code> breakpoint, so it
          uses the desktop layout. With Team grouping the right cluster fits with no
          chevron arrow at all on most iPads; the arrow shown here is what appears
          on the rare cases content still overflows (auto-scrolls on hover). On
          iPad landscape (1024px+) it looks identical to the desktop mockup.
        </div>
      </div>
    </div>
  );
}
