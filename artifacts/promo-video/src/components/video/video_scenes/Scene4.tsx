import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import ipadMockup from '@assets/screenshots/lineuplab-field-display.webp';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-24 bg-slate-950"
      initial={{ opacity: 0, x: -100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, y: -50, filter: 'blur(10px)' }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div 
        className="relative z-10 w-[50vw]"
        initial={{ opacity: 0, scale: 0.8, rotateY: -15 }}
        animate={phase >= 2 ? { opacity: 1, scale: 1, rotateY: 5 } : { opacity: 0, scale: 0.8, rotateY: -15 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        style={{ perspective: 1000 }}
      >
        <div className="rounded-3xl overflow-hidden border-4 border-slate-800 shadow-2xl shadow-black/50">
          <img src={ipadMockup} alt="Field Display" className="w-full h-auto object-cover" />
        </div>
      </motion.div>

      <div className="relative z-10 max-w-lg pl-16">
        <motion.h1 
          className="text-[4vw] font-bold tracking-tight text-white leading-tight font-display uppercase mb-6"
          initial={{ opacity: 0, x: 30 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: 30 }}
          transition={{ duration: 0.8 }}
        >
          Dugout<br/>
          <span className="text-emerald-400">Ready</span>
        </motion.h1>

        <motion.p
          className="text-2xl text-slate-300 mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8 }}
        >
          The Field Display view is built for your iPad. It works perfectly, even when the cell service drops.
        </motion.p>
        
        <motion.div
          className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-slate-800 border border-slate-700 text-emerald-400 font-medium"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Offline Support
        </motion.div>
      </div>
    </motion.div>
  );
}
