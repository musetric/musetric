import { createResourceCell } from '@musetric/resource-utils';
import { type FftWindowingConfig } from './config.js';

export type WindowingParams = {
  windowSize: number;
  paddedWindowSize: number;
  windowCount: number;
};

const toParams = (config: FftWindowingConfig): WindowingParams => ({
  windowSize: config.windowSize,
  paddedWindowSize: config.windowSize * config.zeroPaddingFactor,
  windowCount: config.windowCount,
});

export type StateParams = {
  value: WindowingParams;
  buffer: GPUBuffer;
};

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: FftWindowingConfig): StateParams => {
      const value = toParams(config);
      const array = new Uint32Array(3);
      array[0] = value.windowSize;
      array[1] = value.paddedWindowSize;
      array[2] = value.windowCount;

      const buffer = device.createBuffer({
        label: 'windowing-params-buffer',
        size: array.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, array);

      return {
        value,
        buffer,
      };
    },
    dispose: (params) => {
      params.buffer.destroy();
    },
    equals: (current, next) =>
      current.windowSize === next.windowSize &&
      current.windowCount === next.windowCount &&
      current.zeroPaddingFactor === next.zeroPaddingFactor,
  });
