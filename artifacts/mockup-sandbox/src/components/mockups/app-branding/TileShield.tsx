import "./_group.css";

/* Concept: a refined evolution of the CURRENT shield icon — flatter,
   bolder, brighter gold rim, bigger ball, crisp home plate. Lets the
   coach compare a polished version of today against the new directions. */
export function TileShield() {
  return (
    <div className="bl-root bl-wall min-h-screen flex flex-col items-center justify-center gap-8 px-6">
      <div
        className="bl-tile"
        style={{
          width: 300,
          height: 300,
          background:
            "radial-gradient(120% 120% at 50% 22%, #15356f 0%, #0a2552 50%, #051539 100%)",
        }}
      >
        <div className="bl-sheen" />
        <svg viewBox="0 0 120 120" className="absolute inset-0" aria-hidden>
          <defs>
            <linearGradient id="sgold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffe08a" />
              <stop offset="50%" stopColor="#f5b324" />
              <stop offset="100%" stopColor="#d98c0b" />
            </linearGradient>
            <linearGradient id="sbody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a3d7e" />
              <stop offset="100%" stopColor="#0a2552" />
            </linearGradient>
          </defs>

          {/* shield */}
          <path
            d="M60 14 L98 27 V58 C98 84 82 102 60 110 C38 102 22 84 22 58 V27 Z"
            fill="url(#sbody)"
            stroke="url(#sgold)"
            strokeWidth="5"
            strokeLinejoin="round"
          />

          {/* baseball */}
          <circle cx="60" cy="55" r="24" fill="#ffffff" stroke="#d98c0b" strokeWidth="2.5" />
          <path d="M42 43 Q60 35 78 43" stroke="#d42a2a" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <path d="M42 67 Q60 75 78 67" stroke="#d42a2a" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <g stroke="#d42a2a" strokeWidth="1.3" strokeLinecap="round">
            <line x1="47" y1="46" x2="45" y2="43.5" />
            <line x1="52" y1="42.5" x2="50.5" y2="40" />
            <line x1="57" y1="40.5" x2="56" y2="37.8" />
            <line x1="63" y1="40.5" x2="64" y2="37.8" />
            <line x1="68" y1="42.5" x2="69.5" y2="40" />
            <line x1="73" y1="46" x2="75" y2="43.5" />
            <line x1="47" y1="64" x2="45" y2="66.5" />
            <line x1="52" y1="67.5" x2="50.5" y2="70" />
            <line x1="57" y1="69.5" x2="56" y2="72.2" />
            <line x1="63" y1="69.5" x2="64" y2="72.2" />
            <line x1="68" y1="67.5" x2="69.5" y2="70" />
            <line x1="73" y1="64" x2="75" y2="66.5" />
          </g>

          {/* home plate */}
          <path
            d="M52 88 L68 88 L68 95 L60 101 L52 95 Z"
            fill="url(#sgold)"
            stroke="#06122c"
            strokeWidth="1"
          />
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
