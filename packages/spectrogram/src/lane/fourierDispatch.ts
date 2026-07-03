import { type Fourier } from '@musetric/fft/gpu';
import { type SpectrogramColumnRange } from '../common/extConfig.js';

export const dispatchFourierColumnRange = (
  fourier: Fourier,
  pass: GPUComputePassEncoder,
  range: SpectrogramColumnRange,
  windowCount: number,
): void => {
  if (range.columnCount <= 0) {
    return;
  }
  if (range.columnCount >= windowCount) {
    fourier.dispatch(pass);
    return;
  }
  const firstBatchCount = Math.min(
    range.columnCount,
    windowCount - range.slotOffset,
  );
  if (firstBatchCount > 0) {
    fourier.dispatch(pass, {
      batchOffset: range.slotOffset,
      batchCount: firstBatchCount,
    });
  }
  const secondBatchCount = range.columnCount - firstBatchCount;
  if (secondBatchCount > 0) {
    fourier.dispatch(pass, {
      batchOffset: 0,
      batchCount: secondBatchCount,
    });
  }
};
