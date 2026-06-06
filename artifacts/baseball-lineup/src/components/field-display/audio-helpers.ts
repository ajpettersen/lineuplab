import confetti from "canvas-confetti";

/**
 * Big "we took the lead" celebration. Paints into a caller-supplied
 * canvas (so we control the stacking context above any iPad full-
 * screen / dim overlays — the library's auto-created body canvas
 * was getting clipped on iPad) and pulses a coordinated screen-flash
 * div for an extra "WOO!" wallop.
 *
 * Sequence (~4 seconds, scaled up from v1 which barely registered on
 * larger displays):
 *   0.0s  Massive center boom (220 particles, big scalar)
 *   0.0s  Golden screen-flash pulse fades over 700ms
 *   0.0s  Two-pole foul-pole cannons alternate every 220ms for ~2s
 *   0.0s  Ticker-tape RAIN from the top edges for ~1.8s
 *   2.2s  Encore center boom + secondary flash
 *   3.2s  Final golden bottom cannon for the curtain
 *
 * Colors lean on broadcast-gold + deep-navy so it reads as on-brand.
 * Honors prefers-reduced-motion (single modest burst, no flash).
 */
export type ConfettiFire = ReturnType<typeof confetti.create>;

/**
 * Synthesized "scored a run" chirp — a quick three-note ascending
 * arpeggio (C5 → E5 → G5) using triangle oscillators with a fast
 * attack and ~140ms decay. No asset files needed; everything happens
 * via the Web Audio API. Respects prefers-reduced-motion by quieting
 * the master gain.
 *
 * The caller passes an already-unlocked AudioContext (created during
 * a user gesture). If absent or unavailable the function bails out
 * silently — sound is a nice-to-have, never a crash surface.
 */
export function playRunCheerSound(ctx: AudioContext | null) {
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const masterGain = reduced ? 0.07 : 0.18;
  // C5, E5, G5 — a happy major triad.
  const notes = [523.25, 659.25, 783.99];
  const now = ctx.currentTime;
  notes.forEach((freq, i) => {
    const start = now + i * 0.08;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(masterGain, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.2);
  });
}

/**
 * Synthesized "we took the lead" fanfare — three-note brass-y stab
 * (G4 → C5 → E5) followed by a sustained C5/E5/G5 chord and a final
 * higher pop (C6). Sawtooth oscillators run through a softly low-
 * passed gain envelope to sound trumpet-like without sounding harsh.
 * Total run time ~1.4s, mixed under the master gain of the run-cheer
 * by design (it's already very dramatic visually).
 */
export function playFanfareSound(ctx: AudioContext | null) {
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const masterGain = reduced ? 0.08 : 0.22;

  const playNote = (
    freq: number,
    startOffset: number,
    duration: number,
    type: OscillatorType = "sawtooth",
    peak = masterGain,
  ) => {
    const start = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = freq;
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    filter.Q.value = 0.6;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  };

  // Stab: G4, C5, E5 each ~140ms apart.
  playNote(392.0, 0.0, 0.22);
  playNote(523.25, 0.14, 0.22);
  playNote(659.25, 0.28, 0.32);

  // Sustained chord at 0.42s — C5, E5, G5 layered triangles, quieter.
  playNote(523.25, 0.42, 0.7, "triangle", masterGain * 0.55);
  playNote(659.25, 0.42, 0.7, "triangle", masterGain * 0.5);
  playNote(783.99, 0.42, 0.7, "triangle", masterGain * 0.45);

  // Final high pop at 1.1s — C6.
  playNote(1046.5, 1.1, 0.35, "triangle", masterGain * 0.8);
}

/**
 * Short "we scored a run!" cheer — much smaller than the take-the-
 * lead show. Fires every time ourScore increases (unless that same
 * +1 ALSO flips the lead, in which case the big celebration wins).
 * One quick center pop + two side flicks, totals ~700ms.
 */
