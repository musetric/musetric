import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    dir: 'src',
    include: ['**/*.parity.ts'],
    environment: 'node',
    testTimeout: 0,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
  },
});
