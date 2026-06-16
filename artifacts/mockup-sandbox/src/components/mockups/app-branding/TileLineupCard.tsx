import "./_group.css";

/* Concept: the app icon AS the product — a fair batting order.
   Three lineup rows; the leadoff row is gold with baseball stitches. */
export function TileLineupCard() {
  const rows = [
    { n: "1", w: "86%", lead: true },
    { n: "2", w: "70%", lead: false },
    { n: "3", w: "78%", lead: false },
  ];
  return (
    <div className="bl-root bl-wall min-h-screen flex flex-col items-center justify-center gap-8 px-6">
      <div
        className="bl-tile"
        style={{
          width: 300,
          height: 300,
          background:
            "radial-gradient(120% 120% at 30% 18%, #16356f 0%, #0a2552 48%, #061a3d 100%)",
        }}
      >
        <div className="bl-sheen" />
        <div className="absolute inset-0 flex flex-col justify-center gap-[18px] px-[34px]">
          {rows.map((r) => (
            <div key={r.n} className="flex items-center gap-[14px]">
              <div
                className="bl-mono relative flex items-center justify-center shrink-0"
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  fontWeight: 700,
                  fontSize: 22,
                  color: r.lead ? "#0a2552" : "#dbe6ff",
                  background: r.lead
                    ? "linear-gradient(145deg, #ffd56b, #f5b324 55%, #d98c0b)"
                    : "rgba(255,255,255,0.08)",
                  border: r.lead
                    ? "none"
                    : "1px solid rgba(255,255,255,0.16)",
                  boxShadow: r.lead
                    ? "0 6px 14px -4px rgba(245,179,36,0.6)"
                    : "none",
                }}
              >
                {r.n}
                {r.lead && (
                  <svg
                    viewBox="0 0 46 46"
                    className="absolute inset-0"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M9 11 Q23 5 37 11"
                      stroke="#b51f1f"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      opacity="0.55"
                    />
                    <path
                      d="M9 35 Q23 41 37 35"
                      stroke="#b51f1f"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      opacity="0.55"
                    />
                  </svg>
                )}
              </div>
              <div
                style={{
                  height: 18,
                  width: r.w,
                  borderRadius: 9,
                  background: r.lead
                    ? "linear-gradient(90deg, rgba(255,213,107,0.9), rgba(245,179,36,0.35))"
                    : "rgba(255,255,255,0.13)",
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <Label />
    </div>
  );
}

function Label() {
  return (
    <div className="flex flex-col items-center gap-2">
      <span
        className="bl-display"
        style={{
          color: "#eef3ff",
          fontWeight: 500,
          fontSize: 19,
          letterSpacing: "0.02em",
        }}
      >
        Lineup Lab
      </span>
    </div>
  );
}
