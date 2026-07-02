import { createBenchTimestamp, defaultBenchStatsConfig } from '@musetric/utils';
import type * as koffi from 'koffi';
import {
  benchConfig,
  createBenchWave,
  type FourierBenchDirection,
  type FourierBenchSummary,
  fourierComputeStats,
  fourierSelectRunsPerSample,
} from '../../src/fourier/__test__/bench.es.js';
import { checkCuda, checkCufft } from './cudaLibs.js';
import { measureBatch, type MeasureRunOptions } from './measurement.js';

const cudaMemcpyHostToDevice = 1;
const cufftR2c = 0x2a;
const cufftC2r = 0x2c;

const benchDirections: readonly FourierBenchDirection[] = [
  'forward',
  'inverse',
];

type MeasureStats = {
  mean: number;
  cv: number;
  sampleCount: number;
};

type MeasureOneOptions = {
  windowSize: number;
  windowCount: number;
  cudart: koffi.LibraryHandle;
  cufft: koffi.LibraryHandle;
  direction: FourierBenchDirection;
};

const measureOne = (options: MeasureOneOptions): MeasureStats | undefined => {
  const { windowSize, windowCount, cudart, cufft, direction } = options;

  const cudaMalloc = cudart.func(
    'int cudaMalloc(_Out_ void **devPtr, size_t size)',
  );
  const cudaFree = cudart.func('int cudaFree(void *devPtr)');
  const cudaMemcpy = cudart.func(
    'int cudaMemcpy(void *dst, void *src, size_t count, int kind)',
  );
  const cudaGetErrorString = cudart.func(
    'const char *cudaGetErrorString(int error)',
  );
  const cufftPlanMany = cufft.func(
    'int cufftPlanMany(_Out_ int *plan, int rank, int *n, int *inembed, int istride, int idist, int *onembed, int ostride, int odist, int type, int batch)',
  );
  const cufftDestroy = cufft.func('int cufftDestroy(int plan)');

  // Forward R2C: real (windowSize) -> complex (N/2+1). Inverse C2R reverses it.
  const positiveSize = Math.floor(windowSize / 2) + 1;
  const inverse = direction === 'inverse';
  const input = inverse
    ? createBenchWave(2 * positiveSize, windowCount)
    : createBenchWave(windowSize, windowCount);
  const outputBytes = inverse
    ? windowSize * windowCount * 4
    : positiveSize * windowCount * 8;
  const checkCudaAt = (error: number, stage: string): boolean =>
    checkCuda(error, stage, cudaGetErrorString);

  // eslint-disable-next-line musetric/no-null-literal
  const deviceInput: Array<bigint | null> = [null];
  // eslint-disable-next-line musetric/no-null-literal
  const deviceOutput: Array<bigint | null> = [null];

  let planCreated = false;
  const plan = [0];

  try {
    if (
      !checkCudaAt(
        cudaMalloc(deviceInput, input.byteLength),
        'cudaMalloc(input)',
      )
    ) {
      return undefined;
    }
    if (
      !checkCudaAt(cudaMalloc(deviceOutput, outputBytes), 'cudaMalloc(output)')
    ) {
      return undefined;
    }
    if (
      !checkCudaAt(
        cudaMemcpy(
          deviceInput[0],
          input,
          input.byteLength,
          cudaMemcpyHostToDevice,
        ),
        'cudaMemcpy(input)',
      )
    ) {
      return undefined;
    }

    const n = Int32Array.of(windowSize);
    const inembed = Int32Array.of(inverse ? positiveSize : windowSize);
    const onembed = Int32Array.of(inverse ? windowSize : positiveSize);
    const idist = inverse ? positiveSize : windowSize;
    const odist = inverse ? windowSize : positiveSize;
    const cufftType = inverse ? cufftC2r : cufftR2c;

    if (
      !checkCufft(
        cufftPlanMany(
          plan,
          1,
          n,
          inembed,
          1,
          idist,
          onembed,
          1,
          odist,
          cufftType,
          windowCount,
        ),
        'cufftPlanMany',
      )
    ) {
      return undefined;
    }
    planCreated = true;

    const values: number[] = [];
    let runsPerSample = 1;
    const runOptions: MeasureRunOptions = {
      plan: plan[0],
      deviceInput: deviceInput[0],
      deviceOutput: deviceOutput[0],
      cudart,
      cufft,
      runsPerSample,
      direction,
    };

    for (
      let tryIndex = 0;
      tryIndex < defaultBenchStatsConfig.maxTries;
      tryIndex++
    ) {
      const batch = measureBatch({ ...runOptions, runsPerSample });

      if (batch.length === 0) {
        return undefined;
      }

      if (tryIndex === 0) {
        runsPerSample = fourierSelectRunsPerSample(batch);
        continue;
      }

      values.push(...batch);

      const { cv } = fourierComputeStats(values);

      if (cv <= defaultBenchStatsConfig.stableCvPercent) {
        console.log(`cuFFT ${windowCount} ${windowSize} cv=${cv.toFixed(1)}%`);
        break;
      }

      console.log(
        `cuFFT ${windowCount} ${windowSize} cv=${cv.toFixed(1)}% batch=${tryIndex}/${defaultBenchStatsConfig.maxTries - 1}`,
      );
    }

    return fourierComputeStats(values);
  } finally {
    if (planCreated) cufftDestroy(plan[0]);
    // eslint-disable-next-line musetric/no-null-literal
    if (deviceInput[0] !== null) cudaFree(deviceInput[0]);
    // eslint-disable-next-line musetric/no-null-literal
    if (deviceOutput[0] !== null) cudaFree(deviceOutput[0]);
  }
};

