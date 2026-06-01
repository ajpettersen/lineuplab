import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

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
          {/* iPad Screen Content */}
          <div className="w-full h-full bg-[var(--color-bg-dark)] flex flex-col">
            {/* Top Bar Scoreboard */}
            <div className="bg-[var(--color-bg-muted)] h-20 flex items-center justify-between px-8 border-b border-white/10">
              <div className="flex items-center gap-4">
                <div className="text-2xl font-display uppercase font-bold text-[var(--color-primary)]">Lineup Lab</div>
                <div className="text-4xl font-mono font-bold">4</div>
              </div>
              <div className="flex flex-col items-center">
                <div className="text-sm font-mono text-gray-400">INNING</div>
                <div className="text-2xl font-bold font-mono text-white">Top 3</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-4xl font-mono font-bold">2</div>
                <div className="text-2xl font-display uppercase font-bold">Tigers</div>
              </div>
            </div>
            
            {/* Main Area */}
            <div className="flex-1 flex p-6 gap-6">
              {/* Field Representation */}
              <div className="w-2/3 bg-green-900/20 border border-green-500/20 rounded-xl relative overflow-hidden flex items-center justify-center">
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-green-900/40 to-transparent" />
                <motion.div 
                  className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-black font-bold shadow-lg"
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 4, repeat: Infinity }}
                >
                  P: Alex
                </motion.div>
                {/* Other positions abstractly */}
                <div className="absolute top-1/4 left-1/4 w-12 h-12 bg-white/20 rounded-full" />
                <div className="absolute top-1/4 right-1/4 w-12 h-12 bg-white/20 rounded-full" />
                <div className="absolute top-1/2 right-1/4 w-12 h-12 bg-white/20 rounded-full" />
              </div>
              
              {/* Batting Order */}
              <div className="w-1/3 flex flex-col gap-2">
                <div className="text-sm font-bold uppercase text-[var(--color-text-muted)] mb-2">Batting Order</div>
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className={`p-3 rounded-lg ${i === 2 ? 'bg-[var(--color-primary)] text-black font-bold scale-105 shadow-lg' : 'bg-white/5 border border-white/5'} flex gap-3 items-center`}>
                    <div className="font-mono text-sm opacity-60">{i}</div>
                    <div>Player {i}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
