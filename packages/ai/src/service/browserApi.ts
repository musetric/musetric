export const separateAudioApiName = 'musetricAiSeparateAudio';
export const reportProgressApiName = 'musetricAiReportProgress';

export const stemDownloadNames = {
  lead: 'lead.pcm',
  backing: 'backing.pcm',
  instrumental: 'instrumental.pcm',
} as const;

export type StemKey = keyof typeof stemDownloadNames;

export type BrowserSeparateAudioRequest = {
  pcmUrl: string;
  sampleRate: number;
  vocalsModelUrl: string;
  vocalsModelDataUrl: string;
  vocalsModelDataPath: string;
  leadBackingModelUrl: string;
};

export type BrowserProgressMessage = {
  type: 'progress';
  progress: number;
};
