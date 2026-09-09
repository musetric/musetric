import { type BeatThisGraph } from '../runtime/modelGraphs.js';

export const analyzeRhythmApiName = 'musetricAiAnalyzeRhythm';

export type BrowserAnalyzeRhythmRequest = {
  attemptId: string;
  attemptUrl: string;
  outputs: string[];
  graph: BeatThisGraph;
  modelUrl: string;
  filterbankUrl: string;
};
