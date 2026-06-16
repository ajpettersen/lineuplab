import "./_group.css";

/* App-load transition: a branded baseball splash. Red seams "stitch"
   continuously, a soft gold halo breathes behind the ball, the wordmark
   sits below a gold rule, and an indeterminate gold bar tracks progress. */
export function LoadSeam() {
  return (
    <div
      className="bl-root min-h-screen flex flex-col items-center justify-center gap-10"
      style={{
        background:
          "radial-gradient(110% 90% at 50% 32%, #14336c 0%, #0a2552 52%, #061a3d 100%)",
      }}
    >
      <div className="relative flex items-center justify-center" style={{ width: 200, height: 200 }}>
        {/* breathing halo */}
        <div
          className="absolute rounded-full"
          style={{
            width: 200,
            height: 200,
            background:
              "radial-gradient(circle, rgba(245,179,36,0.35), transparent 62%)",
            animation: "bl-glow 2.4s ease-in-out infinite",
          }}
        />
        <div className="bl-anim-pulse" style={{ animation: "bl-pulse 2.4s ease-in-out infinite" }}>
          <svg width="148" height="148" viewBox="0 0 148 148" aria-hidden>
            <circle cx="74" cy="74" r="62" fill="#ffffff" stroke="#d98c0b" strokeWidth="3" />
            <path
              d="M36 44 Q74 26 112 44"
              stroke="#d42a2a"
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="9 9"
              style={{ animation: "bl-stitch 3.2s linear infinite" }}
            />
            <path
              d="M36 104 Q74 122 112 104"
              stroke="#d42a2a"
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="9 9"
              style={{ animation: "bl-stitch 3.2s linear infinite" }}
            />
          </svg>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <div
          style={{
            width: 70,
            height: 3,
            borderRadius: 3,
            background: "linear-gradient(90deg, transparent, #f5b324, transparent)",
          }}
        />
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
      </div>

      {/* indeterminate progress track */}
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
  );
}
