import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as koffi from 'koffi';

const cudaSuccess = 0;
const cufftSuccess = 0;

const dllPairs: readonly { cudart: string; cufft: string }[] = [
  { cudart: 'cudart64_13', cufft: 'cufft64_12' },
  { cudart: 'cudart64_12', cufft: 'cufft64_12' },
  { cudart: 'cudart64_110', cufft: 'cufft64_11' },
  { cudart: 'cudart64_100', cufft: 'cufft64_10' },
];

const searchDllDirectories = (): string[] => {
  if (!process.env.CUDA_PATH) {
    return [];
  }
  const base = resolve(process.env.CUDA_PATH);
  return [resolve(base, 'bin', 'x64'), resolve(base, 'bin')];
};

export type CudaLibs = {
  cudart: koffi.LibraryHandle;
  cufft: koffi.LibraryHandle;
};

const tryLoadPairAt = (
  pair: (typeof dllPairs)[number],
  dir: string,
): CudaLibs | undefined => {
  const cudartPath = resolve(dir, `${pair.cudart}.dll`);
  const cufftPath = resolve(dir, `${pair.cufft}.dll`);

  if (!existsSync(cudartPath) || !existsSync(cufftPath)) {
    return undefined;
  }

  try {
    return {
      cudart: koffi.load(cudartPath),
      cufft: koffi.load(cufftPath),
    };
  } catch {
    return undefined;
  }
};

export const loadCudaLibs = (): CudaLibs | undefined => {
  for (const dir of searchDllDirectories()) {
    for (const pair of dllPairs) {
      const loaded = tryLoadPairAt(pair, dir);
      if (loaded) {
        return loaded;
      }
    }
  }

  for (const pair of dllPairs) {
    try {
      return {
        cudart: koffi.load(`${pair.cudart}.dll`),
        cufft: koffi.load(`${pair.cufft}.dll`),
      };
    } catch {
      continue;
    }
  }

  return undefined;
};

export const checkCuda = (
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

export const checkCufft = (error: number, stage: string): boolean => {
  if (error === cufftSuccess) {
    return true;
  }

  console.error(`${stage}: cuFFT error ${error}`);
  return false;
};
