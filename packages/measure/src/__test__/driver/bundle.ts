import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, defaultClientConditions, type Plugin } from 'vite';

const stubPrefix = '\0measure-stub:';

const wasmUrlPattern = /new URL\('([\w-]+\.wasm)', import\.meta\.url\)/g;

const inlineWasmUrls: Plugin = {
  name: 'measure-inline-wasm-urls',
  transform: async (code, id) => {
    const names = [...code.matchAll(wasmUrlPattern)].map((match) => match[1]);
    if (names.length === 0) {
      return undefined;
    }
    const inlined = new Map<string, string>();
    for (const name of names) {
      const bytes = await readFile(join(dirname(id), name));
      inlined.set(name, bytes.toString('base64'));
    }
    return code.replace(
      wasmUrlPattern,
      (_, name: string) =>
        `new URL('data:application/wasm;base64,${inlined.get(name)}')`,
    );
  },
};

const stubAssetUrls: Plugin = {
  name: 'measure-stub-asset-urls',
  enforce: 'pre',
  resolveId: (id) =>
    /\?(worker|url)\b/.test(id) ? stubPrefix + id : undefined,
  load: (id) => (id.startsWith(stubPrefix) ? 'export default "";' : undefined),
};

export type InjectedScript = 'page' | 'spectrogramWorker';

export const bundleInjectedScript = async (
  script: InjectedScript,
): Promise<string> => {
  const result = await build({
    configFile: false,
    logLevel: 'warn',
    plugins: [stubAssetUrls, inlineWasmUrls],
    resolve: { conditions: defaultClientConditions.concat('monorepo') },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: {
        entry: fileURLToPath(
          new URL(`../injected/${script}.ts`, import.meta.url),
        ),
        formats: ['iife'],
        name: 'musetricMeasureInjected',
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ('output' in output ? output.output : []))
    .find((item) => item.type === 'chunk');
  if (!chunk) {
    throw new Error(`Bundling ${script} gave no code`);
  }
  return chunk.code;
};
