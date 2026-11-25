import { type EngineState, isPlaying, isRecording } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';

export const canCommandPlayback = (state: EngineState): boolean =>
  Boolean(state.frameCount);

export const canStartPlayback = (state: EngineState): boolean =>
  canCommandPlayback(state) && state.statuses.realtime !== 'error';

export const togglePlayback = () => {
  const state = engine.store.get();
  if (isPlaying(state) || isRecording(state)) {
    void engine.player.stop();
    return;
  }
  if (canStartPlayback(state)) {
    void engine.player.play();
  }
};
