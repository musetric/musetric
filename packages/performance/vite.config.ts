import { fileURLToPath } from 'node:url';
import { favicons } from '@musetric/script/faviconsPlugin';
import { defaultClientConditions, defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  base: './',
  plugins: [
    mkcert(),
    favicons({
      svgPath: fileURLToPath(new URL('./src/favicon.svg', import.meta.url)),
      name: 'Musetric Performance',
    }),
  ],
  resolve: {
    conditions: defaultClientConditions.concat('monorepo'),
  },
  server: {
    host: '0.0.0.0',
    port: 3002,
    strictPort: true,
  },
});
