import { subscribeSystemBack } from '../../../app/systemBack.js';
import { engine } from '../../../engine/engine.js';
import { closeLoop } from './loopActions.js';

export const subscribeLoopBack = (): (() => void) =>
  subscribeSystemBack((event) => {
    const { loopStage, loopTries } = engine.store.get();
    if (loopStage === undefined) {
      return;
    }
    event.preventDefault();
    if (loopTries.length === 0) {
      closeLoop();
    }
  });
