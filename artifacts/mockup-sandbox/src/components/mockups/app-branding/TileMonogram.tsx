import "./_group.css";

/* Concept: a bold broadcast monogram. Heavy Oswald "LL" in gold on navy,
   a baseball nested in the counter, a gold baseline rule. Reads clearly
   even at the smallest home-screen size. */
export function TileMonogram() {
  return (
    <div className="bl-root bl-wall min-h-screen flex flex-col items-center justify-center gap-8 px-6">
      <div
        className="bl-tile"
        style={{
          width: 300,
          height: 300,
          background:
            "radial-gradient(130% 120% at 28% 16%, #14336c 0%, #0a2552 50%, #05163a 100%)",
        }}
      >
        <div className="bl-sheen" />
        {/* faint stitch arc behind the mark */}
        <svg
          viewBox="0 0 300 300"
          className="absolute inset-0"
          fill="none"
          aria-hidden
        >
          <path
            d="M40 196 Q150 250 260 196"
            stroke="#d42a2a"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.28"
            strokeDasharray="2 11"
          />
        </svg>

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative flex items-end" style={{ gap: 0 }}>
            <span
              className="bl-display"
              style={{
                fontWeight: 700,
                fontSize: 168,
                lineHeight: 0.78,
                letterSpacing: "-0.06em",
                backgroundImage:
                  "linear-gradient(160deg, #ffe08a 0%, #f5b324 52%, #d98c0b 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                textShadow: "0 8px 20px rgba(0,0,0,0.35)",
              }}
            >
              LL
            </span>
            {/* baseball nested at the junction */}
            <span
              className="absolute"
              style={{ left: "50%", top: "26%", transform: "translate(-50%,-50%)" }}
            >
              <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden>
                <circle
                  cx="29"
                  cy="29"
                  r="26"
                  fill="#ffffff"
                  stroke="#d98c0b"
                  strokeWidth="2"
                />
                <path
                  d="M14 18 Q29 12 44 18"
                  stroke="#d42a2a"
                  strokeWidth="2.4"
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M14 40 Q29 46 44 40"
                  stroke="#d42a2a"
                  strokeWidth="2.4"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </div>
        </div>

        {/* gold baseline rule */}
        <div
          className="absolute"
          style={{
            left: "20%",
            right: "20%",
            bottom: "20%",
            height: 4,
            borderRadius: 4,
            background:
              "linear-gradient(90deg, transparent, #f5b324 20%, #ffd56b 50%, #f5b324 80%, transparent)",
          }}
        />
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
