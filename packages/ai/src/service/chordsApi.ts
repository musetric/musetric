export const analyzeChordsApiName = 'musetricAiAnalyzeChords';

export type BrowserAnalyzeChordsRequest = {
  attemptId: string;
  attemptUrl: string;
  outputs: string[];
  modelUrl: string;
  planUrl: string;
  planManifestUrl?: string;
};
