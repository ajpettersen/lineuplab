import "./_group.css";

/* App-load transition: a runner circles the bases. The infield diamond
   sits in gold linework while a baseball laps the basepaths continuously,
   wordmark centered, indeterminate progress below. */
export function LoadDiamond() {
  return (
    <div
      className="bl-root min-h-screen flex flex-col items-center justify-center gap-10"
      style={{
        background:
          "radial-gradient(110% 90% at 50% 34%, #14336c 0%, #0a2552 52%, #061a3d 100%)",
      }}
    >
      <div className="relative" style={{ width: 220, height: 220 }}>
        <svg viewBox="0 0 220 220" className="absolute inset-0" aria-hidden>
          <defs>
            <linearGradient id="ldgold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffe08a" />
              <stop offset="55%" stopColor="#f5b324" />
              <stop offset="100%" stopColor="#d98c0b" />
            </linearGradient>
          </defs>
          <path
            d="M110 34 L186 110 L110 186 L34 110 Z"
            fill="rgba(245,179,36,0.06)"
            stroke="url(#ldgold)"
            strokeWidth="4"
            strokeLinejoin="round"
            strokeDasharray="6 8"
            style={{ animation: "bl-stitch 6s linear infinite" }}
          />
          {[
            [186, 110],
            [110, 34],
            [34, 110],
          ].map(([x, y]) => (
            <rect
              key={`${x}-${y}`}
              x={x - 8}
              y={y - 8}
              width="16"
              height="16"
              rx="3"
              fill="url(#ldgold)"
              transform={`rotate(45 ${x} ${y})`}
            />
          ))}
          <path
            d="M101 178 L119 178 L119 186 L110 194 L101 186 Z"
            fill="#ffffff"
            stroke="#d98c0b"
            strokeWidth="1.5"
          />
        </svg>

        {/* base runner */}
        <div
          className="absolute"
          style={{
            transform: "translate(-50%,-50%)",
            animation: "bl-baserun 2.8s cubic-bezier(0.55,0,0.45,1) infinite",
          }}
        >
          <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
            <circle cx="17" cy="17" r="14" fill="#ffffff" stroke="#d98c0b" strokeWidth="2" />
            <path d="M8 11 Q17 7 26 11" stroke="#d42a2a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            <path d="M8 23 Q17 27 26 23" stroke="#d42a2a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <span
          className="bl-display"
          style={{
            color: "#f1f5ff",
            fontWeight: 600,
            fontSize: 30,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}
        >
          Lineup <span style={{ color: "#f5b324" }}>Lab</span>
        </span>
        <div
          className="relative overflow-hidden"
          style={{ width: 188, height: 4, borderRadius: 4, background: "rgba(255,255,255,0.10)" }}
        >
          <span
            className="absolute top-0 bottom-0"
            style={{
              width: "42%",
              borderRadius: 4,
              background: "linear-gradient(90deg, transparent, #ffd56b, #f5b324, transparent)",
              animation: "bl-indeterminate 1.5s ease-in-out infinite",
            }}
          />
        </div>
      </div>
    </div>
  );
}
