import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import * as tsEslint from 'typescript-eslint';
import { expect, it } from 'vitest';
import { musetricPlugin } from '../../plugin.js';

const fixtures = fileURLToPath(
  new URL('fixtures/audioThread/', import.meta.url),
);
const lintTimeout = 60_000;

const lintFixtures = async (): Promise<string[]> => {
  const eslint = new ESLint({
    cwd: fixtures,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tsEslint.parser,
          parserOptions: {
            projectService: { EXPERIMENTAL_backend: 'tsgo' },
            tsconfigRootDir: fixtures,
          },
        },
        linterOptions: { reportUnusedDisableDirectives: 'error' },
        plugins: { musetric: musetricPlugin },
        rules: { 'musetric/no-audio-thread-allocations': 'error' },
      },
    ],
  });
  const results = await eslint.lintFiles(['*.worklet.ts']);
  return results.flatMap((result) =>
    result.messages.map((message) => {
      const [head] = message.message.split(': ');
      const text = head.replace(/ at \S*[\\/]/, ' at ');
      return `${basename(result.filePath)}:${message.line} ${text}`;
    }),
  );
};

it(
  'reports what process() of an AudioWorkletProcessor reaches on every quantum',
  async () => {
    const thread = 'allocates on the audio thread';
    expect(await lintFixtures()).toEqual([
      `processor.worklet.ts:6 An array literal ${thread}`,
      `runtime.worklet.ts:16 An array literal ${thread}`,
      `runtime.worklet.ts:21 A rest parameter ${thread}`,
      `runtime.worklet.ts:33 new Float32Array ${thread}`,
      `runtime.worklet.ts:35 Float64Array.of() ${thread}`,
      `runtime.worklet.ts:45 A for...of loop ${thread}`,
      `runtime.worklet.ts:48 Array destructuring ${thread}`,
      `runtime.worklet.ts:49 A spread argument ${thread}`,
      'runtime.worklet.ts:50 A closure is made here on every call of process, and the variables it captures make process allocate their context on every call, even when this line does not run',
      `runtime.worklet.ts:52 slice() ${thread}`,
      `runtime.worklet.ts:53 This call ${thread} through an array literal at pair.cross.ts:1`,
      "runtime.worklet.ts:59 Unused eslint-disable directive (no problems were reported from 'musetric/no-audio-thread-allocations').",
    ]);
  },
  lintTimeout,
);
