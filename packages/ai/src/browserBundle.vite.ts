import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig, type UserConfig } from 'vite';

const entry = fileURLToPath(import.meta.resolve('./service/browserEntry.ts'));

export type BrowserBundleOptions = {
  root: string;
  outDir: string;
};

export const createBrowserBundleConfig = (
  options: BrowserBundleOptions,
): UserConfig =>
  defineConfig({
    root: options.root,
    resolve: {
      conditions: defaultClientConditions.concat('monorepo'),
    },
    build: {
      outDir: options.outDir,
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
