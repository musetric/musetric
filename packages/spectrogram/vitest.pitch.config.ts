import { defineConfig } from 'vitest/config';
import defaultConfig from './vitest.config.js';

export default defineConfig({
  test: {
    ...defaultConfig.test,
    include: ['**/*.pitch.ts'],
    testTimeout: 0,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
  },
});
