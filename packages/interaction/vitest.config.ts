import { playwright } from '@vitest/browser-playwright';
import {
  configDefaults,
  defineConfig,
  type TestProjectInlineConfiguration,
} from 'vitest/config';

const browserTests = 'src/**/*.browser.test.ts';

const nodeProject: TestProjectInlineConfiguration = {
  test: {
    name: 'node',
    environment: 'node',
    exclude: [...configDefaults.exclude, browserTests],
  },
};

const browserProject: TestProjectInlineConfiguration = {
  test: {
    name: 'browser',
    include: [browserTests],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          channel: 'chromium',
          args: ['--force_high_performance_gpu'],
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
};

export default defineConfig({
  test: {
    projects:
      process.platform === 'linux'
        ? [nodeProject]
        : [nodeProject, browserProject],
  },
});
