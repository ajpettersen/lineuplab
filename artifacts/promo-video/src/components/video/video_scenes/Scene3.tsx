import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 1800),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-emerald-900/90 backdrop-blur-sm"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 1 }}
    >
      <div className="relative z-10 flex flex-col items-center text-center px-12 max-w-4xl">
        <motion.div 
          className="w-24 h-24 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center mb-8"
          initial={{ scale: 0, rotate: -45 }}
          animate={phase >= 1 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -45 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <svg className="w-12 h-12 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </motion.div>

        <motion.h1 
          className="text-[5vw] font-bold tracking-tight text-white leading-tight font-display uppercase"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8 }}
        >
          Import magic
        </motion.h1>

        <motion.p
          className="mt-6 text-3xl text-emerald-100/80"
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={phase >= 3 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
          transition={{ duration: 0.8 }}
        >
          Just paste a screenshot of a roster or box score.
          <br/>
          <span className="text-white font-medium">The AI handles the rest.</span>
        </motion.p>
      </div>

      {/* Decorative scanning line effect */}
      {phase >= 1 && (
        <motion.div 
          className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-400/10 to-transparent h-[20vh] w-full"
          animate={{ top: ['-20%', '120%'] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />
      )}
    </motion.div>
  );
}
