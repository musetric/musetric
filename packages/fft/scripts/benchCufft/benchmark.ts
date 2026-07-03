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

type ForeignFunction = ReturnType<koffi.LibraryHandle['func']>;

type CudaFunctions = {
  malloc: ForeignFunction;
  free: ForeignFunction;
  memcpy: ForeignFunction;
  getErrorString: ForeignFunction;
};

type CufftFunctions = {
  planMany: ForeignFunction;
  destroy: ForeignFunction;
};

type DirectionSpec = {
  input: Float32Array;
  outputBytes: number;
  n: Int32Array;
  inembed: Int32Array;
  onembed: Int32Array;
  idist: number;
  odist: number;
  cufftType: number;
};

type AllocateBuffersOptions = {
  cuda: CudaFunctions;
  check: (error: number, stage: string) => boolean;
  input: Float32Array;
  outputBytes: number;
  deviceInput: Array<bigint | null>;
  deviceOutput: Array<bigint | null>;
};

type RunMeasurementsOptions = {
  plan: number;
  deviceInput: bigint;
  deviceOutput: bigint;
  cudart: koffi.LibraryHandle;
  cufft: koffi.LibraryHandle;
  direction: FourierBenchDirection;
  windowCount: number;
  windowSize: number;
};

const createCudaFunctions = (cudart: koffi.LibraryHandle): CudaFunctions => ({
  malloc: cudart.func('int cudaMalloc(_Out_ void **devPtr, size_t size)'),
  free: cudart.func('int cudaFree(void *devPtr)'),
  memcpy: cudart.func(
    'int cudaMemcpy(void *dst, void *src, size_t count, int kind)',
  ),
  getErrorString: cudart.func('const char *cudaGetErrorString(int error)'),
});

const createCufftFunctions = (cufft: koffi.LibraryHandle): CufftFunctions => ({
  planMany: cufft.func(
    'int cufftPlanMany(_Out_ int *plan, int rank, int *n, int *inembed, int istride, int idist, int *onembed, int ostride, int odist, int type, int batch)',
  ),
  destroy: cufft.func('int cufftDestroy(int plan)'),
});

const computeDirectionSpec = (
  windowSize: number,
  windowCount: number,
  inverse: boolean,
): DirectionSpec => {
  // Forward R2C: real (windowSize) -> complex (N/2+1). Inverse C2R reverses it.
  const positiveSize = Math.floor(windowSize / 2) + 1;
  return {
    input: inverse
      ? createBenchWave(2 * positiveSize, windowCount)
      : createBenchWave(windowSize, windowCount),
    outputBytes: inverse
      ? windowSize * windowCount * 4
      : positiveSize * windowCount * 8,
    n: Int32Array.of(windowSize),
    inembed: Int32Array.of(inverse ? positiveSize : windowSize),
    onembed: Int32Array.of(inverse ? windowSize : positiveSize),
    idist: inverse ? positiveSize : windowSize,
    odist: inverse ? windowSize : positiveSize,
    cufftType: inverse ? cufftC2r : cufftR2c,
  };
};

const allocateDeviceBuffers = (options: AllocateBuffersOptions): boolean => {
  const { cuda, check, input, outputBytes, deviceInput, deviceOutput } =
    options;
  if (!check(cuda.malloc(deviceInput, input.byteLength), 'cudaMalloc(input)')) {
    return false;
  }
  if (!check(cuda.malloc(deviceOutput, outputBytes), 'cudaMalloc(output)')) {
    return false;
  }
  const [inputHandle] = deviceInput;
  // eslint-disable-next-line musetric/no-null-literal
  if (inputHandle === null) {
    return false;
  }
  return check(
    cuda.memcpy(inputHandle, input, input.byteLength, cudaMemcpyHostToDevice),
    'cudaMemcpy(input)',
  );
};

