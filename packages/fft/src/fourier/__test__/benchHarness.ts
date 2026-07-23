import { createBenchTimestamp, defaultBenchStatsConfig } from '@musetric/utils';
import { createGpuContext } from '@musetric/utils/gpu';
import { type FourierMode, type IFourierMode } from '../config.es.js';
import { getPackedStockhamC2rVariant } from '../fftPackedStockham/c2r/support.js';
import { fouriers } from '../fouriers.js';
import { iffts } from '../iffts.js';
import { type Fourier, type FourierBatchRange } from '../types.js';
import {
  createBenchWave,
  fourierComputeStats,
  fourierModeLabels,
  fourierSelectRunsPerSample,
} from './bench.es.js';
import { isFourierModeSupported } from './fourierModeSupport.js';

export type GpuTimer = {
  querySet: GPUQuerySet;
  resolveBuffer: GPUBuffer;
  readBuffer: GPUBuffer;
  resolve: (encoder: GPUCommandEncoder) => void;
  read: () => Promise<number[]>;
  dispose: () => void;
};

export const createGpuTimer = (device: GPUDevice, count: number): GpuTimer => {
  const size = count * BigUint64Array.BYTES_PER_ELEMENT;

  const querySet = device.createQuerySet({ type: 'timestamp', count });
  const resolveBuffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const readBuffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  return {
    querySet,
    resolveBuffer,
    readBuffer,
    resolve: (encoder) => {
      encoder.resolveQuerySet(querySet, 0, count, resolveBuffer, 0);
      encoder.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, size);
    },
    read: async () => {
      await readBuffer.mapAsync(GPUMapMode.READ);
      const raw = new BigUint64Array(readBuffer.getMappedRange());
      const durations: number[] = [];

      for (let i = 0; i < count / 2; i++) {
        const start = raw[i * 2];
        const end = raw[i * 2 + 1];
        durations.push(Number(end - start) / 1e6);
      }

      readBuffer.unmap();
      return durations;
    },
    dispose: () => {
      querySet.destroy();
      resolveBuffer.destroy();
      readBuffer.destroy();
    },
  };
};

export type MeasureBatchOptions = {
  encoder: GPUCommandEncoder;
  timer: GpuTimer;
  fourier: Fourier;
  runsPerSample: number;
  ranges?: readonly FourierBatchRange[];
};

export const measureBatch = (options: MeasureBatchOptions): void => {
  const { encoder, timer, fourier, runsPerSample, ranges } = options;

  const dispatchOnce = (pass: GPUComputePassEncoder) => {
    if (ranges) {
      for (const range of ranges) {
        fourier.dispatch(pass, range);
      }
    } else {
      fourier.dispatch(pass);
    }
  };

  for (let i = 0; i < defaultBenchStatsConfig.batchSize; i++) {
    const marker: GPUComputePassTimestampWrites = {
      querySet: timer.querySet,
      beginningOfPassWriteIndex: i * 2,
      endOfPassWriteIndex: i * 2 + 1,
    };

    const pass = encoder.beginComputePass({ timestampWrites: marker });
    for (let runIndex = 0; runIndex < runsPerSample; runIndex++) {
      dispatchOnce(pass);
    }
    pass.end();
  }
};

export const { device } = await createGpuContext(true);

export const createPaddedBenchWave = (
  windowSize: number,
  windowCount: number,
): Float32Array<ArrayBuffer> => {
  const input = createBenchWave(windowSize, windowCount);
  const output = new Float32Array((windowSize + 2) * windowCount);

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    const inputOffset = windowSize * windowIndex;
    const outputOffset = (windowSize + 2) * windowIndex;
    output.set(
      input.subarray(inputOffset, inputOffset + windowSize),
      outputOffset,
    );
  }

  return output;
};

export const createBenchSpectrum = (
  windowSize: number,
  windowCount: number,
): Float32Array<ArrayBuffer> =>
  new Float32Array(createBenchWave(windowSize + 2, windowCount));

export type MeasureOneOptions = {
  logLabel: string;
  ranges: readonly FourierBatchRange[];
};

export const measureOne = async (
  mode: FourierMode,
  windowSize: number,
  windowCount: number,
  options?: MeasureOneOptions,
): Promise<
  | {
      mean: number;
      cv: number;
      sampleCount: number;
    }
  | undefined
