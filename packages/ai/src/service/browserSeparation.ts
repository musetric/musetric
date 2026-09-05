import { yieldGpuToCompositor } from '../runtime/gpuCooldown.js';
import { type separateLeadBacking } from '../separation/separateLeadBacking.js';
import { type separateVocals } from '../separation/separateVocals.js';
import {
  interleavedToPlanar,
  planarToInterleaved,
  type StereoAudio,
} from '../separation/stereoAudio.js';
import {
  type BrowserSeparateAudioRequest,
  separateAudioApiName,
  stemDownloadNames,
} from './browserApi.js';
import {
  deliverFile,
  fetchFloat32,
  registerBrowserApi,
  reportProgress,
} from './browserShared.js';

type SeparateVocalsResult = ReturnType<typeof separateVocals>;

const runVocalsStage = async (
  request: BrowserSeparateAudioRequest,
  audio: StereoAudio,
): SeparateVocalsResult => {
  const [{ createVocalsGpuRuntime }, { separateVocals: runSeparateVocals }] =
    await Promise.all([
      import('../runtime/vocals/vocalsRuntime.js'),
      import('../separation/separateVocals.js'),
    ]);
  const runtime = await createVocalsGpuRuntime({
    modelUrl: request.vocalsModelUrl,
    modelDataUrl: request.vocalsModelDataUrl,
    modelDataPath: request.vocalsModelDataPath,
  });
  try {
    return await runSeparateVocals({
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

type SeparateLeadBackingResult = ReturnType<typeof separateLeadBacking>;

const runLeadBackingStage = async (
  request: BrowserSeparateAudioRequest,
  vocals: StereoAudio,
): SeparateLeadBackingResult => {
  const [
    { createLeadBackingGpuRuntime },
    { separateLeadBacking: runSeparateLeadBacking },
  ] = await Promise.all([
    import('../runtime/leadBacking/leadBackingRuntime.js'),
    import('../separation/separateLeadBacking.js'),
  ]);
  const runtime = await createLeadBackingGpuRuntime({
    modelUrl: request.leadBackingModelUrl,
  });
  try {
    return await runSeparateLeadBacking({
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

const deliverStem = async (
  audio: StereoAudio,
  filename: string,
): Promise<void> => {
  const interleaved = planarToInterleaved(audio);
  await deliverFile(filename, interleaved.buffer);
};

export const registerSeparationApi = (): void => {
  registerBrowserApi<BrowserSeparateAudioRequest, void>(
    separateAudioApiName,
    async (request) => {
      const interleaved = await fetchFloat32(request.pcmUrl, 'AI input PCM');
      const sourceAudio = interleavedToPlanar(interleaved, request.sampleRate);

      const vocalsResult = await runVocalsStage(request, sourceAudio);
      await yieldGpuToCompositor();
      const leadBackingResult = await runLeadBackingStage(
        request,
        vocalsResult.vocals,
      );

      await reportProgress(1);

      await deliverStem(leadBackingResult.lead, stemDownloadNames.lead);
      await deliverStem(leadBackingResult.backing, stemDownloadNames.backing);
      await deliverStem(
        vocalsResult.instrumental,
        stemDownloadNames.instrumental,
      );
    },
  );
};
