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
  leadBackingGraph,
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
import { findBundle, findFile, type ParityModels } from './parityModels.js';

type CaseModel = {
  caseName: string;
  graph: ParityGraphFields;
  modelId: string;
  revision: string;
  modelUrl: string;
  externalData: ParityExternalData[];
  fileUrl: (constant: string) => string;
  fileStarting: (prefix: string) => string;
  meta: Record<string, unknown>;
  tensor: (key: string) => ParityTensorRef;
};

const caseModel = (
  models: ParityModels,
  testCase: ParityCase,
  manifest: ParityManifest,
): CaseModel => {
  const step = parityStepModels[testCase.step];
  const bundle = findBundle(models, step.bundle);
  const root = `/models/${bundle.directory}`;
  const model = bundle.files.find((file) => file.name.endsWith('.onnx'));
  const data = bundle.files.find((file) => file.name.endsWith('.onnx.data'));
  return {
    caseName: testCase.name,
    graph: models.graphs[step.graph],
    modelId: bundle.modelId,
    revision: bundle.revision,
    modelUrl: `${root}/${model?.name ?? ''}`,
    externalData: data
      ? [{ path: data.name, data: `${root}/${data.name}` }]
      : [],
    fileUrl: (constant) => `${root}/${findFile(models, constant)}`,
    fileStarting: (prefix) =>
      `${root}/${bundle.files.find((file) => file.name.startsWith(prefix))?.name ?? prefix}`,
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
  encoderUrl: model.fileStarting('encoder_model'),
  decoderUrl: model.fileStarting('decoder_model_merged'),
  features: model.tensor('model.input@reference'),
  encoderStates: model.tensor('encoder.output@onnx-cpu'),
  tokens: model.tensor('decoder.tokens@reference'),
  promptLength: Number(metaValue(model, 'promptLength')),
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
    timestampBegin: Number(metaValue(model, 'timestampBegin')),
    unitInput: model.tensor('unit.input@reference'),
  }),
  vocals: (model) => ({
    kind: 'vocals',
    caseName: model.caseName,
    graph: vocalsGraph(model.graph),
    modelUrl: model.modelUrl,
    modelData: model.externalData[0],
    unitInput: model.tensor('unit.input@reference'),
  }),
  voices: (model) => ({
    kind: 'voices',
    caseName: model.caseName,
    graph: leadBackingGraph(model.graph),
    modelUrl: model.modelUrl,
    unitInput: model.tensor('unit.input@reference'),
  }),
  rhythm: (model) => ({
    kind: 'rhythm',
    caseName: model.caseName,
    graph: beatThisGraph(model.graph),
    modelUrl: model.modelUrl,
    filterbankUrl: model.fileUrl('BEAT_THIS_FILTERBANK'),
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
    planUrl: model.fileUrl('CHORD_NET_PLAN'),
    planManifestUrl: model.fileUrl('CHORD_NET_PLAN_MANIFEST'),
    unitInput: model.tensor('unit.input@reference'),
  }),
};

export type ParityCaseTasks = {
  outDir: string;
  models: ParityModels;
  testCase: ParityCase;
  desktop: boolean;
};

export const caseTasks = (request: ParityCaseTasks): ParityTask[] => {
  const { testCase } = request;
  const manifest = readManifest(
    resolve(request.outDir, 'cases', testCase.name, 'manifest.json'),
  );
  const model = caseModel(request.models, testCase, manifest);
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
