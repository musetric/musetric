import { subscribeSystemBack } from '../../../app/systemBack.js';
import { engine } from '../../../engine/engine.js';
import { getCalibrationDevice } from '../calibration/calibrationTexts.js';

export const subscribeTakeInterruptions = (): (() => void) => {
  const stopWhenHidden = () => {
    if (
      document.hidden &&
      engine.store.get().recording &&
      getCalibrationDevice() !== 'computer'
    ) {
      void engine.player.stop();
    }
  };
  document.addEventListener('visibilitychange', stopWhenHidden);
  const unsubscribeBack = subscribeSystemBack((event) => {
    if (engine.store.get().recording) {
      event.preventDefault();
      void engine.player.stop();
    }
  });
  return () => {
    document.removeEventListener('visibilitychange', stopWhenHidden);
    unsubscribeBack();
  };
};
