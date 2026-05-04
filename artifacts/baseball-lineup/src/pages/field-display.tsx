import { useEffect, useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetGame,
  useGetGameLineup,
  getGetGameQueryKey,
  getGetGameLineupQueryKey,
} from "@workspace/api-client-react";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const FIELD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Diamond-shaped position layout for the dugout-fence iPad. Coordinates are
 * percentages of the field's bounding box so the SVG/CSS layout scales to
 * any screen size. Picked to match how a coach in the dugout naturally reads
 * the field: pitcher in the middle, catcher behind home, infielders form an
 * arc, outfielders along the back.
 */
const POSITION_LAYOUT: Record<
  (typeof FIELD_POSITIONS)[number],
  { top: string; left: string }
> = {
  CF: { top: "8%", left: "50%" },
  LF: { top: "16%", left: "20%" },
  RF: { top: "16%", left: "80%" },
  SS: { top: "40%", left: "36%" },
  "2B": { top: "40%", left: "64%" },
  "3B": { top: "52%", left: "18%" },
  "1B": { top: "52%", left: "82%" },
  P: { top: "52%", left: "50%" },
  C: { top: "82%", left: "50%" },
};

/**
 * Dugout / fence-iPad display. Read-only big-text view of the current
 * inning's defense plus the batting order. Polls the lineup every few
 * seconds so a change made on the coach's phone shows up on the iPad
 * without anyone touching it. Designed to fill the screen — no app
 * navigation, no header — because the iPad is strapped to the fence.
 */
