import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    conditions: defaultClientConditions.concat('monorepo'),
  },
  build: {
    outDir: 'dist/library',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: { separation: 'src/separation/index.ts' },
      formats: ['es'],
    },
    rolldownOptions: {
      external: [/^onnxruntime-web(\/.*)?$/],
    },
  },
});
