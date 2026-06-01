import { createResourceCell } from '@musetric/resource-utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';

export type MagnitudifyParams = {
  windowSize: number;
  windowCount: number;
};

const toParams = (config: ExtSpectrogramConfig): MagnitudifyParams => ({
  windowSize: config.windowSize * config.zeroPaddingFactor,
  windowCount: config.windowCount,
});

export type StateParams = {
  value: MagnitudifyParams;
  buffer: GPUBuffer;
};

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: ExtSpectrogramConfig): StateParams => {
      const value = toParams(config);
      const array = new Uint32Array(2);
      array[0] = value.windowSize;
      array[1] = value.windowCount;

      const buffer = device.createBuffer({
        label: 'magnitudify-params-buffer',
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
