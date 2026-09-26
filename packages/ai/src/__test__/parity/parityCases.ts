export type ParityStep = 'vocals' | 'voices' | 'rhythm' | 'key' | 'chords';

export type ParitySource = {
  url: string;
  sha256: string;
  credit: string;
};

export type ParityStem = {
  case: string;
  stem: string;
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
};

export type ParityCaseFile = {
  sources: Record<string, ParitySource>;
  cases: ParityCase[];
};

export const paritySourceRate = 44100;
export const paritySourceChannels = 2;

export type ParityWasm = 'none' | 'desktop' | 'all';

export type ParityStepModel = {
  bundle: string;
  graph: string;
  wasm: ParityWasm;
  webgpu: boolean;
  simpleBufferCache: boolean;
  outputs: Record<string, string>;
};

export const parityStepModels: Record<ParityStep, ParityStepModel> = {
  vocals: {
    bundle: 'VOCALS',
    graph: 'vocals',
    wasm: 'none',
    webgpu: true,
    simpleBufferCache: true,
    outputs: { outputName: 'model.output' },
  },
  voices: {
    bundle: 'LEAD_BACKING',
    graph: 'lead_backing',
    wasm: 'desktop',
    webgpu: true,
    simpleBufferCache: true,
    outputs: { outputName: 'model.output' },
  },
  rhythm: {
    bundle: 'BEAT_THIS',
    graph: 'beat_this',
    wasm: 'desktop',
    webgpu: true,
    simpleBufferCache: true,
    outputs: {
      beatOutputName: 'model.output.beat',
      downbeatOutputName: 'model.output.downbeat',
    },
  },
  key: {
    bundle: 'SKEY',
    graph: 'skey',
    wasm: 'all',
    webgpu: false,
    simpleBufferCache: false,
    outputs: { outputName: 'model.output' },
  },
  chords: {
    bundle: 'CHORD_NET',
    graph: 'chord_net',
    wasm: 'desktop',
    webgpu: true,
    simpleBufferCache: false,
    outputs: { outputName: 'model.output' },
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
