import { type FourierBatchRange } from './types.js';

export const resolveFourierBatchRange = (
  range: FourierBatchRange | undefined,
  windowCount: number,
): FourierBatchRange => {
  if (!range) {
    return { batchOffset: 0, batchCount: windowCount };
  }
  const { batchOffset, batchCount } = range;
  if (!Number.isInteger(batchOffset)) {
    throw new RangeError(
      `Fourier batch range batchOffset must be a non-negative integer, got ${batchOffset}`,
    );
  }
  if (!Number.isInteger(batchCount)) {
    throw new RangeError(
      `Fourier batch range batchCount must be a non-negative integer, got ${batchCount}`,
    );
  }
  if (batchOffset + batchCount > windowCount) {
    throw new RangeError(
      `Fourier batch range batchOffset (${batchOffset}) + batchCount (${batchCount}) must be <= windowCount (${windowCount}), got ${batchOffset + batchCount}`,
    );
  }
  return range;
};
