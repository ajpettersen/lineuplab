import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import statsShot from '@assets/screenshots/lineuplab-stats.webp';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000), // graph builds
      setTimeout(() => setPhase(3), 5000), // morph to outro
      setTimeout(() => setPhase(4), 6000), // outro text
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.2 }}
    >
      {/* Part A: Season Stats */}
      <AnimatePresence>
        {phase < 3 && (
          <motion.div 
            className="absolute inset-0 flex items-center px-32"
            exit={{ opacity: 0, scale: 1.1, filter: 'blur(20px)' }}
            transition={{ duration: 1 }}
          >
            <div className="w-1/2">
              <motion.div 
                className="text-[var(--color-primary)] font-mono tracking-widest text-lg mb-4 uppercase"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20 }}
              >
                Step 5
              </motion.div>
              <motion.h1 
                className="font-display text-[5vw] leading-[1.1] uppercase text-shadow-glow"
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: phase >= 1 ? 1 : 0, x: phase >= 1 ? 0 : -30 }}
              >
                Track Season<br />
                <span className="text-[var(--color-primary)]">Stats</span>
              </motion.h1>
              <motion.p 
                className="text-xl text-[var(--color-text-secondary)] mt-6 max-w-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: phase >= 1 ? 1 : 0 }}
              >
                Review batting and pitching metrics, plus a Rotation Report to prove fairness to parents over the whole season.
              </motion.p>
            </div>
            
            <div className="w-1/2 flex justify-center items-center">
              <motion.div
                className="relative w-[560px] rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[var(--color-bg-muted)]"
                initial={{ opacity: 0, scale: 0.9, y: 30 }}
                animate={phase >= 2 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.9, y: 30 }}
                transition={{ duration: 0.8, type: 'spring', stiffness: 120, damping: 20 }}
              >
                <img src={statsShot} alt="Lineup Lab season stats screen" className="block w-full h-auto" />
                <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 pointer-events-none" />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Part B: Outro */}
      <AnimatePresence>
        {phase >= 3 && (
          <motion.div 
            className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-bg-dark)]/90 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1 }}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0, rotateX: 45 }}
              animate={phase >= 4 ? { scale: 1, opacity: 1, rotateX: 0 } : {}}
              transition={{ type: 'spring', stiffness: 100, damping: 20 }}
              className="text-center"
            >
              <div className="w-32 h-32 mx-auto bg-gradient-to-br from-[var(--color-primary)] to-amber-600 rounded-3xl flex items-center justify-center shadow-[0_0_50px_rgba(245,158,11,0.5)] mb-8 transform -rotate-6">
                <span className="text-6xl font-display font-black text-black">LL</span>
              </div>
              <h1 className="text-[8vw] font-display uppercase font-black leading-none tracking-tighter">
                Lineup <span className="text-[var(--color-primary)]">Lab</span>
              </h1>
              <p className="text-2xl font-mono text-[var(--color-text-muted)] mt-6 tracking-widest uppercase">
                Coach Smarter. Play Fair.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
