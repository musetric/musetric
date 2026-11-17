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
  floorMod,
  type SpectrogramColumnRange,
} from '../../common/extConfig.js';
import { toSpectrogramSource } from '../../common/source.js';
import {
  device,
  type SliceHandle,
  withSlice,
  withTwoSlices,
} from './sliceHarness.js';

describe('sliceSamples with a fractional column step', () => {
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
    markInvalidatedColumns({
      columns,
      grid: fractionalConfig,
      baseColumn: secondBase,
      analysisWindowSize: fractionalWindowSize,
      invalidations: [chunk],
    });
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
      async (incremental, incrementalSignal, full, fullSignal) => {
        incremental.write({
          source: toSpectrogramSource(incrementalSamples),
          baseColumn: firstBase,
          playheadRatio: 0,
          truncateAfterPlayhead: false,
          forceFullUpload: true,
          invalidations: [],
        });
        await dispatchRanges(incremental, [fullRangeAt(firstBase)]);

        for (
          let index = chunk.frameIndex;
          index < chunk.frameIndex + chunk.frameCount;
          index += 1
        ) {
          incrementalSamples[index] = index / 100;
        }

        incremental.write({
          source: toSpectrogramSource(incrementalSamples),
          baseColumn: secondBase,
          playheadRatio: 0,
          truncateAfterPlayhead: false,
          forceFullUpload: false,
          invalidations: [chunk],
        });
        await dispatchRanges(incremental, ranges);

        full.write({
          source: toSpectrogramSource(Float32Array.from(incrementalSamples)),
          baseColumn: secondBase,
          playheadRatio: 0,
          truncateAfterPlayhead: false,
          forceFullUpload: true,
          invalidations: [],
        });
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

  it('keeps partial sample uploads byte-aligned for fractional visible time', async () => {
    const fractionalVisibleConfig = extendConfig(
      buildConfig({
        windowSize: 16,
        zeroPaddingFactor: 1,
        windowName: 'hamming',
        sampleRate: 31,
        visibleTime: 1.05,
        playheadRatio: 0,
        viewSize: { width: 7, height: 4 },
      }),
    );
    const sampleData = createRamp(256);
    const firstBase = computeBaseColumn(fractionalVisibleConfig, 0.3, 256);
    const secondBase = firstBase + 1;

    await withSlice(fractionalVisibleConfig, async (slice) => {
      device.pushErrorScope('validation');
      slice.write({
        source: toSpectrogramSource(sampleData),
        baseColumn: firstBase,
        playheadRatio: 0,
        truncateAfterPlayhead: false,
        forceFullUpload: true,
        invalidations: [],
      });
      slice.write({
        source: toSpectrogramSource(sampleData),
        baseColumn: secondBase,
        playheadRatio: 0,
        truncateAfterPlayhead: false,
        forceFullUpload: false,
        invalidations: [],
      });

      const error = await device.popErrorScope();
      expect(error?.message).toBeUndefined();
    });
  });
});
