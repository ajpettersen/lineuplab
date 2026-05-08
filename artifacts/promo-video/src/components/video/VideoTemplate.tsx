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
        {/* Cinematic Video Background */}
        <video 
          src={`${import.meta.env.BASE_URL}videos/baseball-bg.mp4`}
          autoPlay 
          muted 
          loop 
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-screen"
        />
        
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