const createCufftPlan = (
  spec: DirectionSpec,
  planMany: ForeignFunction,
  windowCount: number,
): number | undefined => {
  const plan: number[] = [0];
  const ok = checkCufft(
    planMany(
      plan,
      1,
      spec.n,
      spec.inembed,
      1,
      spec.idist,
      spec.onembed,
      1,
      spec.odist,
      spec.cufftType,
      windowCount,
    ),
    'cufftPlanMany',
  );
  return ok ? plan[0] : undefined;
};

const runMeasurements = (
  options: RunMeasurementsOptions,
): MeasureStats | undefined => {
  const {
    plan,
    deviceInput,
    deviceOutput,
    cudart,
    cufft,
    direction,
    windowCount,
    windowSize,
  } = options;
  const baseOptions: MeasureRunOptions = {
    plan,
    deviceInput,
    deviceOutput,
    cudart,
    cufft,
    runsPerSample: 1,
    direction,
  };
  const values: number[] = [];
  let runsPerSample = 1;

  for (
    let tryIndex = 0;
    tryIndex < defaultBenchStatsConfig.maxTries;
    tryIndex += 1
  ) {
    const batch = measureBatch({ ...baseOptions, runsPerSample });
    if (batch.length === 0) {
      return undefined;
    }
    if (tryIndex === 0) {
      runsPerSample = fourierSelectRunsPerSample(batch);
      continue;
    }

    values.push(...batch);
    const { cv } = fourierComputeStats(values);
    const stable = cv <= defaultBenchStatsConfig.stableCvPercent;
    const logMessage = stable
      ? `cuFFT ${windowCount} ${windowSize} cv=${cv.toFixed(1)}%`
      : `cuFFT ${windowCount} ${windowSize} cv=${cv.toFixed(1)}% batch=${tryIndex}/${defaultBenchStatsConfig.maxTries - 1}`;
    console.log(logMessage);

    if (stable) {
      break;
    }
  }

  return fourierComputeStats(values);
};

const measureOne = (options: MeasureOneOptions): MeasureStats | undefined => {
  const { windowSize, windowCount, cudart, cufft, direction } = options;

  const cuda = createCudaFunctions(cudart);
  const cufftApi = createCufftFunctions(cufft);
  const checkCudaAt = (error: number, stage: string): boolean =>
    checkCuda(error, stage, cuda.getErrorString);
  const inverse = direction === 'inverse';
  const spec = computeDirectionSpec(windowSize, windowCount, inverse);

  // eslint-disable-next-line musetric/no-null-literal
  const deviceInput: Array<bigint | null> = [null];
  // eslint-disable-next-line musetric/no-null-literal
  const deviceOutput: Array<bigint | null> = [null];
  let plan = 0;
  let planCreated = false;

  try {
    if (
      !allocateDeviceBuffers({
        cuda,
        check: checkCudaAt,
        input: spec.input,
        outputBytes: spec.outputBytes,
        deviceInput,
        deviceOutput,
      })
    ) {
      return undefined;
    }

    const [inputHandle] = deviceInput;
    const [outputHandle] = deviceOutput;
    // eslint-disable-next-line musetric/no-null-literal
    if (inputHandle === null || outputHandle === null) {
      return undefined;
    }

    const createdPlan = createCufftPlan(spec, cufftApi.planMany, windowCount);
    if (createdPlan === undefined) {
      return undefined;
    }
    plan = createdPlan;
    planCreated = true;

    return runMeasurements({
      plan,
      deviceInput: inputHandle,
      deviceOutput: outputHandle,
      cudart,
      cufft,
      direction,
      windowCount,
      windowSize,
    });
  } finally {
    if (planCreated) {
      cufftApi.destroy(plan);
    }
    const [deviceInputHandle] = deviceInput;
    // eslint-disable-next-line musetric/no-null-literal
    if (deviceInputHandle !== null) cuda.free(deviceInputHandle);
    const [deviceOutputHandle] = deviceOutput;
    // eslint-disable-next-line musetric/no-null-literal
    if (deviceOutputHandle !== null) cuda.free(deviceOutputHandle);
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
