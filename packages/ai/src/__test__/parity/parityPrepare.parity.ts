import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { inject, it } from 'vitest';
import {
  type ParityCase,
  type ParityCaseFile,
  paritySourceChannels,
  paritySourceRate,
  type ParityStem,
  parityStepModels,
} from './parityCases.js';
import {
  decodePlanar,
  ensureDownload,
  readManifest,
  readTensorValues,
  writeWav,
} from './parityFiles.js';
import {
  findBundle,
  type ParityBundle,
  readParityModels,
} from './parityModels.js';

type ParityPrepareRequest = ParityCaseFile & {
  outDir: string;
  referenceCommand: string;
};

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ProvidedContext {
    parityPrepare?: ParityPrepareRequest;
  }
}

declare module '@vitest/runner' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface TaskMeta {
    parityPrepare?: string[];
  }
}

const ensureBundle = async (
  outDir: string,
  bundle: ParityBundle,
): Promise<void> => {
  for (const file of bundle.files) {
    await ensureDownload({
      url: `https://huggingface.co/${bundle.modelId}/resolve/${bundle.revision}/${file.name}`,
      sha256: file.sha256,
      target: resolve(outDir, 'models', bundle.directory, file.name),
    });
  }
};

type StemInput = {
  outDir: string;
  input: ParityStem;
  testCase: ParityCase;
  target: string;
};

const writeStemInput = (stem: StemInput): void => {
  const { input, testCase } = stem;
  const inputDir = resolve(stem.outDir, 'cases', input.case);
  const manifest = readManifest(resolve(inputDir, 'manifest.json'));
  const tensor = manifest.tensors[`${input.stem}@reference`];
  const { sampleRate } = manifest.meta;
  if (typeof sampleRate !== 'number') {
    throw new Error(`${input.case} does not record its sample rate`);
  }
  const values = readTensorValues(resolve(inputDir, tensor.file), tensor);
  const [channels, frames] = tensor.shape;
  const from = Math.round((testCase.from ?? 0) * sampleRate);
  const to =
    testCase.to === undefined ? frames : Math.round(testCase.to * sampleRate);
  writeWav({
    path: stem.target,
    sampleRate,
    channels: Array.from({ length: channels }, (_, channel) =>
      Float32Array.from(
        values.subarray(channel * frames + from, channel * frames + to),
      ),
    ),
  });
};

const writeSourceInput = async (
  request: ParityPrepareRequest,
  testCase: ParityCase,
  target: string,
): Promise<void> => {
  const source = request.sources[testCase.source ?? ''];
  const sourcePath = resolve(
    request.outDir,
    'sources',
    basename(new URL(source.url).pathname),
  );
  await ensureDownload({
    url: source.url,
    sha256: source.sha256,
    target: sourcePath,
  });
  const sampleRate = testCase.sampleRate ?? paritySourceRate;
  const channels = decodePlanar({
    path: sourcePath,
    sampleRate,
    channels: testCase.channels ?? paritySourceChannels,
  });
  const from = Math.round((testCase.from ?? 0) * sampleRate);
  const to =
    testCase.to === undefined
      ? channels[0].length
      : Math.round(testCase.to * sampleRate);
  const gain = testCase.gain ?? 1;
  writeWav({
    path: target,
    sampleRate,
    channels: channels.map((channel) =>
      channel.slice(from, to).map((value) => value * gain),
    ),
  });
};

const runReference = (command: string, args: string[]): void => {
  const result = spawnSync([command, ...args].join(' '), {
    shell: true,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`reference command exited with ${result.status}`);
  }
};

it('prepares the parity cases', async (context) => {
  const request = inject('parityPrepare');
  if (!request) {
    return;
  }
  const models = readParityModels();
  const prepared: string[] = [];
  for (const testCase of request.cases) {
    const caseDir = resolve(request.outDir, 'cases', testCase.name);
    const audio = resolve(caseDir, 'audio.wav');
    if (testCase.input === undefined) {
      await writeSourceInput(request, testCase, audio);
    } else {
      writeStemInput({
        outDir: request.outDir,
        input: testCase.input,
        testCase,
        target: audio,
      });
    }
    const bundle = findBundle(models, parityStepModels[testCase.step].bundle);
    await ensureBundle(request.outDir, bundle);
    const onnx = bundle.files.find((file) => file.name.endsWith('.onnx'));
    runReference(request.referenceCommand, [
      `--step ${testCase.step}`,
      `--audio-path "${audio}"`,
      `--onnx "${resolve(request.outDir, 'models', bundle.directory, onnx?.name ?? '')}"`,
      `--case-path "${caseDir}"`,
      ...(testCase.language === undefined
        ? []
        : [`--language ${testCase.language}`]),
    ]);
    prepared.push(testCase.name);
  }
  context.task.meta.parityPrepare = prepared;
});
