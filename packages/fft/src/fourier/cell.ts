import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type FourierConfig, type FourierMode } from './config.es.js';
import { fouriers } from './fouriers.js';
import {
  type Fourier,
  type FourierArg,
  type FourierTimestampWrites,
} from './types.js';

export type FourierCellConfig = FourierConfig & {
  fourierMode: FourierMode;
  zeroPaddingFactor: number;
};

export type StateArg = {
  signal: GPUBuffer;
  config: FourierCellConfig;
};

export const createFourierCell = (
  device: GPUDevice,
  markers?: FourierTimestampWrites,
): ResourceCell<StateArg, Fourier> => {
  const modeCell = createResourceCell({
    create: (mode: FourierMode) => fouriers[mode](device, markers),
    dispose: (cell) => {
      cell.dispose();
    },
    equals: (current, next) => current === next,
  });

  return {
    get: (arg) => {
      const { signal, config } = arg;
      const fourier = modeCell.get(config.fourierMode);
      const fourierArg: FourierArg = {
        wave: signal,
        spectrum: signal,
        config: {
          windowSize: config.windowSize * config.zeroPaddingFactor,
          windowCount: config.windowCount,
        },
      };

      return fourier.get(fourierArg);
    },
    dispose: () => {
      modeCell.dispose();
    },
  };
};
