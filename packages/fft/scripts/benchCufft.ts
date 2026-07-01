import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultBenchStatsConfig } from '@musetric/utils';
import koffi, { type LibraryHandle } from 'koffi';
import {
  benchConfig,
  createBenchTimestamp,
  createBenchWave,
  type FourierBenchSummary,
  fourierComputeStats,
  fourierSelectRunsPerSample,
} from '../src/fourier/__test__/bench.es.js';

const cudaSuccess = 0;
const cufftSuccess = 0;
const cudaMemcpyHostToDevice = 1;
const cufftR2c = 0x2a;
const cufftC2r = 0x2c;

type BenchDirection = 'forward' | 'inverse';

const dllPairs = [
  { cudart: 'cudart64_13', cufft: 'cufft64_12' },
  { cudart: 'cudart64_12', cufft: 'cufft64_12' },
  { cudart: 'cudart64_110', cufft: 'cufft64_11' },
  { cudart: 'cudart64_100', cufft: 'cufft64_10' },
];

type CufftBenchResult = {
  available: boolean;
  results: FourierBenchSummary[];
};

const cufftSummaryPath = resolve(process.cwd(), '.bench-cufft.json');

const removeStaleSummary = (): void => {
  rmSync(cufftSummaryPath, { force: true });
};

const searchDllDirectories = (): string[] => {
  const directories: string[] = [];

  if (process.env.CUDA_PATH) {
    const base = resolve(process.env.CUDA_PATH);
    directories.push(resolve(base, 'bin', 'x64'));
    directories.push(resolve(base, 'bin'));
  }

  return directories;
};

const loadCudaLibs = ():
  | { cudart: LibraryHandle; cufft: LibraryHandle }
  | undefined => {
  const directories = searchDllDirectories();

  for (const pair of dllPairs) {
    for (const dir of directories) {
      const cudartPath = resolve(dir, `${pair.cudart}.dll`);
      const cufftPath = resolve(dir, `${pair.cufft}.dll`);

      if (existsSync(cudartPath) && existsSync(cufftPath)) {
        try {
          return {
            cudart: koffi.load(cudartPath),
            cufft: koffi.load(cufftPath),
          };
        } catch {
          /* try next location */
        }
      }
    }
  }

  for (const pair of dllPairs) {
    try {
      const cudart = koffi.load(`${pair.cudart}.dll`);
      const cufft = koffi.load(`${pair.cufft}.dll`);

      return { cudart, cufft };
    } catch {
      /* try next pair */
    }
  }

  return undefined;
};

const checkCuda = (
  error: number,
  stage: string,
  getErrorString: (err: number) => string,
): boolean => {
  if (error === cudaSuccess) {
    return true;
  }

  console.error(`${stage}: ${getErrorString(error)}`);
  return false;
};

const checkCufft = (error: number, stage: string): boolean => {
  if (error === cufftSuccess) {
    return true;
  }

  console.error(`${stage}: cuFFT error ${error}`);
  return false;
};

