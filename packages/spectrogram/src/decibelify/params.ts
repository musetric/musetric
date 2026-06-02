import { createResourceCell } from '@musetric/resource-utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';

export type DecibelifyParams = {
  halfSize: number;
  windowCount: number;
  decibelFactor: number;
};

const toParams = (config: ExtSpectrogramConfig): DecibelifyParams => ({
  halfSize: (config.windowSize * config.zeroPaddingFactor) / 2,
  windowCount: config.windowCount,
  decibelFactor: (20 * Math.LOG10E) / -config.minDecibel,
});

export type StateParams = {
  value: DecibelifyParams;
  buffer: GPUBuffer;
};

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: ExtSpectrogramConfig): StateParams => {
      const value = toParams(config);
      const array = new DataView(new ArrayBuffer(12));
      array.setUint32(0, value.halfSize, true);
      array.setUint32(4, value.windowCount, true);
      array.setFloat32(8, value.decibelFactor, true);

      const buffer = device.createBuffer({
        label: 'decibelify-params-buffer',
        size: array.buffer.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, array.buffer);

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
      current.zeroPaddingFactor === next.zeroPaddingFactor &&
      current.minDecibel === next.minDecibel,
  });
