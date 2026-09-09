import { type WhisperGraph } from '../runtime/modelGraphs.js';
import { type PayloadSegment } from '../transcription/types.js';

export const transcribeAudioApiName = 'musetricAiTranscribeAudio';

export type BrowserTranscribeRequest = {
  attemptId: string;
  attemptUrl: string;
  outputs: string[];
  sampleRate: number;
  graph: WhisperGraph;
  modelHost: string;
  modelId: string;
  revision: string;
  language?: string;
};

export type BrowserTranscribeResult = PayloadSegment[];
