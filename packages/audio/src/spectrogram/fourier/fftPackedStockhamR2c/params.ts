import { type FourierConfig } from '../config.js';

export type PackedStockhamR2cParams = {
  windowSize: number;
  windowCount: number;
};

export type Params = {
  value: PackedStockhamR2cParams;
  buffer: GPUBuffer;
};

export const createParams = (
  device: GPUDevice,
  config: FourierConfig,
): Params => {
  const value = {
    windowSize: config.windowSize,
    windowCount: config.windowCount,
  };
  const array = new Uint32Array([value.windowSize, value.windowCount]);
  const buffer = device.createBuffer({
    label: 'packed-stockham-r2c-params',
    size: array.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, array);

  return { value, buffer };
};
