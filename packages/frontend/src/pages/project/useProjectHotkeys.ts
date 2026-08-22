import { useEffect } from 'react';
import { engine } from '../../engine/engine.js';
import { useProjectStore, type VisualizationMode } from './store.js';

const seekSeconds = 5;

const modeByCode: Record<string, VisualizationMode | undefined> = {
  Digit1: 'tracks',
  Digit2: 'notes',
  Digit3: 'spectrum',
};

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

const seekBySeconds = (seconds: number) => {
  const state = engine.store.get();
  if (!state.frameCount || !state.duration) {
    return;
  }
  const framesPerSecond = state.frameCount / state.duration;
  const frameIndex = Math.min(
    state.frameCount,
    Math.max(0, Math.round(state.frameIndex + seconds * framesPerSecond)),
  );
  engine.player.seek(frameIndex, 'player');
};

const handleTransportKey = (code: string, projectId: number) => {
  const state = engine.store.get();

  if (code === 'Space') {
    void (state.playing || state.recording
      ? engine.player.stop()
      : engine.player.play());
    return true;
  }
  if (code === 'ArrowLeft') {
    seekBySeconds(-seekSeconds);
    return true;
  }
  if (code === 'ArrowRight') {
    seekBySeconds(seekSeconds);
    return true;
  }
  if (code === 'KeyR') {
    void (state.recording
      ? engine.player.stop()
      : engine.player.record(projectId));
    return true;
  }
  if (code === 'KeyM') {
    engine.store.update((draft) => {
      draft.metronomeEnabled = !draft.metronomeEnabled;
    });
    return true;
  }
  return false;
};

const handleViewKey = (code: string) => {
  const projectState = useProjectStore.getState();

  if (code === 'KeyL') {
    projectState.setSubtitlesOpen(!projectState.subtitlesOpen);
    return true;
  }

  const mode = modeByCode[code];
  if (mode) {
    projectState.setVisualizationMode(mode);
    return true;
  }
  return false;
};

export const useProjectHotkeys = (projectId: number) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      const handled =
        handleTransportKey(event.code, projectId) || handleViewKey(event.code);

      if (handled) {
        event.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [projectId]);
};
