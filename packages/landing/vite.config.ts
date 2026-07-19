import { fileURLToPath } from 'node:url';
import { favicons } from '@musetric/script/faviconsPlugin';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  base: '/',
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
  build: {
    target: 'es2022',
    assetsDir: '',
    rollupOptions: {
      input: {
        index: 'index.html',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3003,
    strictPort: true,
  },
});
