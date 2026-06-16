import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import lineupShot from '@assets/screenshots/lineuplab-ai-lineups.webp';

export function Scene3() {
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
      className="absolute inset-0 flex flex-col items-center justify-center px-24"
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ y: -100, opacity: 0 }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="text-center z-20">
        <motion.div 
          className="text-[var(--color-primary)] font-mono tracking-widest text-lg mb-4 uppercase inline-block"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20 }}
          transition={{ duration: 0.6 }}
        >
          Step 3
        </motion.div>
        <motion.h1 
          className="font-display text-[6vw] leading-[1] uppercase text-shadow-glow"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, scale: phase >= 1 ? 1 : 0.9 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          Generate a <span className="text-[var(--color-primary)]">Fair Lineup</span>
        </motion.h1>
      </div>

      <motion.div 
        className="mt-12 w-full max-w-5xl relative z-20 flex justify-center"
        initial={{ opacity: 0, y: 50 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="relative w-full rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[var(--color-bg-muted)]">
          <img src={lineupShot} alt="Lineup Lab AI lineup screen" className="block w-full h-auto" />
          <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 pointer-events-none" />
        </div>
      </motion.div>
    </motion.div>
  );
}
