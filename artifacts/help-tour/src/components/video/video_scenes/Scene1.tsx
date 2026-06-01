import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 8500), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const players = [
    { name: 'Alex M.', pos: 'P / SS' },
    { name: 'Jordan T.', pos: 'C / 1B' },
    { name: 'Chris R.', pos: 'CF / OF' },
    { name: 'Sam K.', pos: '3B' },
  ];

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-32"
      initial={{ clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="w-1/2 flex flex-col justify-center">
        <motion.div 
          className="text-[var(--color-primary)] font-mono tracking-widest text-lg mb-4 uppercase"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20 }}
          transition={{ duration: 0.6 }}
        >
          Step 1
        </motion.div>
        <motion.h1 
          className="font-display text-[6vw] leading-[1.1] uppercase text-shadow-glow"
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, x: phase >= 1 ? 0 : -50 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          Build Your<br />
          <span className="text-[var(--color-primary)]">Roster</span>
        </motion.h1>
        <motion.p 
          className="text-2xl text-[var(--color-text-secondary)] mt-6 max-w-lg"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 0.8 }}
        >
          Add players, bulk import from a text list, or use AI to scan a screenshot. Set preferred positions in seconds.
        </motion.p>
      </div>

      <div className="w-1/2 relative h-full flex items-center justify-center">
        <div className="relative w-[400px] h-[500px] bg-[var(--color-bg-muted)]/50 backdrop-blur-md border border-white/10 rounded-2xl p-8 flex flex-col gap-4 shadow-2xl">
          {players.map((p, i) => (
            <motion.div
              key={i}
              className="w-full bg-[var(--color-bg-dark)]/80 rounded-xl p-4 flex items-center gap-4 border border-white/5"
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={phase >= 3 ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 50, scale: 0.9 }}
              transition={{ delay: i * 0.15, type: 'spring', stiffness: 300, damping: 25 }}
            >
              <div className="w-12 h-12 rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center text-[var(--color-primary)] font-bold">
                {p.name.charAt(0)}
              </div>
              <div className="flex-1">
                <div className="text-xl font-bold">{p.name}</div>
                <div className="text-sm text-[var(--color-text-muted)] font-mono">{p.pos}</div>
              </div>
            </motion.div>
          ))}
          
          <motion.div
            className="absolute -right-12 -bottom-12 w-32 h-32 bg-[var(--color-primary)]/20 rounded-full blur-2xl"
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
    </motion.div>
  );
}
