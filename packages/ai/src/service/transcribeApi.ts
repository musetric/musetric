import { type PayloadSegment } from '../transcription/types.js';

export const transcribeAudioApiName = 'musetricAiTranscribeAudio';

export type BrowserTranscribeRequest = {
  pcmUrl: string;
  sampleRate: number;

  modelHost: string;
  modelId: string;
  revision: string;

  language?: string;
};

export type BrowserTranscribeResult = PayloadSegment[];
