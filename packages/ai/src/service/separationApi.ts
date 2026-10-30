import { type VocalsGraph } from '../runtime/modelGraphs.js';

export const separateUnitsApiName = 'musetricAiSeparateUnits';

export type BrowserSeparateUnitsRequest = {
  attemptId: string;
  attemptUrl: string;
  outputs: string[];
  graph: VocalsGraph;
  vocalsModelUrl: string;
  vocalsModelDataUrl: string;
  vocalsModelDataPath: string;
};
