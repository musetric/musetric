export const analyzeRhythmApiName = 'musetricAiAnalyzeRhythm';

export type BrowserAnalyzeRhythmRequest = {
  attemptId: string;
  attemptUrl: string;
  outputs: string[];
  modelUrl: string;
  filterbankUrl: string;
};
