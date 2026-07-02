import { expect } from 'vitest';

export const windowCount = 1;

export const createBuffers = (device: GPUDevice, windowSize: number) => {
  const waveByteSize = windowSize * Float32Array.BYTES_PER_ELEMENT;
  const spectrumByteSize = (windowSize + 2) * Float32Array.BYTES_PER_ELEMENT;

  const buffers = {
    wave: device.createBuffer({
      label: 'test-r2c-wave',
      size: waveByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    spectrum: device.createBuffer({
      label: 'test-r2c-spectrum',
      size: spectrumByteSize,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    }),
    inPlace: device.createBuffer({
      label: 'test-r2c-in-place',
      size: spectrumByteSize,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    }),
    inPlaceByteSize: spectrumByteSize,
    destroy: () => {
      buffers.wave.destroy();
      buffers.spectrum.destroy();
      buffers.inPlace.destroy();
    },
  };

  return buffers;
};

export type CreateIFourierBuffersConfig = {
  windowSize: number;
  waveSize: number;
};

export const createIFourierBuffers = (
  device: GPUDevice,
  config: CreateIFourierBuffersConfig,
) => {
  const spectrumSize = (config.windowSize + 2) * Float32Array.BYTES_PER_ELEMENT;
  const buffers = {
    spectrum: device.createBuffer({
      label: 'test-c2r-spectrum',
      size: spectrumSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    wave: device.createBuffer({
      label: 'test-c2r-wave',
      size: config.waveSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }),
    inPlace: device.createBuffer({
      label: 'test-c2r-in-place',
      size: spectrumSize,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    }),
    destroy: () => {
      buffers.spectrum.destroy();
      buffers.wave.destroy();
      buffers.inPlace.destroy();
    },
  };

  return buffers;
};

export const createPaddedWave = (
  wave: Float32Array<ArrayBuffer>,
): Float32Array<ArrayBuffer> => {
  const output = new Float32Array(wave.length + 2);
  output.set(wave);
  return output;
};

export type SplitSpectrum = {
  real: Float32Array<ArrayBuffer>;
  imag: Float32Array<ArrayBuffer>;
};

export const createInterleavedSpectrum = (
  spectrum: SplitSpectrum,
  windowSize: number,
): Float32Array<ArrayBuffer> => {
  const output = new Float32Array(windowSize + 2);

  for (let binIndex = 0; binIndex < spectrum.real.length; binIndex++) {
    const outputIndex = 2 * binIndex;
    output[outputIndex] = spectrum.real[binIndex];
    output[outputIndex + 1] = spectrum.imag[binIndex];
  }

  return output;
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
