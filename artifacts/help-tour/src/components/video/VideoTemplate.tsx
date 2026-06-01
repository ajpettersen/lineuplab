import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

// Total time: 50 seconds (10s per scene)
export const SCENE_DURATIONS = {
  roster: 10000,
  schedule: 10000,
  lineup: 10000,
  dugout: 10000,
  statsAndOutro: 10000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  roster: Scene1,
  schedule: Scene2,
  lineup: Scene3,
  dugout: Scene4,
  statsAndOutro: Scene5,
};

const SCENE_KEYS = Object.keys(SCENE_DURATIONS);

// Cumulative scene-start offsets (seconds) for audio seeking.
const SCENE_START_SEC: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let cumulativeMs = 0;
  for (const [key, ms] of Object.entries(SCENE_DURATIONS)) {
    out[key] = cumulativeMs / 1000;
    cumulativeMs += ms;
  }
  return out;
})();

const AUDIO_SEEK_EPSILON_SEC = 0.18;

const BACKGROUND_IMAGES = [
  'baseball-field.jpg',
  'clipboard.jpg',
  'home-plate.jpg',
  'dugout.jpg',
  'lights.jpg',
];
const BACKGROUND_SCALE = [1.1, 1.15, 1.1, 1.2, 1.1];

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  muted = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENE_DURATIONS;
  const sceneIndex = SCENE_KEYS.indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSceneKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.45;
    // Only seek when the scene actually changed — re-running this effect on a
    // mute/unmute toggle must NOT rewind the music to the current scene's
    // start. `play()` still fires every time so unmuting resumes playback.
    if (lastSceneKeyRef.current !== currentSceneKey) {
      lastSceneKeyRef.current = currentSceneKey;
      const targetTime = SCENE_START_SEC[baseSceneKey] ?? 0;
      if (Math.abs(audio.currentTime - targetTime) > AUDIO_SEEK_EPSILON_SEC) {
        audio.currentTime = targetTime;
      }
    }
    audio.play().catch(() => {});
  }, [currentSceneKey, baseSceneKey, muted]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[var(--color-bg-dark)] font-body">

      {/* Persistent Background Layer */}
      <div className="absolute inset-0 z-0">
        <motion.div
          className="absolute inset-0 bg-cover bg-center opacity-20 mix-blend-overlay"
          animate={{
            backgroundImage: `url(${import.meta.env.BASE_URL}images/${
              BACKGROUND_IMAGES[sceneIndex] || BACKGROUND_IMAGES[0]
            })`,
            scale: BACKGROUND_SCALE[sceneIndex] ?? 1.1,
          }}
          transition={{ duration: 10, ease: 'linear' }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-dark)] via-[var(--color-bg-dark)]/90 to-transparent" />
        <div className="absolute inset-0 bg-[var(--color-bg-dark)]/60" />
      </div>

      {/* Persistent Graphical Elements */}
      <motion.div
        className="absolute top-0 left-0 w-2 h-full bg-[var(--color-primary)] z-10"
        animate={{
          x: sceneIndex === 4 ? '100vw' : '0vw',
          opacity: sceneIndex === 4 ? 0 : 1,
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.div
        className="absolute bottom-10 right-10 text-[var(--color-text-muted)] font-mono text-sm tracking-widest z-10"
        animate={{ opacity: sceneIndex === 4 ? 0 : 0.5 }}
      >
        [ LL-SYS-0{sceneIndex + 1} ]
      </motion.div>

      {/* Foreground Content inside AnimatePresence */}
      <div className="relative z-20 w-full h-full">
        <AnimatePresence mode="sync">
          {SceneComponent && <SceneComponent key={currentSceneKey} />}
        </AnimatePresence>
      </div>

      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`}
        preload="auto"
        autoPlay
        muted={muted}
      />
    </div>
  );
}
