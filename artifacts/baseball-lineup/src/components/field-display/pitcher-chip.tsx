import { formatPlayerNameShort } from "@/lib/player-name";
import type { TPAvailability } from "./types";

export function PitcherChip({ p }: { p: TPAvailability }) {
  const resting = p.restingUntil ?? null;
  const todayLeft = p.pitchesAvailableToday;
  // Tone: red when zero left today (or resting), amber when ≤15, green
  // otherwise. Slate when no cap is configured so we don't misleadingly
  // green-light an un-quantified pitcher.
  let tone = "border-slate-600 text-slate-200 bg-[#0b1a35]/80";
  if (resting || (todayLeft != null && todayLeft <= 0)) {
    tone = "border-red-500/60 text-red-200 bg-red-950/40";
  } else if (todayLeft != null && todayLeft <= 15) {
    tone = "border-amber-500/60 text-amber-200 bg-amber-950/40";
  } else if (todayLeft != null) {
    tone = "border-emerald-500/60 text-emerald-200 bg-emerald-950/40";
  }
  return (
    <div
      // `cursor-default` + `select-none` deliberately de-emphasize
      // these chips as INFO ONLY. They look enough like the
      // draggable bench/lineup chips that an automated tester (and
      // presumably a coach mid-game) tried to drag them onto the
      // pitcher's mound, which silently no-ops because the drag
      // handler only accepts `player-`-prefixed source IDs. The
      // intended UX is: glance at this panel to see who's fresh,
      // then drag the matching bench chip onto P. Removing the
      // grab cursor + text-selection feel makes "this is a
      // reference card" land without changing the broadcast
      // styling. If we ever wire useDraggable into these, undo this.
      className={`flex-shrink-0 min-w-[90px] sm:min-w-[105px] rounded-md border px-2 py-1 cursor-default select-none ${tone}`}
      data-testid={`tournament-pitch-chip-${p.playerId}`}
    >
      <div className="text-[10px] sm:text-[11px] font-semibold leading-tight truncate">
        {formatPlayerNameShort(p.playerName)}
      </div>
      {resting ? (
        <div className="text-[10px] font-mono leading-tight mt-0.5">
          rests → {resting.availableOn.slice(5)}
        </div>
      ) : (
        <div className="text-[10px] font-mono leading-tight mt-0.5 flex items-center gap-1.5">
          <span>
            <span className="text-slate-400">today </span>
            <span className="font-bold">
              {todayLeft != null ? todayLeft : "—"}
            </span>
          </span>
          <span className="text-slate-500">·</span>
          <span>
            <span className="text-slate-400">tot </span>
            <span className="font-bold">
              {p.pitchesAvailableInTournament != null
                ? p.pitchesAvailableInTournament
                : "—"}
            </span>
          </span>
        </div>
      )}
      <div className="text-[9px] text-slate-400 leading-tight mt-0.5">
        thrown: {p.pitchesToday} today / {p.totalPitchesInTournament} tourney
      </div>
    </div>
  );
}