const measureOneRun = (
  plan: number,
  deviceInput: bigint | null,
  deviceOutput: bigint | null,
  cudart: LibraryHandle,
  cufft: LibraryHandle,
  runsPerSample: number,
  direction: BenchDirection,
): number => {
  const cudaEventCreate = cudart.func(
    'int cudaEventCreate(_Out_ void **event)',
  );
  const cudaEventRecord = cudart.func(
    'int cudaEventRecord(void *event, void *stream)',
  );
  const cudaEventSynchronize = cudart.func(
    'int cudaEventSynchronize(void *event)',
  );
  const cudaEventElapsedTime = cudart.func(
    'int cudaEventElapsedTime(_Out_ float *ms, void *start, void *end)',
  );
  const cudaEventDestroy = cudart.func('int cudaEventDestroy(void *event)');
  const cudaGetErrorString = cudart.func(
    'const char *cudaGetErrorString(int error)',
  );
  const cufftExec =
    direction === 'inverse'
      ? cufft.func('int cufftExecC2R(int plan, void *idata, void *odata)')
      : cufft.func('int cufftExecR2C(int plan, void *idata, void *odata)');

  // eslint-disable-next-line musetric/no-null-literal
  const startEvent: Array<bigint | null> = [null];
  if (
    !checkCuda(
      cudaEventCreate(startEvent),
      'cudaEventCreate(start)',
      cudaGetErrorString,
    )
  ) {
    return -1;
  }

  // eslint-disable-next-line musetric/no-null-literal
  const stopEvent: Array<bigint | null> = [null];
  if (
    !checkCuda(
      cudaEventCreate(stopEvent),
      'cudaEventCreate(stop)',
      cudaGetErrorString,
    )
  ) {
    cudaEventDestroy(startEvent[0]);
    return -1;
  }

  if (
    !checkCuda(
      // eslint-disable-next-line musetric/no-null-literal
      cudaEventRecord(startEvent[0], null),
      'cudaEventRecord(start)',
      cudaGetErrorString,
    )
  ) {
    cudaEventDestroy(startEvent[0]);
    cudaEventDestroy(stopEvent[0]);
    return -1;
  }

  for (let i = 0; i < runsPerSample; i++) {
    if (!checkCufft(cufftExec(plan, deviceInput, deviceOutput), 'cufftExec')) {
      cudaEventDestroy(startEvent[0]);
      cudaEventDestroy(stopEvent[0]);
      return -1;
    }
  }

  if (
    !checkCuda(
      // eslint-disable-next-line musetric/no-null-literal
      cudaEventRecord(stopEvent[0], null),
      'cudaEventRecord(stop)',
      cudaGetErrorString,
    )
  ) {
    cudaEventDestroy(startEvent[0]);
    cudaEventDestroy(stopEvent[0]);
    return -1;
  }

  if (
    !checkCuda(
      cudaEventSynchronize(stopEvent[0]),
      'cudaEventSynchronize',
      cudaGetErrorString,
    )
  ) {
    cudaEventDestroy(startEvent[0]);
    cudaEventDestroy(stopEvent[0]);
    return -1;
  }

  const ms = [0];
  if (
    !checkCuda(
      cudaEventElapsedTime(ms, startEvent[0], stopEvent[0]),
      'cudaEventElapsedTime',
      cudaGetErrorString,
    )
  ) {
    cudaEventDestroy(startEvent[0]);
    cudaEventDestroy(stopEvent[0]);
    return -1;
  }

  cudaEventDestroy(startEvent[0]);
  cudaEventDestroy(stopEvent[0]);

  return ms[0] / runsPerSample;
};

const measureBatch = (
  plan: number,
  deviceInput: bigint | null,
  deviceOutput: bigint | null,
  cudart: LibraryHandle,
  cufft: LibraryHandle,
  runsPerSample: number,
  direction: BenchDirection,
): number[] => {
  const values: number[] = [];

  for (let i = 0; i < defaultBenchStatsConfig.batchSize; i++) {
    const ms = measureOneRun(
      plan,
      deviceInput,
      deviceOutput,
      cudart,
      cufft,
      runsPerSample,
      direction,
    );

    if (ms < 0) {
      return [];
    }

    values.push(ms);
  }

  return values;
};

