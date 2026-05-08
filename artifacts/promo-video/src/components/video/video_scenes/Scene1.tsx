import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 4000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(10px)', scale: 1.1 }}
      transition={{ duration: 1 }}
    >
      <div className="relative z-10 flex flex-col items-center text-center px-12">
        <motion.div
          className="w-px bg-emerald-500 mb-8"
          initial={{ height: 0 }}
          animate={{ height: phase >= 1 ? 80 : 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
        
        <motion.h1 
          className="text-[6vw] font-bold tracking-tight text-white leading-tight font-display uppercase"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          Coaching youth baseball
        </motion.h1>
        
        <motion.h2 
          className="text-[6vw] font-bold tracking-tight text-emerald-400 leading-tight font-display uppercase italic"
          initial={{ opacity: 0, y: 30, rotateX: 45 }}
          animate={phase >= 2 ? { opacity: 1, y: 0, rotateX: 0 } : { opacity: 0, y: 30, rotateX: 45 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          is chaos.
        </motion.h2>

        <motion.p
          className="mt-8 text-2xl text-slate-300 max-w-2xl"
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={phase >= 2 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
          transition={{ duration: 1, delay: 0.5 }}
        >
          Between managing playing time, tracking pitch counts, and finding the clipboard... you barely get to coach.
        </motion.p>
      </div>
    </motion.div>
  );
}
