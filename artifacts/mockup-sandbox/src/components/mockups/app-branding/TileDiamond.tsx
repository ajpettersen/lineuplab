import "./_group.css";

/* Concept: a clean overhead infield diamond — gold linework on navy,
   white home plate, gold bases, a ball at the mound. Geometric, modern,
   instantly "baseball" without a shield. */
export function TileDiamond() {
  return (
    <div className="bl-root bl-wall min-h-screen flex flex-col items-center justify-center gap-8 px-6">
      <div
        className="bl-tile"
        style={{
          width: 300,
          height: 300,
          background:
            "radial-gradient(120% 120% at 50% 30%, #173672 0%, #0a2552 52%, #061a3d 100%)",
        }}
      >
        <div className="bl-sheen" />
        <svg viewBox="0 0 300 300" className="absolute inset-0" aria-hidden>
          <defs>
            <linearGradient id="dgold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffe08a" />
              <stop offset="55%" stopColor="#f5b324" />
              <stop offset="100%" stopColor="#d98c0b" />
            </linearGradient>
          </defs>

          {/* outfield arc */}
          <path
            d="M62 188 A120 120 0 0 1 238 188"
            stroke="url(#dgold)"
            strokeWidth="3"
            fill="none"
            opacity="0.35"
            strokeLinecap="round"
          />

          {/* basepaths / diamond */}
          <path
            d="M150 70 L232 152 L150 234 L68 152 Z"
            fill="rgba(245,179,36,0.08)"
            stroke="url(#dgold)"
            strokeWidth="5"
            strokeLinejoin="round"
          />

          {/* bases */}
          {[
            [232, 152],
            [150, 70],
            [68, 152],
          ].map(([x, y]) => (
            <rect
              key={`${x}-${y}`}
              x={x - 9}
              y={y - 9}
              width="18"
              height="18"
              rx="3"
              fill="url(#dgold)"
              transform={`rotate(45 ${x} ${y})`}
            />
          ))}

          {/* home plate */}
          <path
            d="M139 226 L161 226 L161 236 L150 246 L139 236 Z"
            fill="#ffffff"
            stroke="#d98c0b"
            strokeWidth="2"
          />

          {/* pitcher's mound ball */}
          <g>
            <circle cx="150" cy="152" r="20" fill="#ffffff" stroke="#d98c0b" strokeWidth="2" />
            <path d="M139 144 Q150 139 161 144" stroke="#d42a2a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
            <path d="M139 160 Q150 165 161 160" stroke="#d42a2a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </g>
        </svg>
      </div>
      <span
        className="bl-display"
        style={{ color: "#eef3ff", fontWeight: 500, fontSize: 19, letterSpacing: "0.02em" }}
      >
        Lineup Lab
      </span>
    </div>
  );
}
