const PLAYERS = [
  { pos: "CF", name: "Mav L.", x: 50, y: 19 },
  { pos: "LF", name: "Sebastian L.", x: 22, y: 30 },
  { pos: "RF", name: "Arthur T.", x: 78, y: 30 },
  { pos: "SS", name: "Jett Klos G.", x: 36, y: 46 },
  { pos: "2B", name: "Holden P.", x: 62, y: 46 },
  { pos: "3B", name: "Charlie C.", x: 22, y: 58 },
  { pos: "1B", name: "Henry B.", x: 78, y: 58 },
  { pos: "P", name: "Walter S.", x: 50, y: 53 },
  { pos: "C", name: "Evan C.", x: 50, y: 78 },
];
const BENCH = ["Brayden C.", "Dan D."];

/**
 * Variant C — Position medallion + name plate.
 * A round gold medallion holds the position number. The player's name sits
 * directly underneath in a subtle navy plate with a soft drop shadow. This
 * is the most "broadcast graphic" look — the position is clearly the
 * primary identifier (matches a coach scanning the field by where the
 * roles are) and the name is secondary detail.
 */
export function Medallion() {
  return (
    <div className="min-h-screen bg-[#0b1a35] flex items-center justify-center p-4 font-['Oswald']">
      <div className="w-full max-w-[420px] flex flex-col gap-2">
        <div
          className="relative w-full aspect-[3/4] rounded-xl overflow-hidden border-2 border-[#f5b800]"
          style={{
            background:
              "radial-gradient(ellipse at 50% 65%, #1a5c1a 0%, #134612 55%, #0b2e0b 100%)",
          }}
        >
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon points="50,82 22,55 50,28 78,55" fill="#7b4a1f" stroke="#fff" strokeWidth="0.4" />
            <polygon points="50,76 32,57 50,38 68,57" fill="#1a5c1a" stroke="none" />
            <line x1="22" y1="55" x2="2" y2="35" stroke="#fff" strokeWidth="0.3" opacity="0.6" />
            <line x1="78" y1="55" x2="98" y2="35" stroke="#fff" strokeWidth="0.3" opacity="0.6" />
            <circle cx="50" cy="55" r="3" fill="#7b4a1f" />
          </svg>

          {PLAYERS.map((p) => (
            <div
              key={p.pos}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              <div
                className="w-7 h-7 rounded-full bg-gradient-to-b from-[#fcc830] to-[#dd9c00] text-[#0b1a35] text-[11px] font-bold flex items-center justify-center shadow-[0_2px_6px_rgba(0,0,0,0.45)] ring-1 ring-[#0b1a35]/40 font-['Roboto_Mono']"
              >
                {p.pos}
              </div>
              <div className="bg-[#0b1a35]/90 text-white text-[10.5px] font-semibold px-2 py-0.5 rounded-sm whitespace-nowrap shadow-md">
                {p.name}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-white/10 bg-[#0b1a35]/80 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] tracking-[0.15em] text-white/50 font-bold">BENCH</span>
            <div className="flex gap-2">
              {BENCH.map((n) => (
                <span
                  key={n}
                  className="inline-flex items-center gap-1.5 text-[11px] text-white"
                >
                  <span className="w-4 h-4 rounded-full bg-white/15" />
                  {n}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
