import { windowFunctions } from '@musetric/fft';
import { createResourceCell } from '@musetric/utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';

export type StateWindowFunction = {
  buffer: GPUBuffer;
};

export const createWindowFunctionCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: ExtSpectrogramConfig): StateWindowFunction => {
      const array = windowFunctions[config.windowName](config.windowSize);
      const buffer = device.createBuffer({
        label: 'slice-samples-window-function-buffer',
        size: array.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, array);

      return {
        buffer,
      };
    },
    dispose: (windowFunction) => {
      windowFunction.buffer.destroy();
    },
    equals: (current, next) =>
      current.windowSize === next.windowSize &&
      current.windowName === next.windowName,
  });
