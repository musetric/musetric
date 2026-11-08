import { type EngineState } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';

export const canStop = (state: EngineState): boolean =>
  Boolean(state.frameCount) &&
  state.statuses.realtime !== 'error' &&
  !state.playerCommandPending;

export const canPlay = (state: EngineState): boolean =>
  canStop(state) && !state.isSlave;

export const togglePlayback = () => {
  const state = engine.store.get();
  if (state.playing || state.recording) {
    if (canStop(state)) {
      void engine.player.stop();
    }
    return;
  }
  if (canPlay(state)) {
    void engine.player.play();
  }
};
