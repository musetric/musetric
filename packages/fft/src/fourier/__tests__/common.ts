import { expect } from 'vitest';

export const windowCount = 1;

export const createBuffers = (device: GPUDevice, windowSize: number) => {
  const createSignalBuffer = () => ({
    real: device.createBuffer({
      label: 'test-signal-real-buffer',
      size: windowSize * Float32Array.BYTES_PER_ELEMENT,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    }),
    imag: device.createBuffer({
      label: 'test-signal-imag-buffer',
      size: windowSize * Float32Array.BYTES_PER_ELEMENT,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    }),
  });

  const buffers = {
    signal: createSignalBuffer(),
    destroy: () => {
      buffers.signal.real.destroy();
      buffers.signal.imag.destroy();
    },
  };

  return buffers;
};

export const assertArrayClose = (
  name: string,
  received: Float32Array<ArrayBuffer>,
  expected: Float32Array<ArrayBuffer>,
) => {
  expect(received.length, `${name} length`).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(received[i], `${name} index ${i}`).toBeCloseTo(expected[i], 1.5);
  }
};
