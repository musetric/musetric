export const analyzeRhythmApiName = 'musetricAiAnalyzeRhythm';
export const releaseRhythmApiName = 'musetricAiReleaseRhythm';

export type BrowserAnalyzeRhythmRequest = {
  pcmUrl: string;
  modelUrl: string;
  filterbankUrl: string;
};

export type BrowserAnalyzeRhythmResult = {
  beat: number[];
  downbeat: number[];
};
