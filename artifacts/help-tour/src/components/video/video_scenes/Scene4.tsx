import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import fieldShot from '@assets/screenshots/lineuplab-field-display.webp';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 8500), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-24"
      initial={{ opacity: 0, y: 100 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ scale: 0.9, opacity: 0 }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="w-1/3 flex flex-col justify-center">
        <motion.div 
          className="text-[var(--color-primary)] font-mono tracking-widest text-lg mb-4 uppercase"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, x: phase >= 1 ? 0 : -20 }}
          transition={{ duration: 0.6 }}
        >
          Step 4
        </motion.div>
        <motion.h1 
          className="font-display text-[5vw] leading-[1.1] uppercase text-shadow-glow"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          Run the<br />
          <span className="text-[var(--color-primary)]">Dugout</span>
        </motion.h1>
        <motion.p 
          className="text-2xl text-[var(--color-text-secondary)] mt-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 0.8 }}
        >
          The iPad-optimized Field Display shows live lineups, inning-by-inning positions, and a real-time scoreboard.
        </motion.p>
      </div>

      <div className="w-2/3 h-full flex items-center justify-end">
        <motion.div 
          className="relative w-[700px] h-[480px] bg-black rounded-3xl border-8 border-gray-800 overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)]"
          initial={{ rotateX: 20, rotateY: -15, scale: 0.8, opacity: 0 }}
          animate={phase >= 2 ? { rotateX: 0, rotateY: -5, scale: 1, opacity: 1 } : { rotateX: 20, rotateY: -15, scale: 0.8, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
          style={{ perspective: 1200 }}
        >
          {/* iPad Screen Content — real Field Display */}
          <img src={fieldShot} alt="Lineup Lab Field Display on iPad" className="w-full h-full object-cover" />
        </motion.div>
      </div>
    </motion.div>
  );
}
