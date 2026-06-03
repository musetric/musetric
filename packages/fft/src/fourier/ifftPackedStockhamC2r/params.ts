import { type FourierConfig } from '../config.es.js';

export type Params = {
  buffer: GPUBuffer;
};

const paramsSize = 2 * Uint32Array.BYTES_PER_ELEMENT;

export const createParams = (
  device: GPUDevice,
  config: FourierConfig,
): Params => {
  const array = new Uint32Array([config.windowSize, config.windowCount]);
  const buffer = device.createBuffer({
    label: 'packed-stockham-c2r-params-buffer',
    size: paramsSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, array);
  return { buffer };
};
