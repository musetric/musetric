import { defaultBenchStatsConfig } from '@musetric/utils';
import type * as koffi from 'koffi';
import { type FourierBenchDirection } from '../../src/fourier/__test__/bench.es.js';
import { checkCuda, checkCufft } from './cudaLibs.js';

export type MeasureRunOptions = {
  plan: number;
  deviceInput: bigint | null;
  deviceOutput: bigint | null;
  cudart: koffi.LibraryHandle;
  cufft: koffi.LibraryHandle;
  runsPerSample: number;
  direction: FourierBenchDirection;
};

export const measureOneRun = (options: MeasureRunOptions): number => {
  const {
    plan,
    deviceInput,
    deviceOutput,
    cudart,
    cufft,
    runsPerSample,
    direction,
  } = options;

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
  const checkCudaStep = (error: number, stage: string): boolean =>
    checkCuda(error, stage, cudaGetErrorString);

  // eslint-disable-next-line musetric/no-null-literal
  const startEvent: Array<bigint | null> = [null];
  // eslint-disable-next-line musetric/no-null-literal
  const stopEvent: Array<bigint | null> = [null];

  try {
    if (!checkCudaStep(cudaEventCreate(startEvent), 'cudaEventCreate(start)')) {
      return -1;
    }
    if (!checkCudaStep(cudaEventCreate(stopEvent), 'cudaEventCreate(stop)')) {
      return -1;
    }
    if (
      !checkCudaStep(
        // eslint-disable-next-line musetric/no-null-literal
        cudaEventRecord(startEvent[0], null),
        'cudaEventRecord(start)',
      )
    ) {
      return -1;
    }

    for (let i = 0; i < runsPerSample; i++) {
      if (
        !checkCufft(cufftExec(plan, deviceInput, deviceOutput), 'cufftExec')
      ) {
        return -1;
      }
    }

    if (
      !checkCudaStep(
        // eslint-disable-next-line musetric/no-null-literal
        cudaEventRecord(stopEvent[0], null),
        'cudaEventRecord(stop)',
      )
    ) {
      return -1;
    }
    if (
      !checkCudaStep(cudaEventSynchronize(stopEvent[0]), 'cudaEventSynchronize')
    ) {
      return -1;
    }

    const ms = [0];
    if (
      !checkCudaStep(
        cudaEventElapsedTime(ms, startEvent[0], stopEvent[0]),
        'cudaEventElapsedTime',
      )
    ) {
      return -1;
    }

    return ms[0] / runsPerSample;
  } finally {
    // eslint-disable-next-line musetric/no-null-literal
    if (startEvent[0] !== null) cudaEventDestroy(startEvent[0]);
    // eslint-disable-next-line musetric/no-null-literal
    if (stopEvent[0] !== null) cudaEventDestroy(stopEvent[0]);
  }
};

export const measureBatch = (options: MeasureRunOptions): number[] => {
  const values: number[] = [];

  for (let i = 0; i < defaultBenchStatsConfig.batchSize; i++) {
    const ms = measureOneRun(options);

    if (ms < 0) {
      return [];
    }

    values.push(ms);
  }

  return values;
};
