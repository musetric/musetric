import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  includeEntryExports: true,
  ignoreExportsUsedInFile: true,
  ignoreIssues: {
    'packages/engine/src/engine.ts': ['exports'],
    'packages/api/src/routes/audio.ts': ['exports'],
    'packages/api/src/routes/preview.ts': ['exports'],
  },
  ignoreBinaries: ['xcodegen', 'ffmpeg', 'adb', 'taskkill'],
  ignoreUnresolved: ['vite/client', '^tsx$'],
  ignoreDependencies: ['@vitest/browser'],
  ignoreFiles: [
    '**/i18next.config.ts',
    '**/vitest.bench.config.ts',
    '**/vitest.pitch.config.ts',
    '**/vitest.parity.config.ts',
  ],
  workspaces: {
    'packages/ai': {
      entry: [
        'scripts/**/*.ts',
        'src/**/*.parity.ts',
        'src/__test__/parity/parityPage.ts',
      ],
    },
    'packages/fft': {
      entry: ['scripts/**/*.ts', 'src/**/*.bench.ts'],
    },
    'packages/cqt': {
      entry: ['src/**/*.bench.ts'],
    },
    'packages/app': {
      entry: ['scripts/**/*.ts'],
    },
    'packages/script': {
      entry: ['src/**/*.ts'],
    },
    'packages/spectrogram': {
      entry: ['scripts/**/*.ts', 'src/**/*.bench.ts', 'src/**/*.pitch.ts'],
    },
  },
};

export default config;
