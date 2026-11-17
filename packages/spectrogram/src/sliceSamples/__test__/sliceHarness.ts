import { createGpuContext } from '@musetric/utils/gpu';
import { type ExtSpectrogramConfig } from '../../common/extConfig.js';
import { createSignalBufferCell } from '../../state/signal.js';
import {
  createSpectrogramSliceSamplesCell,
  type SpectrogramSliceSamples,
} from '../index.js';
import { createStateSamplesCell, type StateSamples } from '../samples.js';

export const { device } = await createGpuContext();

export type SliceHandle = Omit<SpectrogramSliceSamples, 'write'> & {
  write: (write: Omit<Parameters<StateSamples['write']>[0], 'config'>) => void;
};

export const withSlice = async <T>(
  sliceConfig: ExtSpectrogramConfig,
  fn: (slice: SliceHandle, signal: GPUBuffer) => Promise<T>,
  ringConfig: ExtSpectrogramConfig = sliceConfig,
): Promise<T> => {
  const signalCell = createSignalBufferCell(device);
  const ringCell = createStateSamplesCell(device);
  const sliceCell = createSpectrogramSliceSamplesCell(device);
  try {
    const signal = signalCell.get({
      windowSize: sliceConfig.windowSize * sliceConfig.zeroPaddingFactor,
      windowCount: sliceConfig.windowCount,
    });
    const ring = ringCell.get({
      ringLength: Math.ceil(
        ringConfig.visibleTime * ringConfig.sampleRate + ringConfig.windowSize,
      ),
    });
    const slice = sliceCell.get({
      out: signal,
      config: sliceConfig,
      samples: ring,
    });
    const write: SliceHandle['write'] = (options) => {
      const frame = ring.write({ ...options, config: ringConfig });
      slice.write({
        source: options.source,
        baseColumn: options.baseColumn,
        frame,
      });
    };
    return await fn({ ...slice, write }, signal);
  } finally {
    sliceCell.dispose();
    ringCell.dispose();
    signalCell.dispose();
  }
};

export const withTwoSlices = async <T>(
  sliceConfig: ExtSpectrogramConfig,
  fn: (
    incremental: SliceHandle,
    incrementalSignal: GPUBuffer,
    full: SliceHandle,
    fullSignal: GPUBuffer,
  ) => Promise<T>,
): Promise<T> =>
  withSlice(sliceConfig, async (incremental, incrementalSignal) =>
    withSlice(sliceConfig, async (full, fullSignal) =>
      fn(incremental, incrementalSignal, full, fullSignal),
    ),
  );
