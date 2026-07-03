import timeStretchSource from 'signalsmith-stretch?raw';

export type TimeStretchWasmModule = {
  HEAP8: Int8Array;
  _flush: (outputSamples: number) => void;
  _inputLatency: () => number;
  _main: () => void;
  _outputLatency: () => number;
  _presetDefault: (channelCount: number, sampleRate: number) => void;
  _process: (inputSamples: number, outputSamples: number) => void;
  _reset: () => void;
  _setBuffers: (channelCount: number, length: number) => number;
  _setFormantBase: (frequency: number) => void;
  _setFormantSemitones: (semitones: number, compensate: boolean) => void;
  _setTransposeSemitones: (semitones: number, tonalityLimit: number) => void;
  _seek: (inputSamples: number, playbackRate: number) => void;
};

const wasmFunctionKeys = [
  '_flush',
  '_inputLatency',
  '_main',
  '_outputLatency',
  '_presetDefault',
  '_process',
  '_reset',
  '_setBuffers',
  '_setFormantBase',
  '_setFormantSemitones',
  '_setTransposeSemitones',
  '_seek',
] satisfies (keyof TimeStretchWasmModule)[];

const isUnknownRecord = (value: unknown): value is Record<string, unknown> => {
  return Object.prototype.toString.call(value) === '[object Object]';
};

const isEmscriptenTimeStretchWasmModule = (
  value: unknown,
): value is TimeStretchWasmModule => {
  if (!isUnknownRecord(value) || !(value.HEAP8 instanceof Int8Array)) {
    return false;
  }

  return wasmFunctionKeys.every((key) => {
    return typeof value[key] === 'function';
  });
};

export const createTimeStretchWasmModule =
  async (): Promise<TimeStretchWasmModule> => {
    const wrapperIndex = timeStretchSource.indexOf(
      'function registerWorkletProcessor',
    );
    if (wrapperIndex === -1) {
      throw new Error('Time stretch worklet wrapper was not found.');
    }

    const moduleSource = timeStretchSource.slice(0, wrapperIndex);
    const createFactory = new Function(
      `${moduleSource}; return SignalsmithStretch;`,
    );
    const factory = createFactory();
    const wasmModule = await factory();
    if (!isEmscriptenTimeStretchWasmModule(wasmModule)) {
      throw new Error('Time stretch WASM module did not initialize.');
    }

    return wasmModule;
  };
