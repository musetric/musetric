import { createLeadBackingGpuRuntime } from '../runtime/leadBacking/leadBackingRuntime.js';
import { createVocalsGpuRuntime } from '../runtime/vocals/vocalsRuntime.js';
import { separateLeadBacking } from '../separation/separateLeadBacking.js';
import { separateVocals } from '../separation/separateVocals.js';
import {
  interleavedToPlanar,
  planarToInterleaved,
  type StereoAudio,
} from '../separation/stereoAudio.js';
import {
  type BrowserProgressMessage,
  type BrowserSeparateAudioRequest,
  reportProgressApiName,
  separateAudioApiName,
  stemDownloadNames,
} from './browserApi.js';

type AnchorElement = {
  href: string;
  download: string;
  click: () => void;
  remove: () => void;
};
declare const document: {
  createElement: (tagName: 'a') => AnchorElement;
  body: { appendChild: (node: AnchorElement) => void };
};

const reportProgress = async (progress: number): Promise<void> => {
  const api: unknown = Reflect.get(globalThis, reportProgressApiName);
  if (typeof api !== 'function') {
    throw new Error('AI progress API is not initialized');
  }
  const message: BrowserProgressMessage = { type: 'progress', progress };
  await Reflect.apply(api, undefined, [message]);
};

const runVocalsStage = async (
  request: BrowserSeparateAudioRequest,
  audio: StereoAudio,
): ReturnType<typeof separateVocals> => {
  const runtime = await createVocalsGpuRuntime({
    modelUrl: request.vocalsModelUrl,
    modelDataUrl: request.vocalsModelDataUrl,
    modelDataPath: request.vocalsModelDataPath,
  });
  try {
    return await separateVocals({
      audio,
      runtime,
      onMessage: async (message) => {
        await reportProgress(message.progress / 2);
      },
    });
  } finally {
    await runtime.release();
  }
};

const runLeadBackingStage = async (
  request: BrowserSeparateAudioRequest,
  vocals: StereoAudio,
): ReturnType<typeof separateLeadBacking> => {
  const runtime = await createLeadBackingGpuRuntime({
    modelUrl: request.leadBackingModelUrl,
  });
  try {
    return await separateLeadBacking({
      audio: vocals,
      runtime,
      onMessage: async (message) => {
        await reportProgress(0.5 + message.progress / 2);
      },
    });
  } finally {
    await runtime.release();
  }
};

const fetchInterleavedPcm = async (
  pcmUrl: string,
): Promise<Float32Array<ArrayBuffer>> => {
  const response = await fetch(pcmUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch AI input PCM: HTTP ${response.status}`);
  }
  return new Float32Array(await response.arrayBuffer());
};

const downloadStem = async (
  audio: StereoAudio,
  filename: string,
): Promise<void> => {
  const interleaved = planarToInterleaved(audio);
  const blob = new Blob([interleaved.buffer], {
    type: 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  await new Promise((resolve) => setTimeout(resolve, 250));
  URL.revokeObjectURL(url);
};

Reflect.set(
  globalThis,
  separateAudioApiName,
  async (request: BrowserSeparateAudioRequest): Promise<void> => {
    const interleaved = await fetchInterleavedPcm(request.pcmUrl);
    const sourceAudio = interleavedToPlanar(interleaved, request.sampleRate);

    const vocalsResult = await runVocalsStage(request, sourceAudio);
    const leadBackingResult = await runLeadBackingStage(
      request,
      vocalsResult.vocals,
    );

    await reportProgress(1);

    await downloadStem(leadBackingResult.lead, stemDownloadNames.lead);
    await downloadStem(leadBackingResult.backing, stemDownloadNames.backing);
    await downloadStem(
      vocalsResult.instrumental,
      stemDownloadNames.instrumental,
    );
  },
);
