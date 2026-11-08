import { subscribeSystemBack } from '../../../app/systemBack.js';
import { engine } from '../../../engine/engine.js';
import { leaveLoop } from './loopActions.js';

export const subscribeLoopBack = (): (() => void) =>
  subscribeSystemBack((event) => {
    const { loopStage, recording } = engine.store.get();
    if (loopStage === undefined || recording) {
      return;
    }
    event.preventDefault();
    leaveLoop();
  });
