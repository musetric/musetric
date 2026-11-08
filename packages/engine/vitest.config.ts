import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      conditions: defaultServerConditions.concat('monorepo'),
    },
  },
  test: {
    environment: 'node',
  },
});
