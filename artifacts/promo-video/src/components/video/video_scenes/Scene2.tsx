import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import appScreenshot from '@assets/screenshots/lineuplab-ai-lineups.webp';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
      setTimeout(() => setPhase(4), 6000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-24 bg-slate-900/80 backdrop-blur-md"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="relative z-10 max-w-xl">
        <motion.div
          className="w-16 h-1 bg-emerald-500 mb-8"
          initial={{ width: 0 }}
          animate={{ width: phase >= 1 ? 64 : 0 }}
          transition={{ duration: 0.6 }}
        />
        
        <motion.h1 
          className="text-[4vw] font-bold tracking-tight text-white leading-none font-display uppercase mb-6"
        >
          {'AI-Powered'.split('').map((char, i) => (
            <motion.span key={i} className="inline-block"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ delay: i * 0.05 }}
            >
              {char === ' ' ? '\u00A0' : char}
            </motion.span>
          ))}
          <br/>
          {'Lineups'.split('').map((char, i) => (
            <motion.span key={i} className="inline-block text-emerald-400"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ delay: 0.3 + (i * 0.05) }}
            >
              {char}
            </motion.span>
          ))}
        </motion.h1>

        <motion.ul className="space-y-4 text-2xl text-slate-300">
          <motion.li 
            className="flex items-center gap-4"
            initial={{ opacity: 0, x: -20 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
          >
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            Rotate positions fairly
          </motion.li>
          <motion.li 
            className="flex items-center gap-4"
            initial={{ opacity: 0, x: -20 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
            transition={{ delay: 0.1 }}
          >
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            Equalize playing time automatically
          </motion.li>
          <motion.li 
            className="flex items-center gap-4"
            initial={{ opacity: 0, x: -20 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
            transition={{ delay: 0.2 }}
          >
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            Track season stats effortlessly
          </motion.li>
        </motion.ul>
      </div>

      <motion.div 
        className="relative z-10 w-[45vw]"
        initial={{ opacity: 0, y: 50, rotateY: 20, rotateX: 10 }}
        animate={phase >= 3 ? { opacity: 1, y: 0, rotateY: -5, rotateX: 5 } : { opacity: 0, y: 50, rotateY: 20, rotateX: 10 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        style={{ perspective: 1000 }}
      >
        <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-emerald-500/20 bg-slate-900">
          <img src={appScreenshot} alt="App Interface" className="w-full h-auto object-cover opacity-90" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent" />
        </div>
      </motion.div>
    </motion.div>
  );
}
