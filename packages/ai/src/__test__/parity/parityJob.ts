import {
  type BeatThisGraph,
  type ChordNetGraph,
  type LeadBackingGraph,
  type SkeyGraph,
  type VocalsGraph,
  type WhisperGraph,
} from '../../runtime/modelGraphs.js';
import { type ParityDtype } from './parityMeasure.js';

export type ParityTensorRef = {
  url: string;
  dtype: ParityDtype;
  shape: number[];
};

export type ParityModelInput = {
  name: string;
  tensor: ParityTensorRef;
};

export type ParityModelOutput = {
  name: string;
  boundary: string;
};

export type ParityExternalData = {
  path: string;
  data: string;
};

export type ParityModelTask = {
  kind: 'model';
  caseName: string;
  provider: 'wasm' | 'webgpu';
  modelUrl: string;
  externalData: ParityExternalData[];
  simpleBufferCache: boolean;
  inputs: ParityModelInput[];
  outputs: ParityModelOutput[];
};

export type ParityVocalsTask = {
  kind: 'vocals';
  caseName: string;
  graph: VocalsGraph;
  modelUrl: string;
  modelData: ParityExternalData;
  unitInput: ParityTensorRef;
};

export type ParityVoicesTask = {
  kind: 'voices';
  caseName: string;
  graph: LeadBackingGraph;
  modelUrl: string;
  unitInput: ParityTensorRef;
};

export type ParityRhythmTask = {
  kind: 'rhythm';
  caseName: string;
  graph: BeatThisGraph;
  modelUrl: string;
  filterbankUrl: string;
  unitInput: ParityTensorRef;
};

export type ParityKeyTask = {
  kind: 'key';
  caseName: string;
  graph: SkeyGraph;
  modelUrl: string;
  unitInput: ParityTensorRef;
};

export type ParityChordsTask = {
  kind: 'chords';
  caseName: string;
  graph: ChordNetGraph;
  modelUrl: string;
  planUrl: string;
  planManifestUrl: string;
  unitInput: ParityTensorRef;
};

export type ParityWhisperModelTask = {
  kind: 'whisperModel';
  caseName: string;
  provider: 'wasm' | 'webgpu';
  encoderUrl: string;
  decoderUrl: string;
  features: ParityTensorRef;
  encoderStates: ParityTensorRef;
  tokens: ParityTensorRef;
  promptLength: number;
};

export type ParityWhisperTask = {
  kind: 'whisper';
  caseName: string;
  graph: WhisperGraph;
  modelPath: string;
  modelId: string;
  revision: string;
  language: string;
  unitInput: ParityTensorRef;
};

export type ParityTask =
  | ParityModelTask
  | ParityVocalsTask
  | ParityVoicesTask
  | ParityRhythmTask
  | ParityKeyTask
  | ParityChordsTask
  | ParityWhisperModelTask
  | ParityWhisperTask;

export type ParityJob = {
  tasks: ParityTask[];
};

export const fetchTensor = async (
  tensor: ParityTensorRef,
): Promise<Float32Array<ArrayBuffer> | Int32Array<ArrayBuffer>> => {
  const response = await fetch(tensor.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${tensor.url}: HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  return tensor.dtype === 'int32'
    ? new Int32Array(bytes)
    : new Float32Array(bytes);
};

export type ParityOutput = {
  boundary: string;
  source: string;
  dtype: ParityDtype;
  shape: number[];
  values: Float32Array | Int32Array;
};

export type ParityOutputQuery = {
  run: string;
  caseName: string;
  output: ParityOutput;
};

export const outputQuery = (query: ParityOutputQuery): string =>
  new URLSearchParams({
    run: query.run,
    case: query.caseName,
    boundary: query.output.boundary,
    source: query.output.source,
    dtype: query.output.dtype,
    shape: query.output.shape.join(','),
  }).toString();
