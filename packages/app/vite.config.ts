import { fileURLToPath } from 'node:url';
import { favicons } from '@musetric/script/faviconsPlugin';
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
  plugins: [
    react(),
    favicons({
      svgPath: fileURLToPath(new URL('./src/favicon.svg', import.meta.url)),
      name: 'Musetric',
    }),
  ],
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
