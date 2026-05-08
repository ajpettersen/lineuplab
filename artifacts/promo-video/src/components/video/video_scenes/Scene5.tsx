import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import logo from '@assets/generated_images/lineup-lab-icon.png';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      {/* Dramatic background light */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] rounded-full bg-emerald-500/10 blur-[120px]"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 2, ease: "easeOut" }}
      />

      <div className="relative z-10 flex flex-col items-center text-center">
        <motion.div
          className="w-32 h-32 mb-8 relative"
          initial={{ scale: 0, rotate: -180, filter: 'blur(20px)' }}
          animate={phase >= 1 ? { scale: 1, rotate: 0, filter: 'blur(0px)' } : { scale: 0, rotate: -180, filter: 'blur(20px)' }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div className="absolute inset-0 rounded-2xl bg-emerald-500/20 blur-xl animate-pulse" />
          <img src={logo} alt="Logo" className="w-full h-full object-contain relative z-10 rounded-2xl border border-white/10" />
        </motion.div>

        <motion.h1 
          className="text-[6vw] font-bold tracking-tight text-white leading-none font-display mb-6"
        >
          {'Lineup Lab'.split('').map((char, i) => (
            <motion.span key={i} className="inline-block"
              initial={{ opacity: 0, y: 40 }}
              animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
              transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 25 }}
            >
              {char === ' ' ? '\u00A0' : char}
            </motion.span>
          ))}
        </motion.h1>

        <motion.div
          className="text-[2.5vw] font-medium text-emerald-400 tracking-wide font-display uppercase"
          initial={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
          animate={phase >= 3 ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : { opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
          transition={{ duration: 1, ease: "easeOut" }}
        >
          For youth baseball coaches
        </motion.div>
      </div>
    </motion.div>
  );
}
