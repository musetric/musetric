import { type VocalsPinGraph } from '../runtime/modelGraphs.js';
import { type StemValues } from '../separation/separationStems.js';

export const separateApiName = 'musetricAiSeparate';

export const separationStateOutput = 'state';

export type BrowserSeparateRequest = {
  attemptUrl: string;
  sampleRate: number;
  graph: VocalsPinGraph;
  vocalsModelUrl: string;
  vocalsModelDataUrl: string;
  vocalsModelDataPath: string;
  mixture: {
    url: string;
    frames: number;
  };
  stateUrl?: string;
};

export type BrowserSeparateResult = {
  scales: StemValues;
};
