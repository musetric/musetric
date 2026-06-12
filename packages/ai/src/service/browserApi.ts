// Shared contract between the node host (headlessAiService.node.ts) and the
// browser page (browserEntry.ts). Both sides must use these names and types.
export const separateAudioApiName = 'musetricAiSeparateAudio';
export const reportProgressApiName = 'musetricAiReportProgress';

export type BrowserSeparateAudioRequest = {
  sampleRate: number;
  samples: number;
  audioUrl: string;
  vocalsModelUrl: string;
  vocalsModelDataUrl: string;
  vocalsModelDataPath: string;
  leadBackingModelUrl: string;
};

export type BrowserSeparateAudioResponse = {
  leadToken: string;
  backingToken: string;
  instrumentalToken: string;
};

export type BrowserProgressMessage = {
  type: 'progress';
  progress: number;
};
