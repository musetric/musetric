import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './src/__test__/globalSetup.ts',
    testTimeout: 30_000,
  },
});
