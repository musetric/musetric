import { windowFunctions } from '@musetric/fft';
import { createGpuContext } from '@musetric/utils/gpu';
import { describe, expect, it } from 'vitest';
import {
  assertClose,
  buildConfig,
  createRamp,
  extendConfig,
  readFloats,
} from '../../__test__/common.js';
import {
  markInvalidatedColumns,
  markShiftColumns,
  toColumnRanges,
} from '../../common/columnRanges.js';
import {
  computeBaseColumn,
  type ExtSpectrogramConfig,
  floorMod,
  type SpectrogramColumnRange,
  windowStartForColumn,
} from '../../common/extConfig.js';
import { createSignalBufferCell } from '../../state/signal.js';
import { createSpectrogramSliceSamplesCell } from '../index.js';

const { device } = await createGpuContext();

type SliceHandle = ReturnType<
  ReturnType<typeof createSpectrogramSliceSamplesCell>['get']
>;

const windowSize = 8;
const width = 5;
const sampleRate = 16;
const columnStep = 4;
const signalStride = windowSize + 2;
const windowFunction = windowFunctions.hamming(windowSize);
const samples = createRamp(64);

const config = extendConfig(
  buildConfig({
    windowSize,
    zeroPaddingFactor: 1,
    windowName: 'hamming',
    sampleRate,
    visibleTime: 1,
    playheadRatio: 0,
    viewSize: { width, height: 4 },
  }),
);

const withSlice = async <T>(
  sliceConfig: ExtSpectrogramConfig,
  bandWindowSize: number,
  windowCount: number,
  fn: (slice: SliceHandle, signal: GPUBuffer) => Promise<T>,
): Promise<T> => {
  const signalCell = createSignalBufferCell(device);
  const sliceCell = createSpectrogramSliceSamplesCell(device);
  try {
    const signal = signalCell.get({ windowSize: bandWindowSize, windowCount });
    const slice = sliceCell.get({ out: signal, config: sliceConfig });
    return await fn(slice, signal);
  } finally {
    sliceCell.dispose();
    signalCell.dispose();
  }
};

const trackProgressForWindowStart = (windowStart: number): number =>
  (windowStart + windowSize) / samples.length;

const withTwoSlices = async <T>(
  sliceConfig: ExtSpectrogramConfig,
  bandWindowSize: number,
  windowCount: number,
  fn: (
    incremental: SliceHandle,
    incrementalSignal: GPUBuffer,
    full: SliceHandle,
    fullSignal: GPUBuffer,
  ) => Promise<T>,
): Promise<T> =>
  withSlice(
    sliceConfig,
    bandWindowSize,
    windowCount,
    async (incremental, incrementalSignal) =>
      withSlice(
        sliceConfig,
        bandWindowSize,
        windowCount,
        async (full, fullSignal) =>
          fn(incremental, incrementalSignal, full, fullSignal),
      ),
  );

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
  slice.write(samples, baseColumn, false, false, []);
  const encoder = device.createCommandEncoder();
  slice.run(encoder, range);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  return readFloats(device, signal, signalStride * width);
};

describe('sliceSamples', () => {
  it('writes windowed slices into the column ring from a fresh upload', async () => {
    await withSlice(config, windowSize, width, async (slice, signal) => {
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
    await withSlice(config, windowSize, width, async (slice, signal) => {
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

  it('matches a full slice for fractional-step scroll plus invalidation', async () => {
    const fractionalWidth = 7;
    const fractionalWindowSize = 16;
    const fractionalSignalStride = fractionalWindowSize + 2;
    const fractionalConfig = extendConfig(
      buildConfig({
        windowSize: fractionalWindowSize,
        zeroPaddingFactor: 1,
        windowName: 'hamming',
        sampleRate: 31,
        visibleTime: 1,
        playheadRatio: 0,
        viewSize: { width: fractionalWidth, height: 4 },
      }),
    );
    expect(Number.isInteger(fractionalConfig.columnStep)).toBe(false);

    const length = 256;
    const incrementalSamples = new Float32Array(length);
    const chunk = { frameIndex: 60, frameCount: 24 };

    const firstBase = computeBaseColumn(fractionalConfig, 0.3, length);
    const secondBase = firstBase + 2;
    const columns = new Array<boolean>(fractionalWidth).fill(false);
    markShiftColumns(columns, secondBase, firstBase);
    markInvalidatedColumns(
      columns,
      fractionalConfig,
      secondBase,
      fractionalWindowSize,
      [chunk],
    );
    const ranges = toColumnRanges(fractionalConfig, secondBase, columns);
    expect(ranges.length).toBeGreaterThan(1);

    const fullRangeAt = (baseColumn: number): SpectrogramColumnRange => ({
      screenBase: 0,
      slotOffset: floorMod(baseColumn, fractionalWidth),
      columnCount: fractionalWidth,
    });

    const dispatchRanges = async (
      slice: SliceHandle,
      columnRanges: readonly SpectrogramColumnRange[],
    ): Promise<void> => {
      const encoder = device.createCommandEncoder();
      const slicePass = encoder.beginComputePass();
      for (const range of columnRanges) {
        slice.dispatch(slicePass, range);
      }
      slicePass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    };

    await withTwoSlices(
      fractionalConfig,
      fractionalWindowSize,
      fractionalWidth,
      async (incremental, incrementalSignal, full, fullSignal) => {
        incremental.write(incrementalSamples, firstBase, false, true, []);
        await dispatchRanges(incremental, [fullRangeAt(firstBase)]);

        for (
          let index = chunk.frameIndex;
          index < chunk.frameIndex + chunk.frameCount;
          index += 1
        ) {
          incrementalSamples[index] = index / 100;
        }

        incremental.write(incrementalSamples, secondBase, false, false, [
          chunk,
        ]);
        await dispatchRanges(incremental, ranges);

        full.write(
          Float32Array.from(incrementalSamples),
          secondBase,
          false,
          true,
          [],
        );
        await dispatchRanges(full, [fullRangeAt(secondBase)]);

        const count = fractionalSignalStride * fractionalWidth;
        const incrementalResult = await readFloats(
          device,
          incrementalSignal,
          count,
        );
        const fullResult = await readFloats(device, fullSignal, count);
        assertClose('fractional partial slice', incrementalResult, fullResult);
      },
    );
  });
});
