import { type WhisperGraph } from '../runtime/modelGraphs.js';

export const transcribeAudioApiName = 'musetricAiTranscribeAudio';

export type BrowserTranscribeRequest = {
  attemptId: string;
  attemptUrl: string;
  outputs: string[];
  sampleRate: number;
  chunkSize: number;
  seamSeconds: number;
  graph: WhisperGraph;
  modelHost: string;
  modelId: string;
  revision: string;
  language?: string;
};
