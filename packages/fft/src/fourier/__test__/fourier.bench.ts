import { createGpuContext } from '@musetric/resource-utils/gpu';
import { describe, it } from 'vitest';
import { allFourierModes, type FourierMode } from '../config.es.js';
import { fouriers } from '../fouriers.js';
import { type Fourier } from '../types.js';
import {
  benchBatchSize,
  benchMaxTries,
  benchStableCvPercent,
  benchWindowCounts,
  benchWindowSizes,
  computeBenchStats,
  createBenchTimestamp,
  createBenchWave,
  type FourierBenchSummary,
  fourierModeLabels,
  selectBenchRunsPerSample,
} from './bench.es.js';
import { isFourierModeSupported } from './fourierModeSupport.js';

type GpuTimer = {
  querySet: GPUQuerySet;
  resolveBuffer: GPUBuffer;
  readBuffer: GPUBuffer;
  resolve: (encoder: GPUCommandEncoder) => void;
  read: () => Promise<number[]>;
  dispose: () => void;
};

const createGpuTimer = (device: GPUDevice, count: number): GpuTimer => {
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

const measureBatch = (
  encoder: GPUCommandEncoder,
  timer: GpuTimer,
  fourier: Fourier,
  runsPerSample: number,
): void => {
  for (let i = 0; i < benchBatchSize; i++) {
    const marker: GPUComputePassTimestampWrites = {
      querySet: timer.querySet,
      beginningOfPassWriteIndex: i * 2,
      endOfPassWriteIndex: i * 2 + 1,
    };

    const pass = encoder.beginComputePass({ timestampWrites: marker });
    for (let runIndex = 0; runIndex < runsPerSample; runIndex++) {
      fourier.dispatch(pass);
    }
    pass.end();
  }
};

const { device } = await createGpuContext(true);

const measureOne = async (
  mode: FourierMode,
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
  if (!isFourierModeSupported(device, mode, { windowSize, windowCount })) {
    return undefined;
  }

  const byteSize = windowSize * windowCount * Float32Array.BYTES_PER_ELEMENT;
  const input = createBenchWave(windowSize, windowCount);

  const real = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const imag = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(real, 0, input);
  device.queue.writeBuffer(imag, 0, new Float32Array(windowSize * windowCount));

  const cell = fouriers[mode](device);

  const values: number[] = [];
  let runsPerSample = 1;

  for (let tryIndex = 0; tryIndex < benchMaxTries; tryIndex++) {
    const fourier = cell.get({
      wave: real,
      spectrum: { real, imag },
      config: { windowSize, windowCount },
    });

    const timer = createGpuTimer(device, benchBatchSize * 2);
    const encoder = device.createCommandEncoder();

    measureBatch(encoder, timer, fourier, runsPerSample);

    timer.resolve(encoder);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    const durations = (await timer.read()).map(
      (duration) => duration / runsPerSample,
    );
    timer.dispose();

    if (tryIndex === 0) {
      runsPerSample = selectBenchRunsPerSample(durations);
      continue;
    }

    values.push(...durations);

    const { cv } = computeBenchStats(values);

    if (cv <= benchStableCvPercent) {
      console.log(
        `${fourierModeLabels[mode]} ${windowCount} ${windowSize} cv=${cv.toFixed(1)}%`,
      );
      break;
    }

    console.log(
      `${fourierModeLabels[mode]} ${windowCount} ${windowSize} cv=${cv.toFixed(1)}% batch=${tryIndex}/${benchMaxTries - 1}`,
    );
  }

  cell.dispose();
  real.destroy();
  imag.destroy();

  return computeBenchStats(values);
};

const benchTimestamp = createBenchTimestamp();

describe('FFT benchmarks', () => {
  for (const windowCount of benchWindowCounts) {
    for (const mode of allFourierModes) {
      const modeLabel = fourierModeLabels[mode];

      it(`count ${windowCount} ${modeLabel}`, async (context) => {
        const { task } = context;
        const means: number[] = [];
        const cvs: number[] = [];
        const sampleCounts: number[] = [];

        for (const windowSize of benchWindowSizes) {
          const result = await measureOne(mode, windowSize, windowCount);

          if (result) {
            means.push(result.mean);
            cvs.push(result.cv);
            sampleCounts.push(result.sampleCount);
          } else {
            means.push(Number.NaN);
            cvs.push(Number.NaN);
            sampleCounts.push(0);
          }
        }

        const maxSampleCount = Math.max(...sampleCounts);

        const bench: FourierBenchSummary = {
          timestamp: benchTimestamp,
          count: windowCount,
          mode,
          modeLabel,
          windowSizes: benchWindowSizes,
          means,
          cvs,
          sampleCount: maxSampleCount,
        };

        Object.assign(task.meta, { bench });
      });
    }
  }
});
