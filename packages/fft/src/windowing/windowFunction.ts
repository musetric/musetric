import { createResourceCell } from '@musetric/resource-utils';
import { windowFunctions } from '../windowFunction/windowFunction.es.js';
import { type FftWindowingConfig } from './config.js';

export type StateWindowFunction = {
  buffer: GPUBuffer;
};

export const createWindowFunctionCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: FftWindowingConfig): StateWindowFunction => {
      const array = windowFunctions[config.windowName](config.windowSize);
      const buffer = device.createBuffer({
        label: 'windowing-window-function-buffer',
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
