import { createGpuBufferReader, createGpuContext } from '@musetric/utils/gpu';
import { expect } from 'vitest';
import { createIfftPackedStockhamC2r } from '../fftPackedStockham/c2r/index.js';
import { createFftPackedStockhamR2c } from '../fftPackedStockham/r2c/index.js';
import { createFftPackedTiledR2c } from '../fftPackedTiledR2c/index.js';
import {
  type CreateFourier,
  type Fourier,
  type FourierBatchRange,
} from '../types.js';

export const { device } = await createGpuContext();

export const windowCount = 6;

export const batchRanges: FourierBatchRange[] = [
  { batchOffset: 1, batchCount: 2 },
  { batchOffset: 3, batchCount: 3 },
];

export const fourierCases: {
  label: string;
  createFourier: CreateFourier;
}[] = [
  {
    label: 'fftPackedStockhamR2c',
    createFourier: createFftPackedStockhamR2c,
  },
  {
    label: 'fftPackedTiledR2c',
    createFourier: createFftPackedTiledR2c,
  },
];

export const createSingleBatchSubmits = (
  submitCount: number,
): FourierBatchRange[][] =>
  Array.from({ length: submitCount }, (_, index) => [
    { batchOffset: index % windowCount, batchCount: 1 },
  ]);

export const makeInput = (windowSize: number, stride: number): Float32Array => {
  const data = new Float32Array(stride * windowCount);
  for (let w = 0; w < windowCount; w += 1) {
    for (let i = 0; i < windowSize; i += 1) {
      data[w * stride + i] =
        Math.sin((2 * Math.PI * (w + 1) * i) / windowSize) + 0.1 * w;
    }
  }
  return data;
};

export const readBuffer = async (
  buffer: GPUBuffer,
  size: number,
): Promise<Float32Array> => {
  const reader = createGpuBufferReader({ device, typeSize: 4, size });
  try {
    return new Float32Array(await reader.read(buffer));
  } finally {
    reader.destroy();
  }
};

export const submitFourierBatch = async (
  fourier: Fourier,
  rangesPerSubmit?: readonly (readonly FourierBatchRange[] | undefined)[],
): Promise<void> => {
  const submits = rangesPerSubmit ?? [undefined];
  for (const ranges of submits) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    if (ranges) {
      for (const range of ranges) {
        fourier.dispatch(pass, range);
      }
    } else {
      fourier.dispatch(pass);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  await device.queue.onSubmittedWorkDone();
};

export const expectDispatchThrows = (
  fourier: Fourier,
  range: FourierBatchRange,
): void => {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  try {
    expect(() => {
      fourier.dispatch(pass, range);
    }).toThrow(RangeError);
  } finally {
    pass.end();
  }
};

export const targetedBatches = (
  ranges: readonly FourierBatchRange[],
): Set<number> => {
  const targeted = new Set<number>();
  for (const range of ranges) {
    for (let k = 0; k < range.batchCount; k += 1) {
      targeted.add(range.batchOffset + k);
    }
  }
  return targeted;
};

type ExpectOnlyTargetedTransformedOptions = {
  ranged: Float32Array;
  full: Float32Array;
  input: Float32Array;
  stride: number;
  targeted: Set<number>;
};

export const expectOnlyTargetedTransformed = (
  options: ExpectOnlyTargetedTransformedOptions,
): void => {
  const { ranged, full, input, stride, targeted } = options;
  for (let w = 0; w < windowCount; w += 1) {
    const offset = w * stride;
    const expected = targeted.has(w) ? full : input;
    for (let i = 0; i < stride; i += 1) {
      expect(ranged[offset + i], `window ${w} index ${i}`).toBeCloseTo(
        expected[offset + i],
        3,
      );
    }
  }
};

export const transform = async (
  createFourier: CreateFourier,
  windowSize: number,
  selectedBatchRanges?: readonly FourierBatchRange[],
): Promise<Float32Array> => {
  const stride = windowSize + 2;
  const input = makeInput(windowSize, stride);
  const buffer = device.createBuffer({
    label: 'batch-range-in-place',
    size: input.byteLength,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, input);

  const fourierCell = createFourier(device);
  const fourier = fourierCell.get({
    wave: buffer,
    spectrum: buffer,
    config: { windowSize, windowCount },
  });

  try {
    await submitFourierBatch(fourier, [selectedBatchRanges]);
    return await readBuffer(buffer, stride * windowCount);
  } finally {
    buffer.destroy();
    fourierCell.dispose();
  }
};

export const transformOutOfPlace = async (
  createFourier: CreateFourier,
  windowSize: number,
  rangesPerSubmit?: readonly (readonly FourierBatchRange[])[],
): Promise<Float32Array> => {
  const spectrumStride = windowSize + 2;
  const input = makeInput(windowSize, windowSize);
  const wave = device.createBuffer({
    label: 'batch-range-wave',
    size: input.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const spectrum = device.createBuffer({
    label: 'batch-range-spectrum',
    size: spectrumStride * windowCount * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(wave, 0, input);

  const fourierCell = createFourier(device);
  const fourier = fourierCell.get({
    wave,
    spectrum,
    config: { windowSize, windowCount },
  });

  try {
    await submitFourierBatch(fourier, rangesPerSubmit);
    return await readBuffer(spectrum, spectrumStride * windowCount);
  } finally {
    wave.destroy();
    spectrum.destroy();
    fourierCell.dispose();
  }
};

export const inverseTransform = async (
  windowSize: number,
  selectedBatchRanges?: readonly FourierBatchRange[],
): Promise<Float32Array> => {
  const spectrumStride = windowSize + 2;
  const input = makeInput(windowSize, spectrumStride);
  const spectrum = device.createBuffer({
    label: 'batch-range-c2r-spectrum',
    size: input.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const wave = device.createBuffer({
    label: 'batch-range-c2r-wave',
    size: windowSize * windowCount * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(spectrum, 0, input);

  const fourierCell = createIfftPackedStockhamC2r(device);
  const fourier = fourierCell.get({
    wave,
    spectrum,
    config: { windowSize, windowCount },
  });

  try {
    await submitFourierBatch(fourier, [selectedBatchRanges]);
    return await readBuffer(wave, windowSize * windowCount);
  } finally {
    wave.destroy();
    spectrum.destroy();
    fourierCell.dispose();
  }
};
