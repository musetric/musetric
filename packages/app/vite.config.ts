import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

const frontendRoot = fileURLToPath(new URL('../frontend', import.meta.url));
const outDir = fileURLToPath(new URL('./dist', import.meta.url));
const devPort = 1420;

export default defineConfig({
  root: frontendRoot,
  base: '/',
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_', 'frontend'],
  plugins: [react()],
  resolve: {
    conditions: defaultClientConditions.concat('monorepo'),
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    assetsDir: '',
    chunkSizeWarningLimit: 1024,
  },
  server: {
    host: '0.0.0.0',
    port: devPort,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
