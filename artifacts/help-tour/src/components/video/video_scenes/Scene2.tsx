import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import scheduleShot from '@assets/screenshots/lineuplab-schedule.webp';

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
          className="relative w-[620px] rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[var(--color-bg-muted)]"
          initial={{ rotateY: -30, opacity: 0 }}
          animate={phase >= 2 ? { rotateY: 0, opacity: 1 } : { rotateY: -30, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          style={{ perspective: 1000 }}
        >
          <img src={scheduleShot} alt="Lineup Lab schedule screen" className="block w-full h-auto" />
          <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 pointer-events-none" />
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
