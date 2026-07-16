export const analyzeChordsApiName = 'musetricAiAnalyzeChords';
export const releaseChordsApiName = 'musetricAiReleaseChords';

export type BrowserAnalyzeChordsRequest = {
  pcmUrl: string;
  modelUrl: string;
  planUrl: string;
  planManifestUrl?: string;
};

export type BrowserAnalyzeChordsResult = number[];
