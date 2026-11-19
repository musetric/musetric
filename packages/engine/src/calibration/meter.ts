import { getRecordingLatencyCalibrationClickVerdict } from '@musetric/audio/es';
import { type Store } from '../common/store.js';
import { type EngineState } from '../state.js';
import { type CalibrationMeasurementListeners } from './measurement.js';
import {
  type RecordingLatencyCalibrationClickPeak,
  type RecordingLatencyCalibrationLevel,
} from './protocol.cross.js';

const floorDb = 8;
const ceilingDb = 32;
const averageLength = 10;
const riseSeconds = 0.05;
const fallSeconds = 0.35;

const toLevel = (message: RecordingLatencyCalibrationLevel) => {
  if (message.level <= 0 || message.quiet <= 0) {
    return 0;
  }
  const levelDb = 20 * Math.log10(message.level / message.quiet);
  return Math.min(1, Math.max(0, (levelDb - floorDb) / (ceilingDb - floorDb)));
};

export type CalibrationMeter = Required<CalibrationMeasurementListeners> & {
  stop: () => void;
};

export const createCalibrationMeter = (
  store: Store<EngineState>,
): CalibrationMeter => {
  let level = 0;
  const recentLevels: number[] = [];
  let clickIndex = -1;
  let lastTime: number | undefined = undefined;
  let frame: number | undefined = undefined;

  const flush = (time: number) => {
    frame = undefined;
    const elapsedSeconds =
      lastTime === undefined ? 0 : (time - lastTime) / 1000;
    lastTime = time;
    const average =
      recentLevels.reduce((sum, value) => sum + value, 0) / recentLevels.length;
    const seconds = average > level ? riseSeconds : fallSeconds;
    level += (average - level) * (1 - Math.exp(-elapsedSeconds / seconds));
    store.update((draft) => {
      draft.calibrationLevel = level;
      draft.calibrationClickIndex = clickIndex;
    });
  };

  const judge = (message: RecordingLatencyCalibrationClickPeak) => {
    store.update((draft) => {
      draft.calibrationClicks[message.clickIndex] =
        getRecordingLatencyCalibrationClickVerdict(message.peak);
    });
  };

  return {
    onLevel: (message) => {
      recentLevels.push(toLevel(message));
      if (recentLevels.length > averageLength) {
        recentLevels.shift();
      }
      clickIndex = message.clickIndex;
      frame ??= requestAnimationFrame(flush);
    },
    onHeard: judge,
    onClosed: judge,
    stop: () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
    },
  };
};
