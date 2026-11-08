import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

const isSkip = process.platform === 'linux';

export default defineConfig({
  resolve: {
    conditions: defaultClientConditions.concat('monorepo'),
  },
  test: {
    dir: 'src',
    exclude: isSkip ? ['**/*'] : [],
    passWithNoTests: isSkip,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          channel: 'chromium',
          args: [
            '--enable-unsafe-webgpu',
            '--disable-webgpu-blocklist',
            '--ignore-gpu-blocklist',
          ],
        },
        contextOptions: { colorScheme: 'dark' },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
