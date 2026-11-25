import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      conditions: defaultServerConditions.concat('monorepo'),
    },
  },
  test: {
    dir: 'src',
    include: ['**/*.measure.ts'],
    environment: 'node',
    testTimeout: 0,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
  },
});
