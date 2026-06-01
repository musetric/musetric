import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '@musetric/resource-utils/gpu';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { type FourierMode } from '../config.cross.js';
import { fouriers } from './fouriers.js';
import {
  type Fourier,
  type FourierArg,
  type FourierTimestampWrites,
} from './types.js';

export type StateArg = {
  signal: ComplexGpuBuffer;
  config: ExtSpectrogramConfig;
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
        signal,
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
