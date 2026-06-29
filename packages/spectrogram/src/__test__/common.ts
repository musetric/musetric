import { createGpuBufferReader } from '@musetric/utils/gpu';
import { expect } from 'vitest';
import { type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';

export const buildConfig = (
  overrides: Partial<SpectrogramConfig> = {},
): SpectrogramConfig => {
  const viewSize = overrides.viewSize ?? { width: 256, height: 128 };
  const canvas = new OffscreenCanvas(viewSize.width, viewSize.height);
  return {
    ...defaultSpectrogramConfig,
    ...overrides,
    canvas,
    viewSize,
  };
};

export const readFloats = async (
  device: GPUDevice,
  buffer: GPUBuffer,
  count: number,
): Promise<Float32Array> => {
  const reader = createGpuBufferReader({ device, typeSize: 4, size: count });
  try {
    return new Float32Array(await reader.read(buffer));
  } finally {
    reader.destroy();
  }
};

export const readCanvas = async (
  canvas: OffscreenCanvas,
): Promise<Uint8ClampedArray> => {
  const bitmap = await createImageBitmap(canvas);
  try {
    const target = new OffscreenCanvas(canvas.width, canvas.height);
    const context = target.getContext('2d');
    if (!context) {
      throw new Error('2d context unavailable for canvas readback');
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  } finally {
    bitmap.close();
  }
};

export const maxRed = (pixels: Uint8ClampedArray): number => {
  let max = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > max) {
      max = pixels[i];
    }
  }
  return max;
};

export const brightestRow = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): number => {
  let bestRow = -1;
  let bestValue = -1;
  for (let y = 0; y < height; y += 1) {
    let rowMax = 0;
    for (let x = 0; x < width; x += 1) {
      const red = pixels[(y * width + x) * 4];
      if (red > rowMax) {
        rowMax = red;
      }
    }
    if (rowMax > bestValue) {
      bestValue = rowMax;
      bestRow = y;
    }
  }
  return bestRow;
};

export const rowAtFrequency = (
  frequency: number,
  config: SpectrogramConfig,
): number => {
  const { minFrequency, maxFrequency, viewSize } = config;
  const logMin = Math.log(minFrequency);
  const logRange = Math.log(maxFrequency) - logMin;
  const ratio = (Math.log(frequency) - logMin) / logRange;
  return (1 - ratio) * (viewSize.height - 1);
};

export const createSilence = (length: number): Float32Array =>
  new Float32Array(length);

export const createConstant = (length: number, value: number): Float32Array =>
  new Float32Array(length).fill(value);

export const createRamp = (length: number): Float32Array =>
  Float32Array.from({ length }, (_, index) => index);

export const createImpulse = (length: number, at = 0): Float32Array => {
  const samples = new Float32Array(length);
  samples[at] = 1;
  return samples;
};

export const createTone = (
  length: number,
  frequency: number,
  sampleRate: number,
  amplitude = 1,
): Float32Array =>
  Float32Array.from(
    { length },
    (_, index) =>
      amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate),
  );

export const assertClose = (
  name: string,
  received: Float32Array,
  expected: Float32Array,
  digits = 3,
): void => {
  expect(received.length, `${name} length`).toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(received[i], `${name}[${i}]`).toBeCloseTo(expected[i], digits);
  }
};
