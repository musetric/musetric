import { dirname, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { experimental_getRunnerTask, startVitest } from 'vitest/node';
import { type FourierBenchSummary } from '../src/fourier/__test__/bench.es.js';
import { runCufftBenchmark } from './benchCufft.js';
import { writeBenchReport } from './genBenchReport.js';

declare module '@vitest/runner' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface TaskMeta {
    bench?: FourierBenchSummary;
  }
}

type BenchReporterLog = {
  content: string;
  type: string;
};

const main = async (): Promise<void> => {
  const startTime = performance.now();
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(currentDir, '..');
  const devNull = new Writable({
    write: (_chunk, _encoding, callback) => {
      callback();
    },
  });
  const benchReporter = {
    onUserConsoleLog: (log: BenchReporterLog) => {
      const stream = log.type === 'stderr' ? process.stderr : process.stdout;
      stream.write(log.content + '\n');
    },
  };
  const cufftResults = runCufftBenchmark() ?? [];
  const vitest = await startVitest(
    'test',
    [],
    {
      config: resolve(packageRoot, 'vitest.bench.config.ts'),
      watch: false,
      reporters: [benchReporter],
    },
    undefined,
    { stdout: devNull, stderr: devNull },
  );
  const collectWebgpuResults = (): FourierBenchSummary[] => {
    const webgpuResults: FourierBenchSummary[] = [];

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
    writeBenchReport(collectWebgpuResults(), cufftResults);
  } finally {
    await vitest.close();
  }

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`Total script time: ${elapsed}s`);
};

await main();
