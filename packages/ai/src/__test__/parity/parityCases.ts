import { type ParityPinName } from './parityModels.js';

export type ParityStep =
  'vocals' | 'rhythm' | 'key' | 'chords' | 'transcribe' | 'lines';

export type ParitySource = {
  url: string;
  sha256: string;
  credit: string;
  referer?: string;
};

export type ParityStem = {
  case: string;
  stem: string;
  backing?: string;
};

export type ParityCase = {
  name: string;
  step: ParityStep;
  source?: string;
  input?: ParityStem;
  from?: number;
  to?: number;
  gain?: number;
  sampleRate?: number;
  channels?: number;
  language?: string;
};

export type ParityCaseFile = {
  sources: Record<string, ParitySource>;
  cases: ParityCase[];
};

export const paritySourceRate = 44100;
export const paritySourceChannels = 2;

export type ParityWasm = 'none' | 'desktop' | 'all';

export type ParityStepModel = {
  pin: ParityPinName;
  wasm: ParityWasm;
  webgpu: boolean;
  simpleBufferCache: boolean;
  outputs: Record<string, string>;
};

export const parityStepModels: Record<ParityStep, ParityStepModel> = {
  vocals: {
    pin: 'separation',
    wasm: 'none',
    webgpu: true,
    simpleBufferCache: true,
    outputs: { outputName: 'model.output' },
  },
  rhythm: {
    pin: 'rhythm',
    wasm: 'desktop',
    webgpu: true,
    simpleBufferCache: true,
    outputs: {
      beatOutputName: 'model.output.beat',
      downbeatOutputName: 'model.output.downbeat',
    },
  },
  key: {
    pin: 'key',
    wasm: 'all',
    webgpu: false,
    simpleBufferCache: false,
    outputs: { outputName: 'model.output' },
  },
  chords: {
    pin: 'chords',
    wasm: 'desktop',
    webgpu: true,
    simpleBufferCache: false,
    outputs: { outputName: 'model.output' },
  },
  transcribe: {
    pin: 'transcription',
    wasm: 'desktop',
    webgpu: true,
    simpleBufferCache: false,
    outputs: {},
  },
  lines: {
    pin: 'transcription',
    wasm: 'none',
    webgpu: false,
    simpleBufferCache: false,
    outputs: {},
  },
};

export const isParityStep = (value: string): value is ParityStep =>
  Object.hasOwn(parityStepModels, value);

export const wasmRuns = (step: ParityStep, desktop: boolean): boolean => {
  const { wasm } = parityStepModels[step];
  return wasm === 'all' || (wasm === 'desktop' && desktop);
};

export type ParityDevice = {
  name: string;
  serial?: string;
};
