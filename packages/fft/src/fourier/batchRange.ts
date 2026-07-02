import { type FourierBatchRange } from './types.js';

export const resolveFourierBatchRange = (
  range: FourierBatchRange | undefined,
  windowCount: number,
): FourierBatchRange => {
  if (!range) {
    return { batchOffset: 0, batchCount: windowCount };
  }
  const { batchOffset, batchCount } = range;
  if (batchOffset + batchCount > windowCount) {
    throw new RangeError(
      `Fourier batch range batchOffset (${batchOffset}) + batchCount (${batchCount}) must be <= windowCount (${windowCount}), got ${batchOffset + batchCount}`,
    );
  }
  return range;
};
