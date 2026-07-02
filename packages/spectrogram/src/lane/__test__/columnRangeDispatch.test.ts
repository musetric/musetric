import { type Fourier, type FourierBatchRange } from '@musetric/fft/gpu';
import { describe, expect, it } from 'vitest';
import { type SpectrogramColumnRange } from '../../common/extConfig.js';
import { dispatchFourierColumnRange } from '../index.js';

type RecordedDispatch = FourierBatchRange | 'full';

const record = (): { fourier: Fourier; calls: RecordedDispatch[] } => {
  const calls: RecordedDispatch[] = [];
  const fourier: Fourier = {
    run: () => undefined,
    dispatch: (_pass, range) => {
      calls.push(range ? { ...range } : 'full');
    },
  };
  return { fourier, calls };
};

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const pass = {} as GPUComputePassEncoder;

const windowCount = 8;

const range = (
  slotOffset: number,
  columnCount: number,
): SpectrogramColumnRange => ({
  screenBase: 0,
  slotOffset,
  columnCount,
});

describe('dispatchFourierColumnRange', () => {
  it('skips empty ranges', () => {
    const { fourier, calls } = record();
    dispatchFourierColumnRange(fourier, pass, range(3, 0), windowCount);
    expect(calls).toEqual([]);
  });

  it('runs the full transform when the range covers the ring', () => {
    const { fourier, calls } = record();
    dispatchFourierColumnRange(fourier, pass, range(5, 8), windowCount);
    expect(calls).toEqual(['full']);
  });

  it('forwards a non-wrapping range as one batch', () => {
    const { fourier, calls } = record();
    dispatchFourierColumnRange(fourier, pass, range(2, 4), windowCount);
    expect(calls).toEqual([{ batchOffset: 2, batchCount: 4 }]);
  });

  it('splits a range crossing the ring seam into two batches', () => {
    const { fourier, calls } = record();
    dispatchFourierColumnRange(fourier, pass, range(6, 4), windowCount);
    expect(calls).toEqual([
      { batchOffset: 6, batchCount: 2 },
      { batchOffset: 0, batchCount: 2 },
    ]);
  });

  it('keeps a range ending exactly at the seam unsplit', () => {
    const { fourier, calls } = record();
    dispatchFourierColumnRange(fourier, pass, range(4, 4), windowCount);
    expect(calls).toEqual([{ batchOffset: 4, batchCount: 4 }]);
  });
});
