import { dirname, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createVitest, experimental_getRunnerTask } from 'vitest/node';
import type * as spectrogramBench from '../src/__test__/bench.es.js';
import type * as benchReport from './genBenchReport.js';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface TaskMeta {
    bench?: spectrogramBench.SpectrogramBenchSummary;
  }
}

const startTime = performance.now();

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(currentDir, '..');

const devNull = new Writable({
  write: (_chunk, _encoding, callback) => {
    callback();
  },
});

type BenchReporterLog = {
  content: string;
  type: string;
};

const benchReporter = {
  onUserConsoleLog: (log: BenchReporterLog) => {
    const stream = log.type === 'stderr' ? process.stderr : process.stdout;
    stream.write(log.content + '\n');
  },
};

const vitest = await createVitest(
  {
    config: resolve(packageRoot, 'vitest.bench.config.ts'),
    watch: false,
    reporters: [benchReporter],
  },
  undefined,
  { stdout: devNull, stderr: devNull },
);

const runVitest = async (): Promise<
  spectrogramBench.SpectrogramBenchSummary[]
> => {
  await vitest.start();

  const summaries: spectrogramBench.SpectrogramBenchSummary[] = [];

  for (const module of vitest.state.getTestModules()) {
    for (const testCase of module.children.allTests()) {
      const task = experimental_getRunnerTask(testCase);
      const { bench } = task.meta;
      if (bench !== undefined) {
        summaries.push(bench);
      }
    }
  }

  return summaries;
};

try {
  const { writeBenchReports } = await vitest.import<typeof benchReport>(
    resolve(currentDir, 'genBenchReport.ts'),
  );
  writeBenchReports(await runVitest());
} finally {
  await vitest.close();
}

const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
console.log(`Total script time: ${elapsed}s`);
