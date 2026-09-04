import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  includeEntryExports: true,
  ignoreExportsUsedInFile: true,
  ignoreIssues: {
    'packages/engine/src/engine.ts': ['exports'],
    'packages/desktop/scripts/beforePack.ts': ['exports'],
    'packages/desktop/src/backend.ts': ['exports'],
    'packages/api/src/routes/audio.ts': ['exports'],
    'packages/api/src/routes/preview.ts': ['exports'],
  },
  ignoreBinaries: ['rustup', 'xcodegen'],
  ignoreUnresolved: ['vite/client', '^tsx$'],
  ignoreDependencies: ['@vitest/browser'],
  ignoreFiles: ['**/i18next.config.ts', '**/vitest.bench.config.ts'],
  workspaces: {
    'packages/api': {
      entry: ['scripts/**/*.ts'],
    },
    'packages/fft': {
      entry: ['scripts/**/*.ts', 'src/**/*.bench.ts'],
    },
    'packages/cqt': {
      entry: ['src/**/*.bench.ts'],
    },
    'packages/desktop': {
      entry: ['scripts/**/*.ts'],
    },
    'packages/mobile': {
      entry: ['scripts/**/*.ts'],
    },
    'packages/script': {
      entry: ['src/**/*.ts'],
    },
    'packages/spectrogram': {
      entry: ['scripts/**/*.ts', 'src/**/*.bench.ts'],
    },
  },
};

export default config;
