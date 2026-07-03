import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FourierBenchSummary } from '../src/fourier/__test__/bench.es.js';
import { runBenchmark } from './benchCufft/benchmark.js';
import { type CudaLibs, loadCudaLibs } from './benchCufft/cudaLibs.js';

type CufftBenchResult = {
  available: boolean;
  results: FourierBenchSummary[];
};

const cufftSummaryPath = resolve(process.cwd(), '.bench-cufft.json');

const removeStaleSummary = (): void => {
  rmSync(cufftSummaryPath, { force: true });
};

export const runCufftBenchmark = (): FourierBenchSummary[] | undefined => {
  removeStaleSummary();

  const libs: CudaLibs | undefined = loadCudaLibs();

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
