import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = {
  hook: 5000,
  solution: 7000,
  magic: 5000,
  offline: 6500,
  outro: 6500,
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950 text-slate-50">
      
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Sport-neutral animated background: the logo's rotation ring turning
            slowly over a navy field, with players drifting across it. */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% 30%, #14336c 0%, #0a2552 50%, #050f26 100%)' }} />
        <motion.svg
          viewBox="0 0 200 200"
          className="absolute left-1/2 top-1/2 h-[140vmin] w-[140vmin] -translate-x-1/2 -translate-y-1/2 opacity-[0.12]"
          fill="none"
          animate={{ rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
        >
          <g stroke="#f5b324" strokeWidth="4" strokeLinecap="round">
            <path d="M38.2 77.6 A66 66 0 0 1 148.3 55.1" />
            <path d="M161.8 122.4 A66 66 0 0 1 51.7 144.9" />
          </g>
          <path d="M144 47 L156 56 L142 62 Z" fill="#f5b324" />
          <path d="M56 153 L44 144 L58 138 Z" fill="#f5b324" />
        </motion.svg>
        {[
          { x: ['8%', '30%', '12%'], y: ['20%', '60%', '35%'], d: 26, s: 'w-6 h-6' },
          { x: ['80%', '60%', '85%'], y: ['15%', '45%', '70%'], d: 31, s: 'w-4 h-4' },
          { x: ['45%', '70%', '40%'], y: ['80%', '55%', '85%'], d: 23, s: 'w-5 h-5' },
          { x: ['20%', '10%', '35%'], y: ['85%', '40%', '75%'], d: 35, s: 'w-3 h-3' },
          { x: ['65%', '90%', '75%'], y: ['85%', '25%', '50%'], d: 29, s: 'w-4 h-4' },
        ].map((dot, i) => (
          <motion.div
            key={i}
            className={`absolute rounded-full bg-white/15 ${dot.s}`}
            animate={{ left: dot.x, top: dot.y }}
            transition={{ duration: dot.d, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
          />
        ))}
        
        {/* Animated Overlays */}
        <motion.div 
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[100px] opacity-30 mix-blend-screen"
          style={{ background: 'radial-gradient(circle, var(--color-primary), transparent)' }}
          animate={{ 
            x: ['-20%', '40%', '-10%'], 
            y: ['-10%', '30%', '-20%'],
            scale: [1, 1.2, 0.9]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }} 
        />
        
        <div className="noise-overlay" />
      </div>

      {/* Persistent Midground Layers across scenes */}
      <motion.div
        className="absolute h-px bg-white/20"
        animate={{
          top: ['20%', '80%', '50%', '10%', '50%'][currentScene],
          left: ['0%', '10%', '0%', '20%', '10%'][currentScene],
          width: ['100%', '80%', '100%', '60%', '80%'][currentScene],
          opacity: currentScene === 4 ? 0 : 0.5,
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.div
        className="absolute w-px bg-white/20"
        animate={{
          left: ['30%', '70%', '15%', '85%', '50%'][currentScene],
          top: ['0%', '10%', '0%', '20%', '10%'][currentScene],
          height: ['100%', '80%', '100%', '60%', '80%'][currentScene],
          opacity: currentScene === 4 ? 0 : 0.5,
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      />

      <AnimatePresence mode="popLayout">
        {currentScene === 0 && <Scene1 key="hook" />}
        {currentScene === 1 && <Scene2 key="solution" />}
        {currentScene === 2 && <Scene3 key="magic" />}
        {currentScene === 3 && <Scene4 key="offline" />}
        {currentScene === 4 && <Scene5 key="outro" />}
      </AnimatePresence>
    </div>
  );
}
