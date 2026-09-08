export const analyzeKeyApiName = 'musetricAiAnalyzeKey';

export type BrowserAnalyzeKeyRequest = {
  attemptId: string;
  attemptUrl: string;
  outputs: string[];
  modelUrl: string;
};
