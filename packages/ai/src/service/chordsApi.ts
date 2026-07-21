export const analyzeChordsApiName = 'musetricAiAnalyzeChords';

export type BrowserAnalyzeChordsRequest = {
  pcmUrl: string;
  modelUrl: string;
  planUrl: string;
  planManifestUrl?: string;
};

export type BrowserAnalyzeChordsResult = number[];
