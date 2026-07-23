import { describe, expect, it } from 'vitest';
import { resolveFourierBatchRange } from '../batchRange.js';
import { createIfftPackedStockhamC2r } from '../fftPackedStockham/c2r/index.js';
import { getPackedStockhamC2rVariant } from '../fftPackedStockham/c2r/support.js';
import { type FourierBatchRange } from '../types.js';
import {
  batchRanges,
  createSingleBatchSubmits,
  device,
  expectDispatchThrows,
  expectOnlyTargetedTransformed,
  fourierCases,
  inverseTransform,
  makeInput,
  targetedBatches,
  transform,
  transformOutOfPlace,
  windowCount,
} from './batchRangeTestSetup.js';

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

  it('rejects a range that overruns the window span', () => {
    const range = { batchOffset: 4, batchCount: 5 };
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
        expectOnlyTargetedTransformed({
          ranged,
          full,
          input: makeInput(windowSize, stride),
          stride,
          targeted: targetedBatches([range]),
        });
      },
    );

    it('transforms every disjoint range issued in one submit', async () => {
      const multiRanges: FourierBatchRange[] = [
        { batchOffset: 1, batchCount: 2 },
        { batchOffset: 4, batchCount: 2 },
      ];
      const full = await transformCase();
      const ranged = await transformCase(multiRanges);
      expectOnlyTargetedTransformed({
        ranged,
        full,
        input: makeInput(windowSize, stride),
        stride,
        targeted: targetedBatches(multiRanges),
      });
    });

    it('treats a zero-count range as a no-op', async () => {
      const untouched = await transformCase([
        { batchOffset: 2, batchCount: 0 },
      ]);
      const input = makeInput(windowSize, stride);
      expectOnlyTargetedTransformed({
        ranged: untouched,
        full: input,
        input,
        stride,
        targeted: new Set(),
      });
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
      expectOnlyTargetedTransformed({
        ranged,
        full,
        input: zeros,
        stride,
        targeted: targetedBatches([range]),
      });
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
      expectOnlyTargetedTransformed({
        ranged,
        full,
        input: zeros,
        stride,
        targeted: targetedBatches(rangesPerSubmit.flat()),
      });
    });
  });

  it('rejects wrapping batch ranges', () => {
    const windowSize = 64;
    const stride = windowSize + 2;
    const buffer = device.createBuffer({
      label: 'batch-range-rejected-in-place',
      size: stride * windowCount * Float32Array.BYTES_PER_ELEMENT,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, makeInput(windowSize, stride));

    const fourierCell = fourierCase.createFourier(device);
    const fourier = fourierCell.get({
      wave: buffer,
      spectrum: buffer,
      config: { windowSize, windowCount },
    });
    try {
      expectDispatchThrows(fourier, { batchOffset: 4, batchCount: 3 });
    } finally {
      buffer.destroy();
      fourierCell.dispose();
    }
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
        expectOnlyTargetedTransformed({
          ranged,
          full,
          input: zeros,
          stride: windowSize,
          targeted: targetedBatches([range]),
        });
      },
    );

    it('transforms every disjoint range issued in one submit', async () => {
      const multiRanges: FourierBatchRange[] = [
        { batchOffset: 1, batchCount: 2 },
        { batchOffset: 4, batchCount: 2 },
      ];
      const full = await inverseTransform(windowSize);
      const ranged = await inverseTransform(windowSize, multiRanges);
      expectOnlyTargetedTransformed({
        ranged,
        full,
        input: zeros,
        stride: windowSize,
        targeted: targetedBatches(multiRanges),
      });
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
    try {
      expectDispatchThrows(fourier, { batchOffset: 4, batchCount: 3 });
    } finally {
      wave.destroy();
      spectrum.destroy();
      fourierCell.dispose();
    }
  });
});