export function fireScoredRunCheer(fire: ConfettiFire | null) {
  if (typeof window === "undefined") return;
  const shoot = fire ?? confetti;
  const GOLD = ["#f5b800", "#ffd24c", "#fff2b8", "#ffae00"];
  const ALL = [...GOLD, "#ffffff", "#7aa9ff"];

  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduced) {
    void shoot({
      particleCount: 30,
      spread: 60,
      origin: { y: 0.6 },
      colors: ALL,
    });
    return;
  }

  // Quick center pop.
  void shoot({
    particleCount: 90,
    spread: 80,
    startVelocity: 50,
    scalar: 1.05,
    ticks: 180,
    origin: { x: 0.5, y: 0.6 },
    colors: ALL,
  });
  // Two small side flicks 120ms later for a one-two punch.
  window.setTimeout(() => {
    void shoot({
      particleCount: 30,
      angle: 60,
      spread: 50,
      startVelocity: 55,
      ticks: 200,
      origin: { x: 0.05, y: 0.85 },
      colors: GOLD,
    });
    void shoot({
      particleCount: 30,
      angle: 120,
      spread: 50,
      startVelocity: 55,
      ticks: 200,
      origin: { x: 0.95, y: 0.85 },
      colors: GOLD,
    });
  }, 120);
}

export function fireTakeTheLeadCelebration(
  fire: ConfettiFire | null,
  flashEl: HTMLDivElement | null,
) {
  if (typeof window === "undefined") return;
  // Fall back to the library's default canvas if our scoped one isn't
  // mounted yet (shouldn't happen in practice — the effect mounts on
  // first render — but keeps the function safe to call standalone).
  const shoot = fire ?? confetti;

  const GOLD = ["#f5b800", "#ffd24c", "#fff2b8", "#ffae00"];
  const NAVY = ["#1c3d7a", "#2e5fb3", "#7aa9ff", "#cfe0ff"];
  const ALL = [...GOLD, ...NAVY, "#ffffff"];

  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduced) {
    void shoot({
      particleCount: 80,
      spread: 80,
      origin: { y: 0.55 },
      colors: ALL,
    });
    return;
  }

  const pulseFlash = (peak: number, fadeMs: number) => {
    if (!flashEl) return;
    flashEl.style.transition = "opacity 120ms ease-out";
    flashEl.style.opacity = String(peak);
    window.setTimeout(() => {
      if (!flashEl) return;
      flashEl.style.transition = `opacity ${fadeMs}ms ease-out`;
      flashEl.style.opacity = "0";
    }, 140);
  };

  // 1. Massive center boom + screen flash.
  pulseFlash(0.85, 700);
  void shoot({
    particleCount: 220,
    spread: 110,
    startVelocity: 65,
    scalar: 1.25,
    ticks: 240,
    origin: { x: 0.5, y: 0.55 },
    colors: ALL,
  });

  // 2. Two-pole foul-pole cannons, alternating, for 2s.
  const polesEndAt = Date.now() + 2000;
  let polesTick = 0;
  const polesLauncher = window.setInterval(() => {
    if (Date.now() > polesEndAt) {
      window.clearInterval(polesLauncher);
      return;
    }
    const fromLeft = polesTick % 2 === 0;
    polesTick++;
    void shoot({
      particleCount: 70,
      angle: fromLeft ? 60 : 120,
      spread: 65,
      startVelocity: 75,
      scalar: 1.1,
      ticks: 260,
      origin: { x: fromLeft ? 0.05 : 0.95, y: 0.85 },
      colors: fromLeft ? GOLD : NAVY,
    });
  }, 220);

  // 3. Ticker-tape rain from the top edges.
  const rainEndAt = Date.now() + 1800;
  let rainTick = 0;
  const rainLauncher = window.setInterval(() => {
    if (Date.now() > rainEndAt) {
      window.clearInterval(rainLauncher);
      return;
    }
    const fromTopLeft = rainTick % 2 === 0;
    rainTick++;
    void shoot({
      particleCount: 50,
      angle: fromTopLeft ? -70 : -110,
      spread: 90,
      startVelocity: 40,
      gravity: 0.9,
      scalar: 0.95,
      ticks: 320,
      origin: { x: fromTopLeft ? 0.15 : 0.85, y: -0.05 },
      colors: ALL,
    });
  }, 260);

  // 4. Encore boom + secondary flash.
  window.setTimeout(() => {
    pulseFlash(0.45, 600);
    void shoot({
      particleCount: 180,
      spread: 130,
      startVelocity: 60,
      scalar: 1.15,
      ticks: 240,
      origin: { x: 0.5, y: 0.5 },
      colors: ALL,
    });
  }, 2200);

  // 5. Final golden bottom cannon for the curtain.
  window.setTimeout(() => {
    void shoot({
      particleCount: 140,
      spread: 140,
      startVelocity: 80,
      scalar: 1.3,
      ticks: 280,
      origin: { x: 0.5, y: 0.95 },
      colors: GOLD,
    });
  }, 3200);
}