const measureOne = (
  windowSize: number,
  windowCount: number,
  cudart: LibraryHandle,
  cufft: LibraryHandle,
  direction: BenchDirection,
):
  | {
      mean: number;
      cv: number;
      sampleCount: number;
    }
  | undefined => {
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

  const complexSize = (Math.floor(windowSize / 2) + 1) * windowCount;
  const realSize = windowSize * windowCount;
  // Forward R2C: real (windowSize) -> complex (N/2+1). Inverse C2R reverses it.
  const input =
    direction === 'inverse'
      ? createBenchWave(2 * (Math.floor(windowSize / 2) + 1), windowCount)
      : createBenchWave(windowSize, windowCount);
  const outputBytes = direction === 'inverse' ? realSize * 4 : complexSize * 8;

  // eslint-disable-next-line musetric/no-null-literal
  const deviceInput: Array<bigint | null> = [null];
  if (
    !checkCuda(
      cudaMalloc(deviceInput, input.byteLength),
      'cudaMalloc(input)',
      cudaGetErrorString,
    )
  ) {
    return undefined;
  }

  // eslint-disable-next-line musetric/no-null-literal
  const deviceOutput: Array<bigint | null> = [null];
  if (
    !checkCuda(
      cudaMalloc(deviceOutput, outputBytes),
      'cudaMalloc(output)',
      cudaGetErrorString,
    )
  ) {
    cudaFree(deviceInput[0]);
    return undefined;
  }

  if (
    !checkCuda(
      cudaMemcpy(
        deviceInput[0],
        input,
        input.byteLength,
        cudaMemcpyHostToDevice,
      ),
      'cudaMemcpy(input)',
      cudaGetErrorString,
    )
  ) {
    cudaFree(deviceInput[0]);
    cudaFree(deviceOutput[0]);
    return undefined;
  }

  const plan = [0];
  const n = Int32Array.of(windowSize);
  const positiveSize = Math.floor(windowSize / 2) + 1;
  const inverse = direction === 'inverse';
  const inembed = Int32Array.of(inverse ? positiveSize : windowSize);
  const onembed = Int32Array.of(inverse ? windowSize : positiveSize);

  if (
    !checkCufft(
      cufftPlanMany(
        plan,
        1,
        n,
        inembed,
        1,
        inverse ? positiveSize : windowSize,
        onembed,
        1,
        inverse ? windowSize : positiveSize,
        inverse ? cufftC2r : cufftR2c,
        windowCount,
      ),
      'cufftPlanMany',
    )
  ) {
    cudaFree(deviceInput[0]);
    cudaFree(deviceOutput[0]);
    return undefined;
  }

  try {
    const values: number[] = [];
    let runsPerSample = 1;

    for (
      let tryIndex = 0;
      tryIndex < defaultBenchStatsConfig.maxTries;
      tryIndex++
    ) {
      const batch = measureBatch(
        plan[0],
        deviceInput[0],
        deviceOutput[0],
        cudart,
        cufft,
        runsPerSample,
        direction,
      );

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
    cufftDestroy(plan[0]);
    cudaFree(deviceInput[0]);
    cudaFree(deviceOutput[0]);
  }
};

const benchDirections: BenchDirection[] = ['forward', 'inverse'];

const runBenchmark = (
  cudart: LibraryHandle,
  cufft: LibraryHandle,
): FourierBenchSummary[] => {
  const timestamp = createBenchTimestamp();
  const results: FourierBenchSummary[] = [];

  for (const direction of benchDirections) {
    for (const windowCount of benchConfig.windowCounts) {
      const windowSizes: number[] = [];
      const means: number[] = [];
      const cvs: number[] = [];
      const sampleCounts: number[] = [];

      let hasSupportedResult = false;

      for (const windowSize of benchConfig.windowSizes) {
        windowSizes.push(windowSize);

        const measureResult = measureOne(
          windowSize,
          windowCount,
          cudart,
          cufft,
          direction,
        );

        if (measureResult) {
          means.push(measureResult.mean);
          cvs.push(measureResult.cv);
          sampleCounts.push(measureResult.sampleCount);
          hasSupportedResult = true;
        } else {
          means.push(Number.NaN);
          cvs.push(Number.NaN);
          sampleCounts.push(0);
        }
      }

      if (!hasSupportedResult) {
        continue;
      }

      const maxSampleCount = Math.max(...sampleCounts);

      results.push({
        timestamp,
        direction,
        count: windowCount,
        mode: 'cufft',
        modeLabel: 'cuFFT',
        windowSizes,
        means,
        cvs,
        sampleCount: maxSampleCount,
      });
    }
  }

  return results;
};

export const runCufftBenchmark = (): FourierBenchSummary[] | undefined => {
  removeStaleSummary();

  const libs = loadCudaLibs();

  if (!libs) {
    return undefined;
  }

  const { cudart, cufft } = libs;

  try {
    return runBenchmark(cudart, cufft);
  } catch (error) {
    removeStaleSummary();
    throw error;
  }
};

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const results = runCufftBenchmark();

    if (results !== undefined) {
      writeFileSync(
        cufftSummaryPath,
        JSON.stringify({ available: true, results } satisfies CufftBenchResult),
        'utf-8',
      );
    }
  } catch (error) {
    removeStaleSummary();
    const message = error instanceof Error ? error.message : String(error);

    console.error(message);
    process.exit(1);
  }
}
