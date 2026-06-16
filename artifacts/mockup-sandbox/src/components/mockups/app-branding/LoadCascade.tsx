import "./_group.css";

/* App-load transition: the lineup builds itself. Batting-order rows
   cascade in and out on a loop — the loading state mirrors the app's core
   job (assembling a fair order) instead of a generic spinner. */
export function LoadCascade() {
  const rows = [
    { n: "1", w: 150 },
    { n: "2", w: 124 },
    { n: "3", w: 138 },
    { n: "4", w: 110 },
    { n: "5", w: 132 },
  ];
  return (
    <div
      className="bl-root min-h-screen flex flex-col items-center justify-center gap-9 px-8"
      style={{
        background:
          "radial-gradient(120% 80% at 50% 0%, #15356f 0%, #0a2552 55%, #061a3d 100%)",
      }}
    >
      <div className="flex flex-col items-center gap-2">
        <span
          className="bl-display"
          style={{
            color: "#f1f5ff",
            fontWeight: 600,
            fontSize: 22,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          Lineup <span style={{ color: "#f5b324" }}>Lab</span>
        </span>
        <span
          className="bl-mono"
          style={{ color: "rgba(220,230,255,0.5)", fontSize: 11, letterSpacing: "0.16em" }}
        >
          BUILDING YOUR LINEUP
        </span>
      </div>

      <div className="flex flex-col gap-[14px]" style={{ width: 220 }}>
        {rows.map((r, i) => (
          <div
            key={r.n}
            className="flex items-center gap-3"
            style={{
              animation: `bl-rowcycle 2.6s ease-in-out ${i * 0.16}s infinite`,
            }}
          >
            <div
              className="bl-mono flex items-center justify-center shrink-0"
              style={{
                width: 38,
                height: 38,
                borderRadius: 11,
                fontWeight: 700,
                fontSize: 17,
                color: i === 0 ? "#0a2552" : "#dbe6ff",
                background:
                  i === 0
                    ? "linear-gradient(145deg, #ffd56b, #f5b324 60%, #d98c0b)"
                    : "rgba(255,255,255,0.08)",
                border: i === 0 ? "none" : "1px solid rgba(255,255,255,0.15)",
              }}
            >
              {r.n}
            </div>
            <div
              style={{
                height: 14,
                width: r.w,
                borderRadius: 7,
                background:
                  i === 0
                    ? "linear-gradient(90deg, rgba(255,213,107,0.85), rgba(245,179,36,0.3))"
                    : "rgba(255,255,255,0.12)",
              }}
            />
          </div>
        ))}
      </div>

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
