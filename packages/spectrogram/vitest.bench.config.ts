import { defineConfig } from 'vitest/config';
import defaultConfig from './vitest.config.js';

export default defineConfig({
  test: {
    ...defaultConfig.test,
    include: ['**/*.bench.ts'],
    testTimeout: 0,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    reporters: [
      {
        onUserConsoleLog: (log) => {
          const stream =
            log.type === 'stderr' ? process.stderr : process.stdout;
          stream.write(log.content + '\n');
        },
      },
    ],
  },
});
