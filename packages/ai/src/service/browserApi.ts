import { type UnitProgress } from '../runtime/unitProgress.js';

export const separateAudioApiName = 'musetricAiSeparateAudio';
export const reportPhaseApiName = 'musetricAiReportPhase';

export const stemDownloadNames = {
  lead: 'lead.pcm',
  backing: 'backing.pcm',
  instrumental: 'instrumental.pcm',
} as const;

export type BrowserSeparateAudioRequest = {
  pcmUrl: string;
  sampleRate: number;
  vocalsModelUrl: string;
  vocalsModelDataUrl: string;
  vocalsModelDataPath: string;
  leadBackingModelUrl: string;
};

export type BrowserRunningPass = 'decode' | 'repair';

export type BrowserRunningUnits = UnitProgress & {
  pass: BrowserRunningPass;
};

export type BrowserPhaseMessage =
  | { type: 'loading' }
  | ({ type: 'running' } & BrowserRunningUnits);
