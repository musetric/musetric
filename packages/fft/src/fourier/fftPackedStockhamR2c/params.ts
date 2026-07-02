import { type FourierConfig } from '../config.es.js';

const paramsByteLength = 16;

export type ParamsRing = {
  buffer: GPUBuffer;
  binding: (slot: number) => GPUBufferBinding;
  reserve: (batchOffset: number) => number;
  destroy: () => void;
};

export const createParamsRing = (
  device: GPUDevice,
  config: FourierConfig,
): ParamsRing => {
  const capacity = Math.max(1, config.windowCount);
  const alignment = device.limits.minUniformBufferOffsetAlignment;
  const stride = Math.ceil(paramsByteLength / alignment) * alignment;
  const buffer = device.createBuffer({
    label: 'packed-stockham-r2c-params',
    size: stride * capacity,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const scratch = new Uint32Array(paramsByteLength / 4);
  scratch[0] = config.windowSize;
  scratch[1] = config.windowCount;
  let cursor = 0;

  return {
    buffer,
    binding: (slot) => ({
      buffer,
      offset: slot * stride,
      size: paramsByteLength,
    }),
    reserve: (batchOffset) => {
      const slot = cursor;
      cursor = (cursor + 1) % capacity;
      scratch[2] = batchOffset;
      device.queue.writeBuffer(buffer, slot * stride, scratch);
      return slot;
    },
    destroy: () => {
      buffer.destroy();
    },
  };
};
