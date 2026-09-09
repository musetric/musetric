import { type ChordNetGraph } from '../runtime/modelGraphs.js';

export const analyzeChordsApiName = 'musetricAiAnalyzeChords';

export type BrowserAnalyzeChordsRequest = {
  attemptId: string;
  attemptUrl: string;
  outputs: string[];
  graph: ChordNetGraph;
  modelUrl: string;
  planUrl: string;
  planManifestUrl?: string;
};
