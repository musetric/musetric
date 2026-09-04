import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devPort = 1420;

export default defineConfig({
  base: '/',
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  plugins: [react()],
  build: {
    target: 'es2022',
    assetsDir: '',
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
