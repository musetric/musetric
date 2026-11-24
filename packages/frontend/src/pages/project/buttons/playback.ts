import { type EngineState } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';

export const canCommandPlayback = (state: EngineState): boolean =>
  Boolean(state.frameCount) &&
  state.statuses.realtime !== 'error' &&
  !state.playerCommandPending;

export const togglePlayback = () => {
  const state = engine.store.get();
  if (!canCommandPlayback(state)) {
    return;
  }
  if (state.playing || state.recording) {
    void engine.player.stop();
    return;
  }
  void engine.player.play();
};
