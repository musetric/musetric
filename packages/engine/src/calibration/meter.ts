import { getRecordingLatencyCalibrationClickVerdict } from '@musetric/audio/es';
import { type Store } from '../common/store.js';
import { type EngineState } from '../state.js';
import { type CalibrationMeasurementListeners } from './measurement.js';
import {
  type RecordingLatencyCalibrationClickPeak,
  type RecordingLatencyCalibrationLevel,
} from './protocol.cross.js';

const releaseDbPerSecond = 60;

const toLevelDb = (message: RecordingLatencyCalibrationLevel) =>
  message.level > 0 && message.quiet > 0
    ? Math.max(0, 20 * Math.log10(message.level / message.quiet))
    : 0;

export type CalibrationMeter = Required<CalibrationMeasurementListeners> & {
  stop: () => void;
};

export const createCalibrationMeter = (
  store: Store<EngineState>,
): CalibrationMeter => {
  let levelDb = 0;
  let pendingDb = 0;
  let clickIndex = -1;
  let lastTime: number | undefined = undefined;
  let frame: number | undefined = undefined;

  const flush = (time: number) => {
    frame = undefined;
    const elapsedSeconds =
      lastTime === undefined ? 0 : (time - lastTime) / 1000;
    lastTime = time;
    levelDb = Math.max(
      pendingDb,
      levelDb - releaseDbPerSecond * elapsedSeconds,
    );
    pendingDb = 0;
    store.update((draft) => {
      draft.calibrationLevelDb = levelDb;
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
      pendingDb = Math.max(pendingDb, toLevelDb(message));
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
