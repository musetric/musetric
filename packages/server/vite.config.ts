import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserBundleConfig } from '@musetric/ai/vite';

const packageRoot = dirname(fileURLToPath(import.meta.url));

export default createBrowserBundleConfig({
  root: packageRoot,
  outDir: 'dist-browser',
});
