import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVitest, experimental_getRunnerTask } from 'vitest/node';
import type * as fourierBench from '../src/fourier/__test__/bench.es.js';
import type * as benchCufft from './benchCufft.js';
import type * as benchReport from './genBenchReport.js';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface TaskMeta {
    bench?: fourierBench.FourierBenchSummary;
  }
}

const main = async (): Promise<void> => {
  const startTime = performance.now();
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(currentDir, '..');
  const vitest = await createVitest({
    config: resolve(packageRoot, 'vitest.bench.config.ts'),
    watch: false,
  });
  const collectWebgpuResults = (): fourierBench.FourierBenchSummary[] => {
    const webgpuResults: fourierBench.FourierBenchSummary[] = [];

    for (const module of vitest.state.getTestModules()) {
      for (const testCase of module.children.allTests()) {
        const task = experimental_getRunnerTask(testCase);
        const { bench } = task.meta;
        if (bench !== undefined) {
          webgpuResults.push(bench);
        }
      }
    }

    return webgpuResults;
  };

  try {
    const { runCufftBenchmark } = await vitest.import<typeof benchCufft>(
      resolve(currentDir, 'benchCufft.ts'),
    );
    const { writeBenchReport } = await vitest.import<typeof benchReport>(
      resolve(currentDir, 'genBenchReport.ts'),
    );
    const cufftResults = runCufftBenchmark() ?? [];
    await vitest.start();
    writeBenchReport(collectWebgpuResults(), cufftResults);
  } finally {
    await vitest.close();
  }

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`Total script time: ${elapsed}s`);
};

await main();
