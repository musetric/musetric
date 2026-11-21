import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserBundleConfig } from '@musetric/ai/vite';
import { notices } from '@musetric/script/noticesPlugin';
import { mergeConfig } from 'vite';

const packageRoot = dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  createBrowserBundleConfig({
    root: packageRoot,
    outDir: 'dist/executor',
  }),
  {
    plugins: [
      notices(fileURLToPath(new URL('./notices/executor.md', import.meta.url))),
    ],
  },
);
