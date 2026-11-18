import { windowFunctions } from '@musetric/fft';
import { describe, expect, it } from 'vitest';
import {
  assertClose,
  buildConfig,
  createRamp,
  extendConfig,
  readFloats,
} from '../../__test__/common.js';
import {
  computeBaseColumn,
  floorMod,
  type SpectrogramColumnRange,
  windowStartForColumn,
} from '../../common/extConfig.js';
import { toSpectrogramSource } from '../../common/source.js';
import { device, type SliceHandle, withSlice } from './sliceHarness.js';

const windowSize = 8;
const width = 5;
const sampleRate = 16;
const columnStep = 4;
const signalStride = windowSize + 2;
const windowFunction = windowFunctions.hamming(windowSize);
const samples = createRamp(64);

const buildSliceConfig = (sliceWindowSize: number) =>
  extendConfig(
    buildConfig({
      windowSize: sliceWindowSize,
      zeroPaddingFactor: 1,
      windowName: 'hamming',
      sampleRate,
      visibleTime: 1,
      playheadRatio: 0,
      viewSize: { width, height: 4 },
    }),
  );

const config = buildSliceConfig(windowSize);

const trackProgressForWindowStart = (windowStart: number): number =>
  (windowStart + windowSize) / samples.length;

const slotOf = (baseColumn: number, screenColumn: number): number =>
  floorMod(baseColumn + screenColumn, width);

const assertColumns = (
  actual: Float32Array,
  windowStart: number,
  baseColumn: number,
): void => {
  for (let w = 0; w < width; w += 1) {
    const expected = new Float32Array(windowSize);
    for (let i = 0; i < windowSize; i += 1) {
      expected[i] = (windowStart + columnStep * w + i) * windowFunction[i];
    }
    const offset = signalStride * slotOf(baseColumn, w);
    assertClose(
      `column ${w}`,
      actual.slice(offset, offset + windowSize),
      expected,
    );
  }
};

const fullRange = (baseColumn: number): SpectrogramColumnRange => ({
  screenBase: 0,
  slotOffset: floorMod(baseColumn, width),
  columnCount: width,
});

const runSlice = async (
  slice: SliceHandle,
  signal: GPUBuffer,
  baseColumn: number,
  range: SpectrogramColumnRange,
): Promise<Float32Array> => {
  slice.write({
    source: toSpectrogramSource(samples),
    baseColumn,
    playheadRatio: 0,
    truncateAfterPlayhead: false,
    forceFullUpload: false,
    invalidations: [],
  });
  const encoder = device.createCommandEncoder();
  slice.run(encoder, range);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  return readFloats(device, signal, signalStride * width);
};

describe('sliceSamples', () => {
  it('writes windowed slices into the column ring from a fresh upload', async () => {
    await withSlice(config, async (slice, signal) => {
      const baseColumn = computeBaseColumn(
        config,
        trackProgressForWindowStart(0),
        samples.length,
      );
      const windowStart = windowStartForColumn(config, windowSize, baseColumn);
      const result = await runSlice(
        slice,
        signal,
        baseColumn,
        fullRange(baseColumn),
      );
      assertColumns(result, windowStart, baseColumn);
    });
  });

  it('reuses the ring and only re-slices the exposed column after a scroll', async () => {
    await withSlice(config, async (slice, signal) => {
      const firstBase = computeBaseColumn(
        config,
        trackProgressForWindowStart(0),
        samples.length,
      );
      const first = await runSlice(
        slice,
        signal,
        firstBase,
        fullRange(firstBase),
      );
      assertColumns(
        first,
        windowStartForColumn(config, windowSize, firstBase),
        firstBase,
      );

      const secondBase = computeBaseColumn(
        config,
        trackProgressForWindowStart(columnStep),
        samples.length,
      );
      const delta = secondBase - firstBase;
      expect(delta).toBe(1);
      const exposed: SpectrogramColumnRange = {
        screenBase: width - delta,
        slotOffset: floorMod(secondBase + width - delta, width),
        columnCount: delta,
      };
      const second = await runSlice(slice, signal, secondBase, exposed);
      assertColumns(
        second,
        windowStartForColumn(config, windowSize, secondBase),
        secondBase,
      );

      expect(second).not.toStrictEqual(first);
    });
  });

  it('slices a narrower band from a ring sized for a wider one', async () => {
    await withSlice(
      config,
      async (slice, signal) => {
        const baseColumn = computeBaseColumn(
          config,
          trackProgressForWindowStart(16),
          samples.length,
        );
        const result = await runSlice(
          slice,
          signal,
          baseColumn,
          fullRange(baseColumn),
        );
        assertColumns(
          result,
          windowStartForColumn(config, windowSize, baseColumn),
          baseColumn,
        );
      },
      buildSliceConfig(2 * windowSize),
    );
  });
});
