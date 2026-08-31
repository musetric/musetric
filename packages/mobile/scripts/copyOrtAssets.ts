import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const mobileDirectory = dirname(scriptDirectory);
const repositoryDirectory = join(mobileDirectory, '../..');
const sourceDirectory = join(
  repositoryDirectory,
  'node_modules/onnxruntime-web/dist',
);
const targetDirectory = join(mobileDirectory, 'dist/onnxruntime');

const entries = await readdir(sourceDirectory);
const runtimeFiles = entries.filter((entry) =>
  entry.startsWith('ort-wasm-simd-threaded.'),
);
const files = ['ort.wasm.min.mjs', ...runtimeFiles];

await mkdir(targetDirectory, { recursive: true });
await Promise.all(
  files.map(async (file) => {
    await copyFile(join(sourceDirectory, file), join(targetDirectory, file));
  }),
);
