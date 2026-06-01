import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

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
        className="mt-12 w-full max-w-4xl relative z-20 flex gap-8"
        initial={{ opacity: 0, y: 50 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Settings Panel */}
        <div className="flex-1 bg-[var(--color-bg-muted)]/60 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400">✨</div>
            <div className="font-bold text-xl uppercase">AI Settings</div>
          </div>
          
          <div className="space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <span className="font-bold">Fairness Dial</span>
                <span className="text-[var(--color-primary)] font-mono">STRICT</span>
              </div>
              <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-gradient-to-r from-[var(--color-primary)] to-amber-300"
                  initial={{ width: "20%" }}
                  animate={phase >= 3 ? { width: "85%" } : { width: "20%" }}
                  transition={{ duration: 1.5, ease: "easeInOut" }}
                />
              </div>
              <div className="text-sm text-[var(--color-text-muted)] mt-2">Balances positions and bench time</div>
            </div>
            
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/5">
              <div>
                <div className="font-bold">Lock Positions</div>
                <div className="text-sm text-[var(--color-text-muted)]">Alex M. locked at Pitcher</div>
              </div>
              <div className="w-12 h-6 bg-[var(--color-primary)] rounded-full relative">
                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full shadow" />
              </div>
            </div>
          </div>
        </div>
        
        {/* Output Panel */}
        <div className="w-[300px] flex flex-col gap-3">
          {[1, 2, 3].map((inning, i) => (
            <motion.div 
              key={i}
              className="bg-[var(--color-bg-dark)]/80 backdrop-blur-md border border-[var(--color-primary)]/30 rounded-xl p-4 shadow-lg"
              initial={{ opacity: 0, x: 50 }}
              animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: 50 }}
              transition={{ delay: i * 0.2, type: 'spring', stiffness: 300, damping: 25 }}
            >
              <div className="text-[var(--color-primary)] font-mono text-sm mb-2 uppercase font-bold border-b border-white/10 pb-2">Inning {inning}</div>
              <div className="flex justify-between items-center text-sm">
                <span>Alex M.</span> <span className="font-mono bg-white/10 px-2 rounded text-[var(--color-primary)]">P</span>
              </div>
              <div className="flex justify-between items-center text-sm mt-1">
                <span>Jordan T.</span> <span className="font-mono bg-white/10 px-2 rounded">C</span>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
