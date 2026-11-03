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
  return () => {
    document.removeEventListener('visibilitychange', stopWhenHidden);
  };
};
