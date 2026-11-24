import { type EngineState, isPlaying, isRecording } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';

export const canCommandPlayback = (state: EngineState): boolean =>
  Boolean(state.frameCount) && state.statuses.realtime !== 'error';

export const togglePlayback = () => {
  const state = engine.store.get();
  if (!canCommandPlayback(state)) {
    return;
  }
  if (isPlaying(state) || isRecording(state)) {
    void engine.player.stop();
    return;
  }
  void engine.player.play();
};
