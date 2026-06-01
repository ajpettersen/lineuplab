import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 8500), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ scale: 1.1, opacity: 0, filter: 'blur(20px)' }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="w-1/2 relative h-full flex items-center justify-center">
        <motion.div 
          className="relative w-[450px] bg-[var(--color-bg-muted)]/60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
          initial={{ rotateY: -30, opacity: 0, z: -200 }}
          animate={phase >= 2 ? { rotateY: 0, opacity: 1, z: 0 } : { rotateY: -30, opacity: 0, z: -200 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          style={{ perspective: 1000 }}
        >
          <div className="bg-[var(--color-primary)] p-4 text-center">
            <div className="text-[var(--color-bg-dark)] font-mono font-bold text-sm uppercase">Next Game</div>
            <div className="text-[var(--color-bg-dark)] font-display text-3xl uppercase mt-1">Saturday, Oct 14</div>
          </div>
          <div className="p-8 flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center text-2xl font-bold">LL</div>
                <div className="mt-2 font-bold text-lg">Lineup Lab</div>
              </div>
              <div className="text-xl font-mono text-[var(--color-text-muted)]">VS</div>
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center text-2xl font-bold text-red-500">T</div>
                <div className="mt-2 font-bold text-lg">Tigers</div>
              </div>
            </div>
            <div className="h-px w-full bg-white/10" />
            <div className="flex items-center gap-4 text-[var(--color-text-muted)]">
              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">📍</div>
              <div>Centennial Park, Field 3</div>
            </div>
            <div className="flex items-center gap-4 text-[var(--color-text-muted)]">
              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">⏰</div>
              <div>Arrive 9:00 AM • First Pitch 10:00 AM</div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="w-1/2 flex flex-col justify-center pl-16">
        <motion.div 
          className="text-[var(--color-primary)] font-mono tracking-widest text-lg mb-4 uppercase"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20 }}
          transition={{ duration: 0.6 }}
        >
          Step 2
        </motion.div>
        <motion.h1 
          className="font-display text-[6vw] leading-[1.1] uppercase text-shadow-glow"
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, x: phase >= 1 ? 0 : 50 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          Schedule a<br />
          <span className="text-[var(--color-primary)]">Game</span>
        </motion.h1>
        <motion.p 
          className="text-2xl text-[var(--color-text-secondary)] mt-6 max-w-lg"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 3 ? 1 : 0 }}
          transition={{ duration: 0.8 }}
        >
          Add opponent, date, and location. Paste an iCal link to import your entire season schedule instantly.
        </motion.p>
      </div>
    </motion.div>
  );
}
