import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

const devPort = 1420;

const ortAssetNames: readonly string[] = [
  'ort.wasm.min.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];

const ortAssetContentTypes: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
};

const ortAssetsPlugin = (): Plugin => ({
  name: 'musetric-ort-assets',
  configureServer: (server) => {
    server.middlewares.use((req, res, next) => {
      const url = req.url?.split('?')[0];
      if (url === undefined || !url.startsWith('/onnxruntime/')) {
        next();
        return;
      }
      const name = url.slice('/onnxruntime/'.length);
      if (!ortAssetNames.includes(name)) {
        next();
        return;
      }
      const path = join(
        server.config.root,
        '../../node_modules/onnxruntime-web/dist',
        name,
      );
      if (!existsSync(path)) {
        next();
        return;
      }
      res.setHeader(
        'content-type',
        ortAssetContentTypes[path.slice(path.lastIndexOf('.'))] ??
          'application/octet-stream',
      );
      createReadStream(path).pipe(res);
    });
  },
});

export default defineConfig({
  base: '/',
  clearScreen: false,
  plugins: [react(), ortAssetsPlugin()],
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  resolve: {
    conditions: defaultClientConditions.concat('monorepo'),
  },
  worker: {
    format: 'es',
  },
  build: {
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
