import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig } from 'vite';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const entry = join(dirname(packageRoot), 'ai/src/service/browserEntry.ts');

export default defineConfig({
  root: packageRoot,
  resolve: {
    conditions: defaultClientConditions.concat('monorepo'),
  },
  build: {
    outDir: 'dist-browser',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    chunkSizeWarningLimit: 8192,
    rollupOptions: {
      input: { index: entry },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