type MeasureSeries = {
  means: number[];
  cvs: number[];
  sampleCounts: number[];
};

const collectMeasureResult = (
  result: MeasureStats | undefined,
  series: MeasureSeries,
): boolean => {
  if (!result) {
    series.means.push(Number.NaN);
    series.cvs.push(Number.NaN);
    series.sampleCounts.push(0);
    return false;
  }

  series.means.push(result.mean);
  series.cvs.push(result.cv);
  series.sampleCounts.push(result.sampleCount);
  return true;
};

type SummarizeOptions = {
  direction: FourierBenchDirection;
  windowCount: number;
  cudart: koffi.LibraryHandle;
  cufft: koffi.LibraryHandle;
  timestamp: string;
};

const summarizeWindowCount = (
  options: SummarizeOptions,
): FourierBenchSummary | undefined => {
  const windowSizes: number[] = [];
  const series: MeasureSeries = { means: [], cvs: [], sampleCounts: [] };
  let hasSupportedResult = false;

  for (const windowSize of benchConfig.windowSizes) {
    windowSizes.push(windowSize);

    const supported = collectMeasureResult(
      measureOne({
        windowSize,
        windowCount: options.windowCount,
        cudart: options.cudart,
        cufft: options.cufft,
        direction: options.direction,
      }),
      series,
    );
    hasSupportedResult ||= supported;
  }

  if (!hasSupportedResult) {
    return undefined;
  }

  return {
    timestamp: options.timestamp,
    direction: options.direction,
    count: options.windowCount,
    mode: 'cufft',
    modeLabel: 'cuFFT',
    windowSizes,
    means: series.means,
    cvs: series.cvs,
    sampleCount: Math.max(...series.sampleCounts),
  };
};

export const runBenchmark = (
  cudart: koffi.LibraryHandle,
  cufft: koffi.LibraryHandle,
): FourierBenchSummary[] => {
  const timestamp = createBenchTimestamp();
  const results: FourierBenchSummary[] = [];

  for (const direction of benchDirections) {
    for (const windowCount of benchConfig.windowCounts) {
      const summary = summarizeWindowCount({
        direction,
        windowCount,
        cudart,
        cufft,
        timestamp,
      });
      if (summary) {
        results.push(summary);
      }
    }
  }

  return results;
};
