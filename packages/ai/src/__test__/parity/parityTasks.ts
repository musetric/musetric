import { resolve } from 'node:path';
import {
  type ParityCase,
  type ParityStep,
  type ParityStepModel,
  parityStepModels,
  wasmRuns,
} from './parityCases.js';
import { type ParityManifest, readManifest } from './parityFiles.js';
import {
  beatThisGraph,
  chordNetGraph,
  type ParityGraphFields,
  skeyGraph,
  stringField,
  vocalsGraph,
  whisperGraph,
} from './parityGraphs.js';
import {
  type ParityExternalData,
  type ParityModelTask,
  type ParityTask,
  type ParityTensorRef,
  type ParityWhisperModelTask,
} from './parityJob.js';
import { findBundle, findFile } from './parityModels.js';

type CaseModel = {
  caseName: string;
  graph: ParityGraphFields;
  modelId: string;
  revision: string;
  modelUrl: string;
  externalData: ParityExternalData[];
  fileUrl: (role: string) => string;
  meta: Record<string, unknown>;
  tensor: (key: string) => ParityTensorRef;
};

const caseModel = (
  testCase: ParityCase,
  manifest: ParityManifest,
): CaseModel => {
  const bundle = findBundle(parityStepModels[testCase.step].pin);
  const root = `/models/${bundle.directory}`;
  const files = Object.values(bundle.files);
  const model = files.find((file) => file.name.endsWith('.onnx'));
  const data = files.find((file) => file.name.endsWith('.onnx.data'));
  return {
    caseName: testCase.name,
    graph: bundle.graph,
    modelId: bundle.modelId,
    revision: bundle.revision,
    modelUrl: `${root}/${model?.name ?? ''}`,
    externalData: data
      ? [{ path: data.name, data: `${root}/${data.name}` }]
      : [],
    fileUrl: (role) => `${root}/${findFile(bundle, role).name}`,
    meta: manifest.meta,
    tensor: (key) => {
      const tensor = manifest.tensors[key];
      return {
        url: `/cases/${testCase.name}/${tensor.file}`,
        dtype: tensor.dtype,
        shape: tensor.shape,
      };
    },
  };
};

const modelTask = (
  model: CaseModel,
  step: ParityStepModel,
  provider: ParityModelTask['provider'],
): ParityModelTask => ({
  kind: 'model',
  caseName: model.caseName,
  provider,
  modelUrl: model.modelUrl,
  externalData: model.externalData,
  simpleBufferCache: step.simpleBufferCache,
  inputs: [
    {
      name: stringField(model.graph, 'inputName'),
      tensor: model.tensor('model.input@reference'),
    },
  ],
  outputs: Object.entries(step.outputs).map((output) => ({
    name: stringField(model.graph, output[0]),
    boundary: output[1],
  })),
});

const metaValue = (model: CaseModel, key: string): unknown => {
  const value = model.meta[key];
  if (value === undefined) {
    throw new Error(`${model.caseName} records no ${key}`);
  }
  return value;
};

const whisperModelTask = (
  model: CaseModel,
  provider: ParityWhisperModelTask['provider'],
): ParityWhisperModelTask => ({
  kind: 'whisperModel',
  caseName: model.caseName,
  provider,
  encoderUrl: model.fileUrl('encoder'),
  decoderUrl: model.fileUrl('decoder'),
  crossUrl: model.fileUrl('crossKv'),
  features: model.tensor('model.input@reference'),
  encoderStates: model.tensor('encoder.output@onnx-cpu'),
  tokens: model.tensor('decoder.tokens@reference'),
});

const providerTask = (
  testCase: ParityCase,
  model: CaseModel,
  provider: ParityModelTask['provider'],
): ParityTask =>
  testCase.step === 'transcribe'
    ? whisperModelTask(model, provider)
    : modelTask(model, parityStepModels[testCase.step], provider);

const productTasks: Record<ParityStep, (model: CaseModel) => ParityTask> = {
  transcribe: (model) => ({
    kind: 'whisper',
    caseName: model.caseName,
    graph: whisperGraph(model.graph),
    modelPath: '/hf',
    modelId: model.modelId,
    revision: model.revision,
    language: String(metaValue(model, 'language')),
    unitInput: model.tensor('unit.input@reference'),
  }),
  lines: (model) => ({
    kind: 'lines',
    caseName: model.caseName,
    graph: whisperGraph(model.graph),
    modelPath: '/hf',
    modelId: model.modelId,
    revision: model.revision,
    voice: model.tensor('voice@reference'),
  }),
  vocals: (model) => ({
    kind: 'vocals',
    caseName: model.caseName,
    graph: vocalsGraph(model.graph),
    modelUrl: model.modelUrl,
    modelData: model.externalData[0],
    unitInput: model.tensor('unit.input@reference'),
  }),
  rhythm: (model) => ({
    kind: 'rhythm',
    caseName: model.caseName,
    graph: beatThisGraph(model.graph),
    modelUrl: model.modelUrl,
    filterbankUrl: model.fileUrl('filterbank'),
    unitInput: model.tensor('unit.input@reference'),
  }),
  key: (model) => ({
    kind: 'key',
    caseName: model.caseName,
    graph: skeyGraph(model.graph),
    modelUrl: model.modelUrl,
    unitInput: model.tensor('unit.input@reference'),
  }),
  chords: (model) => ({
    kind: 'chords',
    caseName: model.caseName,
    graph: chordNetGraph(model.graph),
    modelUrl: model.modelUrl,
    planUrl: model.fileUrl('plan'),
    planManifestUrl: model.fileUrl('planManifest'),
    unitInput: model.tensor('unit.input@reference'),
  }),
};

export type ParityCaseTasks = {
  outDir: string;
  testCase: ParityCase;
  desktop: boolean;
};

export const caseTasks = (request: ParityCaseTasks): ParityTask[] => {
  const { testCase } = request;
  const manifest = readManifest(
    resolve(request.outDir, 'cases', testCase.name, 'manifest.json'),
  );
  const model = caseModel(testCase, manifest);
  return [
    ...(wasmRuns(testCase.step, request.desktop)
      ? [providerTask(testCase, model, 'wasm')]
      : []),
    ...(parityStepModels[testCase.step].webgpu
      ? [providerTask(testCase, model, 'webgpu')]
      : []),
    productTasks[testCase.step](model),
  ];
};