> => {
  if (!isFourierModeSupported(device, mode, { windowSize, windowCount })) {
    return undefined;
  }

  const byteSize =
    (windowSize + 2) * windowCount * Float32Array.BYTES_PER_ELEMENT;
  const input = createPaddedBenchWave(windowSize, windowCount);

  const signal = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(signal, 0, input);

  const cell = fouriers[mode](device);

  const values: number[] = [];
  let runsPerSample = 1;

  for (
    let tryIndex = 0;
    tryIndex < defaultBenchStatsConfig.maxTries;
    tryIndex++
  ) {
    const fourier = cell.get({
      wave: signal,
      spectrum: signal,
      config: { windowSize, windowCount },
    });

    const timer = createGpuTimer(device, defaultBenchStatsConfig.batchSize * 2);
    const encoder = device.createCommandEncoder();

    measureBatch({
      encoder,
      timer,
      fourier,
      runsPerSample,
      ranges: options?.ranges,
    });

    timer.resolve(encoder);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    const durations = (await timer.read()).map(
      (duration) => duration / runsPerSample,
    );
    timer.dispose();

    if (tryIndex === 0) {
      runsPerSample = fourierSelectRunsPerSample(durations);
      if (options?.ranges) {
        const dispatchesPerRun =
          defaultBenchStatsConfig.batchSize * options.ranges.length;
        runsPerSample = Math.max(
          1,
          Math.min(runsPerSample, Math.floor(windowCount / dispatchesPerRun)),
        );
      }
      continue;
    }

    values.push(...durations);

    const { cv } = fourierComputeStats(values);

    if (cv <= defaultBenchStatsConfig.stableCvPercent) {
      console.log(
        `${options?.logLabel ?? fourierModeLabels[mode]} ${windowCount} ${windowSize} cv=${cv.toFixed(1)}%`,
      );
      break;
    }

    console.log(
      `${options?.logLabel ?? fourierModeLabels[mode]} ${windowCount} ${windowSize} cv=${cv.toFixed(1)}% batch=${tryIndex}/${defaultBenchStatsConfig.maxTries - 1}`,
    );
  }

  cell.dispose();
  signal.destroy();

  return fourierComputeStats(values);
};

export const measureOneInverse = async (
  mode: IFourierMode,
  windowSize: number,
  windowCount: number,
): Promise<
  | {
      mean: number;
      cv: number;
      sampleCount: number;
    }
  | undefined
> => {
  if (
    getPackedStockhamC2rVariant(device, { windowSize, windowCount }) ===
    undefined
  ) {
    return undefined;
  }

  const spectrumBytes =
    (windowSize + 2) * windowCount * Float32Array.BYTES_PER_ELEMENT;
  const waveBytes = windowSize * windowCount * Float32Array.BYTES_PER_ELEMENT;

  const spectrum = device.createBuffer({
    size: spectrumBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const wave = device.createBuffer({
    size: waveBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(
    spectrum,
    0,
    createBenchSpectrum(windowSize, windowCount),
  );

  const cell = iffts[mode](device);

  const values: number[] = [];
  let runsPerSample = 1;

  for (
    let tryIndex = 0;
    tryIndex < defaultBenchStatsConfig.maxTries;
    tryIndex++
  ) {
    const fourier = cell.get({
      wave,
      spectrum,
      config: { windowSize, windowCount },
    });

    const timer = createGpuTimer(device, defaultBenchStatsConfig.batchSize * 2);
    const encoder = device.createCommandEncoder();

    measureBatch({ encoder, timer, fourier, runsPerSample });

    timer.resolve(encoder);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    const durations = (await timer.read()).map(
      (duration) => duration / runsPerSample,
    );
    timer.dispose();

    if (tryIndex === 0) {
      runsPerSample = fourierSelectRunsPerSample(durations);
      continue;
    }

    values.push(...durations);

    const { cv } = fourierComputeStats(values);

    if (cv <= defaultBenchStatsConfig.stableCvPercent) {
      console.log(
        `i${fourierModeLabels[mode]} ${windowCount} ${windowSize} cv=${cv.toFixed(1)}%`,
      );
      break;
    }

    console.log(
      `i${fourierModeLabels[mode]} ${windowCount} ${windowSize} cv=${cv.toFixed(1)}% batch=${tryIndex}/${defaultBenchStatsConfig.maxTries - 1}`,
    );
  }

  cell.dispose();
  spectrum.destroy();
  wave.destroy();

  return fourierComputeStats(values);
};

export const benchTimestamp = createBenchTimestamp();
