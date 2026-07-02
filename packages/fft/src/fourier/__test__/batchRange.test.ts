import { createGpuBufferReader, createGpuContext } from '@musetric/utils/gpu';
import { describe, expect, it } from 'vitest';
import { resolveFourierBatchRange } from '../batchRange.js';
import { createFftPackedStockhamR2c } from '../fftPackedStockhamR2c/index.js';
import { createFftPackedTiledR2c } from '../fftPackedTiledR2c/index.js';
import { createIfftPackedStockhamC2r } from '../ifftPackedStockhamC2r/index.js';
import { getPackedStockhamC2rVariant } from '../ifftPackedStockhamC2r/support.js';
import { type CreateFourier, type FourierBatchRange } from '../types.js';

const { device } = await createGpuContext();

const windowCount = 6;

const makeInput = (windowSize: number, stride: number): Float32Array => {
  const data = new Float32Array(stride * windowCount);
  for (let w = 0; w < windowCount; w += 1) {
    for (let i = 0; i < windowSize; i += 1) {
      data[w * stride + i] =
        Math.sin((2 * Math.PI * (w + 1) * i) / windowSize) + 0.1 * w;
    }
  }
  return data;
};

const readBuffer = async (
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

const transform = async (
  createFourier: CreateFourier,
  windowSize: number,
  batchRanges?: readonly FourierBatchRange[],
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
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  if (batchRanges) {
    for (const range of batchRanges) {
      fourier.dispatch(pass, range);
    }
  } else {
    fourier.dispatch(pass);
  }
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();

  try {
    return await readBuffer(buffer, stride * windowCount);
  } finally {
    buffer.destroy();
    fourierCell.dispose();
  }
};

const transformOutOfPlace = async (
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

  try {
    return await readBuffer(spectrum, spectrumStride * windowCount);
  } finally {
    wave.destroy();
    spectrum.destroy();
    fourierCell.dispose();
  }
};

const inverseTransform = async (
  windowSize: number,
  batchRanges?: readonly FourierBatchRange[],
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
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  if (batchRanges) {
    for (const range of batchRanges) {
      fourier.dispatch(pass, range);
    }
  } else {
    fourier.dispatch(pass);
  }
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();

  try {
    return await readBuffer(wave, windowSize * windowCount);
  } finally {
    wave.destroy();
    spectrum.destroy();
    fourierCell.dispose();
  }
};

const expectBatchRangeRejected = (
  createFourier: CreateFourier,
  windowSize: number,
  range: FourierBatchRange,
): void => {
  const stride = windowSize + 2;
  const input = makeInput(windowSize, stride);
  const buffer = device.createBuffer({
    label: 'batch-range-rejected-in-place',
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
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  try {
    expect(() => {
      fourier.dispatch(pass, range);
    }).toThrow(RangeError);
  } finally {
    pass.end();
    buffer.destroy();
    fourierCell.dispose();
  }
};

const targetedBatches = (
  batchRanges: readonly FourierBatchRange[],
): Set<number> => {
  const targeted = new Set<number>();
  for (const range of batchRanges) {
    for (let k = 0; k < range.batchCount; k += 1) {
      targeted.add(range.batchOffset + k);
    }
  }
  return targeted;
};

const expectOnlyTargetedTransformed = (
  ranged: Float32Array,
  full: Float32Array,
  input: Float32Array,
  stride: number,
  targeted: Set<number>,
): void => {
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

const batchRanges: FourierBatchRange[] = [
  { batchOffset: 1, batchCount: 2 },
  { batchOffset: 3, batchCount: 3 },
];

const createSingleBatchSubmits = (submitCount: number): FourierBatchRange[][] =>
  Array.from({ length: submitCount }, (_, index) => [
    { batchOffset: index % windowCount, batchCount: 1 },
  ]);

const fourierCases: {
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

describe('resolveFourierBatchRange', () => {
  it('defaults to the full range when no range is given', () => {
    expect(resolveFourierBatchRange(undefined, 8)).toEqual({
      batchOffset: 0,
      batchCount: 8,
    });
  });

  it('returns a valid range as-is', () => {
    const range = { batchOffset: 2, batchCount: 3 };
    expect(resolveFourierBatchRange(range, 8)).toBe(range);
  });

  it('allows an empty range at the end of the window span', () => {
    const resolved = resolveFourierBatchRange(
      { batchOffset: 8, batchCount: 0 },
      8,
    );
    expect(resolved).toEqual({ batchOffset: 8, batchCount: 0 });
  });

  it.each([
    { batchOffset: -1, batchCount: 2 },
    { batchOffset: 1, batchCount: -2 },
    { batchOffset: 0.5, batchCount: 2 },
    { batchOffset: 1, batchCount: 1.5 },
    { batchOffset: Number.NaN, batchCount: 2 },
    { batchOffset: 4, batchCount: 5 },
  ])('rejects ($batchOffset, $batchCount)', (range) => {
    expect(() => resolveFourierBatchRange(range, 8)).toThrow(RangeError);
  });
});

describe.each(fourierCases)('$label batch range', (fourierCase) => {
  describe.each([64, 1920, 2048, 4096])('size %i', (windowSize) => {
    const stride = windowSize + 2;
    const transformCase = async (
      selectedBatchRanges?: readonly FourierBatchRange[],
    ): Promise<Float32Array> =>
      transform(fourierCase.createFourier, windowSize, selectedBatchRanges);

    it.each(batchRanges)(
      'transforms only the targeted batches ($batchOffset, $batchCount)',
      async (range) => {
        const full = await transformCase();
        const ranged = await transformCase([range]);
        expectOnlyTargetedTransformed(
          ranged,
          full,
          makeInput(windowSize, stride),
          stride,
          targetedBatches([range]),
        );
      },
    );

    it('transforms every disjoint range issued in one submit', async () => {
      const multiRanges: FourierBatchRange[] = [
        { batchOffset: 1, batchCount: 2 },
        { batchOffset: 4, batchCount: 2 },
      ];
      const full = await transformCase();
      const ranged = await transformCase(multiRanges);
      expectOnlyTargetedTransformed(
        ranged,
        full,
        makeInput(windowSize, stride),
        stride,
        targetedBatches(multiRanges),
      );
    });

    it('treats a zero-count range as a no-op', async () => {
      const untouched = await transformCase([
        { batchOffset: 2, batchCount: 0 },
      ]);
      const input = makeInput(windowSize, stride);
      expectOnlyTargetedTransformed(untouched, input, input, stride, new Set());
    });
  });

  describe.each([64, 2048])('size %i out-of-place', (windowSize) => {
    const stride = windowSize + 2;
    const zeros = new Float32Array(stride * windowCount);

    it('transforms only the targeted batches', async () => {
      const range: FourierBatchRange = { batchOffset: 1, batchCount: 3 };
      const full = await transformOutOfPlace(
        fourierCase.createFourier,
        windowSize,
      );
      const ranged = await transformOutOfPlace(
        fourierCase.createFourier,
        windowSize,
        [[range]],
      );
      expectOnlyTargetedTransformed(
        ranged,
        full,
        zeros,
        stride,
        targetedBatches([range]),
      );
    });

    it('reuses ring slots correctly across submits', async () => {
      const rangesPerSubmit = createSingleBatchSubmits(windowCount + 3);
      const full = await transformOutOfPlace(
        fourierCase.createFourier,
        windowSize,
      );
      const ranged = await transformOutOfPlace(
        fourierCase.createFourier,
        windowSize,
        rangesPerSubmit,
      );
      expectOnlyTargetedTransformed(
        ranged,
        full,
        zeros,
        stride,
        targetedBatches(rangesPerSubmit.flat()),
      );
    });
  });

  it('rejects wrapping batch ranges', () => {
    expectBatchRangeRejected(fourierCase.createFourier, 64, {
      batchOffset: 4,
      batchCount: 3,
    });
  });
});

describe('ifftPackedStockhamC2r batch range', () => {
  const supportedSizes = [64, 1920, 2048, 4096].filter(
    (windowSize) =>
      getPackedStockhamC2rVariant(device, { windowSize, windowCount }) !==
      undefined,
  );

  it('covers at least one window size on this adapter', () => {
    expect(supportedSizes.length).toBeGreaterThan(0);
  });

  describe.each(supportedSizes)('size %i', (windowSize) => {
    const zeros = new Float32Array(windowSize * windowCount);

    it.each(batchRanges)(
      'transforms only the targeted batches ($batchOffset, $batchCount)',
      async (range) => {
        const full = await inverseTransform(windowSize);
        const ranged = await inverseTransform(windowSize, [range]);
        expectOnlyTargetedTransformed(
          ranged,
          full,
          zeros,
          windowSize,
          targetedBatches([range]),
        );
      },
    );

    it('transforms every disjoint range issued in one submit', async () => {
      const multiRanges: FourierBatchRange[] = [
        { batchOffset: 1, batchCount: 2 },
        { batchOffset: 4, batchCount: 2 },
      ];
      const full = await inverseTransform(windowSize);
      const ranged = await inverseTransform(windowSize, multiRanges);
      expectOnlyTargetedTransformed(
        ranged,
        full,
        zeros,
        windowSize,
        targetedBatches(multiRanges),
      );
    });
  });

  it('rejects wrapping batch ranges', () => {
    const [windowSize] = supportedSizes;
    const spectrumStride = windowSize + 2;
    const spectrum = device.createBuffer({
      label: 'batch-range-c2r-rejected-spectrum',
      size: spectrumStride * windowCount * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const wave = device.createBuffer({
      label: 'batch-range-c2r-rejected-wave',
      size: windowSize * windowCount * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const fourierCell = createIfftPackedStockhamC2r(device);
    const fourier = fourierCell.get({
      wave,
      spectrum,
      config: { windowSize, windowCount },
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    try {
      expect(() => {
        fourier.dispatch(pass, { batchOffset: 4, batchCount: 3 });
      }).toThrow(RangeError);
    } finally {
      pass.end();
      wave.destroy();
      spectrum.destroy();
      fourierCell.dispose();
    }
  });
});
