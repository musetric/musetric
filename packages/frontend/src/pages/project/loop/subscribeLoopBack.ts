import { isRecording } from '@musetric/engine';
import { subscribeSystemBack } from '../../../app/systemBack.js';
import { engine } from '../../../engine/engine.js';
import { leaveLoop } from './loopActions.js';

export const subscribeLoopBack = (): (() => void) =>
  subscribeSystemBack((event) => {
    const state = engine.store.get();
    if (state.loopStage === undefined || isRecording(state)) {
      return;
    }
    event.preventDefault();
    leaveLoop();
  });
