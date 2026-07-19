import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  includeEntryExports: true,
  ignoreExportsUsedInFile: true,
  ignoreIssues: {
    'packages/engine/src/engine.ts': ['exports'],
  },
  ignoreBinaries: ['ffmpeg', 'ps'],
  ignoreUnresolved: ['vite/client', '^tsx$'],
  ignoreDependencies: ['@vitest/browser'],
  ignoreFiles: ['**/i18next.config.ts', '**/vitest.bench.config.ts'],
  workspaces: {
    'packages/ai': {
      entry: [
        'src/service/browserEntry.ts',
        'src/service/browserChordsEntry.ts',
        'src/service/browserRhythmEntry.ts',
        'src/service/browserTranscribeEntry.ts',
      ],
    },
    'packages/backend': {
      entry: ['scripts/**/*.ts'],
    },
    'packages/fft': {
      entry: ['scripts/**/*.ts', 'src/**/*.bench.ts'],
    },
    'packages/cqt': {
      entry: ['src/**/*.bench.ts'],
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
