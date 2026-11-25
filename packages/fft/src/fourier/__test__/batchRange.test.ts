import { describe, expect, it } from 'vitest';
import { createIfftPackedStockhamC2r } from '../fftPackedStockham/c2r/index.js';
import { getPackedStockhamC2rVariant } from '../fftPackedStockham/c2r/support.js';
import { type FourierBatchRange } from '../types.js';
import {
  batchRanges,
  createSingleBatchSubmits,
  device,
  expectOnlyTargetedTransformed,
  fourierCases,
  inverseTransform,
  makeInput,
  targetedBatches,
  transform,
  transformOutOfPlace,
  windowCount,
} from './batchRangeTestSetup.js';

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

    it('keeps every window at the spectrum stride in place', async () => {
      const stride = windowSize + 2;
      const outOfPlace = await inverseTransform(windowSize);
      const inPlace = await transform(createIfftPackedStockhamC2r, windowSize);
      for (let w = 0; w < windowCount; w += 1) {
        for (let i = 0; i < windowSize; i += 1) {
          expect(inPlace[w * stride + i], `window ${w} index ${i}`).toBeCloseTo(
            outOfPlace[w * windowSize + i],
            3,
          );
        }
      }
    });

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
});
