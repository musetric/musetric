import { type Engine } from '@musetric/engine';

export type CapturedChunk = {
  startMs: number;
  sampleRate: number;
  samples: Float32Array;
};

export type CapturedListener = (chunk: CapturedChunk) => void;

export type PageHooks = {
  engine: Engine;
  listenCaptured: (listener: CapturedListener) => () => void;
};