export default function FieldDisplay() {
  const [, params] = useRoute("/games/:id/display");
  const id = parseInt(params?.id ?? "0");
  const { teamName, teamShortName } = useTeamSettings();

  // Polling interval: 5s feels live without hammering the API. The query is
  // also re-fetched on window focus (default react-query behavior) so a
  // coach who taps the iPad screen sees the freshest data right away.
  const POLL_MS = 5000;

  const { data: game } = useGetGame(id, {
    query: {
      enabled: !!id,
      queryKey: getGetGameQueryKey(id),
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: true,
    },
  });
  const { data: lineup = [] } = useGetGameLineup(id, {
    query: {
      enabled: !!id,
      queryKey: getGetGameLineupQueryKey(id),
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: true,
    },
  });

  // Coach-controlled "what inning is on the screen right now". Defaults to 1
  // and is bumped manually with the arrows so the display doesn't change
  // mid-inning just because somebody saved a future-inning tweak.
  const innings = game?.innings ?? 6;
  const [currentInning, setCurrentInning] = useState(1);
  useEffect(() => {
    // If the game shrinks (end-early) below the inning we're showing, snap
    // back to the last valid inning so the screen never goes blank.
    if (currentInning > innings) setCurrentInning(innings);
  }, [innings, currentInning]);

  // Coach can tap a batter to mark them as "currently up" — the row pulses
  // and the on-deck/in-the-hole rows show below. Stored as the player's
  // index in battingOrderRows (not the slot number) so it survives roster
  // changes without pointing at a deleted player.
  const [currentBatterIdx, setCurrentBatterIdx] = useState(0);

  // Show "Just updated" pulse when the lineup data changes. Driven off a
  // string fingerprint of the lineup so we don't false-trigger on identical
  // re-fetches. The pulse fades after ~3s.
  const fingerprint = useMemo(
    () =>
      lineup
        .map((e) => `${e.inning}:${e.position}:${e.playerId}:${e.battingOrder}`)
        .sort()
        .join("|"),
    [lineup],
  );
  const [justUpdated, setJustUpdated] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    if (!hasMounted) {
      setHasMounted(true);
      return;
    }
    setJustUpdated(true);
    const t = window.setTimeout(() => setJustUpdated(false), 3000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  // Defense for the current inning, keyed by position. Only one player per
  // position per inning is supported (server enforces).
  const fieldByPos = useMemo(() => {
    const map = new Map<string, { name: string; playerId: number }>();
    for (const e of lineup) {
      if (e.inning !== currentInning) continue;
      if (e.position === "Bench") continue;
      map.set(e.position, { name: e.playerName, playerId: e.playerId });
    }
    return map;
  }, [lineup, currentInning]);

  // Bench list for the current inning, name-sorted so the dugout can spot
  // their kids quickly.
  const benchNames = useMemo(() => {
    return lineup
      .filter((e) => e.inning === currentInning && e.position === "Bench")
      .map((e) => e.playerName)
      .sort((a, b) => a.localeCompare(b));
  }, [lineup, currentInning]);

  // Batting order: collapse per-player, take the first non-null order. Players
  // with no order (true bench-only in nine-man mode) land at the bottom.
  const battingOrder = useMemo(() => {
    type Row = { playerId: number; playerName: string; order: number | null };
    const byPlayer = new Map<number, Row>();
    for (const e of lineup) {
      const incoming = e.battingOrder ?? null;
      const existing = byPlayer.get(e.playerId);
      if (!existing) {
        byPlayer.set(e.playerId, {
          playerId: e.playerId,
          playerName: e.playerName,
          order: incoming,
        });
      } else if (existing.order == null && incoming != null) {
        existing.order = incoming;
      }
    }
    return Array.from(byPlayer.values()).sort((a, b) => {
      if (a.order != null && b.order != null) return a.order - b.order;
      if (a.order != null) return -1;
      if (b.order != null) return 1;
      return a.playerName.localeCompare(b.playerName);
    });
  }, [lineup]);

  // Score line on the header.
  const ourScore = game?.ourScore ?? 0;
  const oppScore = game?.opponentScore ?? 0;

  // Toggle browser fullscreen — gives an iPad-mounted display the most real
  // estate possible. Falls back gracefully if the API isn't available (some
  // older iPad Safari versions).
  const toggleFullscreen = () => {
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
    };
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (document.fullscreenElement) {
      void (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    } else {
      void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
    }
  };

  // Keep the iPad screen awake while this page is open. Wake Lock is supported
  // on iPadOS 16.4+ Safari and recent Chrome/Edge. iOS auto-releases the lock
  // whenever the tab is backgrounded, the device locks, or low-power mode kicks
  // in. To survive a 2-hour ballgame we MUST listen for the sentinel's
  // "release" event (clear our reference so it can be reacquired) and try to
  // reacquire on every visibility / focus / pageshow event.
  useEffect(() => {
    type WakeLockSentinel = {
      release: () => Promise<void>;
      addEventListener: (type: "release", cb: () => void) => void;
      removeEventListener: (type: "release", cb: () => void) => void;
    };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const onRelease = () => {
      // Browser/OS released our lock (background, lock screen, low-power).
      // Null our ref so the next visibility/focus event can re-request it.
      lock = null;
    };

    const acquire = async () => {
      if (cancelled || lock) return;
      if (document.visibilityState !== "visible") return;
      try {
        const next = await nav.wakeLock!.request("screen");
        if (cancelled) {
          void next.release();
          return;
        }
        next.addEventListener("release", onRelease);
        lock = next;
      } catch {
        // Throws when the page isn't visible, when permission is denied,
        // or on unsupported browsers — fall back to OS auto-lock silently.
      }
    };

    void acquire();
    const tryReacquire = () => void acquire();
    document.addEventListener("visibilitychange", tryReacquire);
    window.addEventListener("focus", tryReacquire);
    window.addEventListener("pageshow", tryReacquire);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", tryReacquire);
      window.removeEventListener("focus", tryReacquire);
      window.removeEventListener("pageshow", tryReacquire);
      if (lock) {
        lock.removeEventListener("release", onRelease);
        void lock.release();
      }
    };
  }, []);

  if (!id) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-slate-950 text-slate-100">
        <p>Game not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-100 flex flex-col select-none">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 sm:px-8 py-3 sm:py-4 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/games/${id}`}>
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-300 hover:text-white hover:bg-slate-800"
              data-testid="button-exit-display"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Exit
            </Button>
          </Link>
          <div className="min-w-0">
            <div className="text-lg sm:text-2xl font-bold truncate">
              {teamShortName || teamName || "Team"}
              <span className="mx-2 text-slate-500 font-normal">vs</span>
              <span className="truncate">{game?.opponent ?? ""}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-6 shrink-0">
          <div
            aria-live="polite"
            className={`hidden sm:flex items-center gap-2 text-sm uppercase tracking-wider font-semibold transition-opacity duration-500 ${
              justUpdated ? "text-emerald-400 opacity-100" : "text-slate-400 opacity-90"
            }`}
            data-testid="text-update-status"
          >
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                justUpdated ? "bg-emerald-400 animate-pulse" : "bg-emerald-500/70"
              }`}
              aria-hidden="true"
            />
            {justUpdated ? "Just updated" : "Live"}
          </div>
          <div className="text-2xl sm:text-3xl font-bold tabular-nums">
            <span className="text-slate-300">{ourScore}</span>
            <span className="mx-2 text-slate-600">–</span>
            <span className="text-slate-300">{oppScore}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="text-slate-300 hover:text-white hover:bg-slate-800"
            aria-label="Toggle fullscreen"
            data-testid="button-fullscreen"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* ── Inning controls ────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-4 sm:gap-8 px-4 py-4 sm:py-6 border-b border-slate-800/80 bg-slate-900/40">
        <Button
          variant="outline"
          size="lg"
          onClick={() => setCurrentInning((i) => Math.max(1, i - 1))}
          disabled={currentInning <= 1}
          className="h-14 w-14 sm:h-16 sm:w-16 p-0 border-slate-700 bg-slate-800/60 text-slate-100 hover:bg-slate-700 disabled:opacity-30"
          data-testid="button-prev-inning"
          aria-label="Previous inning"
        >
          <ChevronLeft className="h-7 w-7" />
        </Button>
        <div className="text-center">
          <div className="text-xs sm:text-sm uppercase tracking-[0.3em] text-slate-500">
            Inning
          </div>
          <div className="text-5xl sm:text-7xl font-black tabular-nums leading-none mt-1">
            {currentInning}
            <span className="text-slate-600 text-3xl sm:text-4xl font-bold">
              {" "}/ {innings}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="lg"
          onClick={() => setCurrentInning((i) => Math.min(innings, i + 1))}
          disabled={currentInning >= innings}
          className="h-14 w-14 sm:h-16 sm:w-16 p-0 border-slate-700 bg-slate-800/60 text-slate-100 hover:bg-slate-700 disabled:opacity-30"
          data-testid="button-next-inning"
          aria-label="Next inning"
        >
          <ChevronRight className="h-7 w-7" />
        </Button>
      </div>

      {/* ── Body: field + batting order ───────────────────────── */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_minmax(280px,420px)] gap-0 overflow-hidden">
        {/* Field diagram */}
        <section
          className="relative p-4 sm:p-6 overflow-hidden"
          data-testid="section-field"
        >
          <div
            className="relative w-full h-full min-h-[420px] sm:min-h-[560px] rounded-2xl border border-emerald-900/40 overflow-hidden"
            style={{
              background:
                "radial-gradient(ellipse at 50% 90%, rgb(20, 83, 45) 0%, rgb(13, 56, 30) 55%, rgb(10, 40, 22) 100%)",
            }}
          >
            {/* Stylized infield diamond — purely decorative. */}
            <svg
              className="absolute inset-0 w-full h-full opacity-40"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon
                points="50,55 36,65 50,82 64,65"
                fill="rgb(180, 130, 70)"
                opacity="0.55"
              />
              <circle cx="50" cy="55" r="3" fill="rgb(220, 220, 210)" opacity="0.7" />
              <line x1="50" y1="82" x2="36" y2="65" stroke="white" strokeWidth="0.4" opacity="0.5" />
              <line x1="36" y1="65" x2="50" y2="55" stroke="white" strokeWidth="0.4" opacity="0.5" />
              <line x1="50" y1="55" x2="64" y2="65" stroke="white" strokeWidth="0.4" opacity="0.5" />
              <line x1="64" y1="65" x2="50" y2="82" stroke="white" strokeWidth="0.4" opacity="0.5" />
            </svg>

            {FIELD_POSITIONS.map((pos) => {
              const player = fieldByPos.get(pos);
              const layout = POSITION_LAYOUT[pos];
              return (
                <div
                  key={pos}
                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                  style={{ top: layout.top, left: layout.left }}
                  data-testid={`field-pos-${pos}`}
                >
                  <div className="text-xs sm:text-sm font-bold tracking-wider uppercase text-emerald-100 mb-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                    {pos}
                  </div>
                  <div
                    className={`px-3 py-2 sm:px-4 sm:py-3 rounded-xl border-2 shadow-lg backdrop-blur-sm min-w-[100px] sm:min-w-[140px] text-center ${
                      player
                        ? "bg-white/95 border-white text-slate-900"
                        : "bg-slate-900/60 border-slate-700 text-slate-500"
                    }`}
                  >
                    <div className="text-base sm:text-xl font-bold leading-tight truncate max-w-[160px] sm:max-w-[200px]">
                      {player?.name ?? "—"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bench strip below the field */}
          <div className="mt-3 sm:mt-4 rounded-xl border border-slate-800 bg-slate-900/60 px-3 sm:px-4 py-3 sm:py-4">
            <div className="flex items-baseline gap-3 sm:gap-4 flex-wrap">
              <span className="text-xs sm:text-sm uppercase tracking-[0.3em] text-slate-400 font-semibold">
                Bench
              </span>
              {benchNames.length === 0 ? (
                <span className="text-base text-slate-500">—</span>
              ) : (
                benchNames.flatMap((n, i) => {
                  const node = (
                    <span
                      key={n}
                      className="text-base sm:text-lg font-semibold text-slate-100"
                      data-testid={`bench-name-${n}`}
                    >
                      {n}
                    </span>
                  );
                  return i === 0
                    ? [node]
                    : [
                        <span key={`sep-${i}`} className="text-slate-600 text-base">
                          ·
                        </span>,
                        node,
                      ];
                })
              )}
            </div>
          </div>
        </section>

        {/* Batting order panel */}
        <aside className="border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900/40 p-4 sm:p-6 overflow-y-auto">
          <div className="flex items-baseline justify-between mb-3 sm:mb-4">
            <h2 className="text-xs sm:text-sm uppercase tracking-[0.3em] text-slate-500 font-semibold">
              Batting Order
            </h2>
            <span className="text-[10px] uppercase tracking-wider text-slate-600">
              tap to set up
            </span>
          </div>
          <ol className="flex flex-col gap-1.5 sm:gap-2">
            {battingOrder.length === 0 && (
              <li className="text-slate-500 text-sm">No batting order yet.</li>
            )}
            {battingOrder.map((r, i) => {
              const isUp = i === currentBatterIdx;
              const isOnDeck = i === (currentBatterIdx + 1) % battingOrder.length;
              const isHole = i === (currentBatterIdx + 2) % battingOrder.length;
              const slotLabel = r.order != null ? r.order : "—";
              return (
                <li key={r.playerId}>
                  <button
                    type="button"
                    onClick={() => setCurrentBatterIdx(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 sm:py-3 rounded-lg border transition-colors text-left ${
                      isUp
                        ? "bg-amber-400/95 border-amber-300 text-slate-950 shadow-lg"
                        : isOnDeck
                          ? "bg-slate-800/80 border-slate-600 text-slate-100"
                          : isHole
                            ? "bg-slate-800/40 border-slate-700 text-slate-200"
                            : "bg-slate-900/40 border-slate-800 text-slate-300 hover:bg-slate-800/60"
                    }`}
                    data-testid={`batter-row-${i}`}
                  >
                    <span
                      className={`inline-flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full text-sm sm:text-base font-bold tabular-nums ${
                        isUp
                          ? "bg-slate-950 text-amber-300"
                          : "bg-slate-700 text-slate-100"
                      }`}
                    >
                      {slotLabel}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-base sm:text-lg font-bold leading-tight truncate">
                        {r.playerName}
                      </span>
                      {(isUp || isOnDeck || isHole) && (
                        <span
                          className={`block text-[10px] sm:text-xs uppercase tracking-wider font-semibold mt-0.5 ${
                            isUp ? "text-slate-700" : "text-slate-500"
                          }`}
                        >
                          {isUp ? "At Bat" : isOnDeck ? "On Deck" : "In the Hole"}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {battingOrder.length > 0 && (
            <div className="mt-3 sm:mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="lg"
                onClick={() =>
                  setCurrentBatterIdx(
                    (i) => (i - 1 + battingOrder.length) % battingOrder.length,
                  )
                }
                className="h-12 border-slate-700 bg-slate-800/60 text-slate-100 hover:bg-slate-700"
                data-testid="button-prev-batter"
              >
                <ChevronLeft className="h-5 w-5 mr-1" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() =>
                  setCurrentBatterIdx((i) => (i + 1) % battingOrder.length)
                }
                className="h-12 border-slate-700 bg-slate-800/60 text-slate-100 hover:bg-slate-700"
                data-testid="button-next-batter"
              >
                Next
                <ChevronRight className="h-5 w-5 ml-1" />
              </Button>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

// Re-export BASE so unused-import cleanup doesn't strip it; reserved for a
// future "share via QR code" feature on this screen.
export const __FIELD_DISPLAY_BASE = BASE;
