import { yieldGpuToCompositor } from '../runtime/gpuCooldown.js';
import { type ReportUnit } from '../runtime/unitProgress.js';
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
  reportLoading,
  reportRunning,
} from './browserShared.js';

type StageOptions = {
  request: BrowserSeparateAudioRequest;
  audio: StereoAudio;
  onUnit: ReportUnit;
};

type SeparateVocalsResult = ReturnType<typeof separateVocals>;

const runVocalsStage = async (options: StageOptions): SeparateVocalsResult => {
  const [{ createVocalsGpuRuntime }, { separateVocals: runSeparateVocals }] =
    await Promise.all([
      import('../runtime/vocals/vocalsRuntime.js'),
      import('../separation/separateVocals.js'),
    ]);
  const runtime = await createVocalsGpuRuntime({
    modelUrl: options.request.vocalsModelUrl,
    modelDataUrl: options.request.vocalsModelDataUrl,
    modelDataPath: options.request.vocalsModelDataPath,
  });
  try {
    return await runSeparateVocals({
      audio: options.audio,
      runtime,
      onUnit: options.onUnit,
    });
  } finally {
    await runtime.release();
  }
};

type SeparateLeadBackingResult = ReturnType<typeof separateLeadBacking>;

const runLeadBackingStage = async (
  options: StageOptions,
): SeparateLeadBackingResult => {
  const [
    { createLeadBackingGpuRuntime },
    { separateLeadBacking: runSeparateLeadBacking },
  ] = await Promise.all([
    import('../runtime/leadBacking/leadBackingRuntime.js'),
    import('../separation/separateLeadBacking.js'),
  ]);
  const runtime = await createLeadBackingGpuRuntime({
    modelUrl: options.request.leadBackingModelUrl,
  });
  try {
    return await runSeparateLeadBacking({
      audio: options.audio,
      runtime,
      onUnit: options.onUnit,
    });
  } finally {
    await runtime.release();
  }
};

type SeparationUnits = {
  vocals: number;
  total: number;
};

const countUnits = async (audio: StereoAudio): Promise<SeparationUnits> => {
  const [{ countVocalsUnits }, { countLeadBackingUnits }] = await Promise.all([
    import('../separation/separateVocals.js'),
    import('../separation/separateLeadBacking.js'),
  ]);
  const vocals = countVocalsUnits(audio);
  return { vocals, total: vocals + countLeadBackingUnits(audio) };
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
      await reportLoading();
      const interleaved = await fetchFloat32(request.pcmUrl, 'AI input PCM');
      const sourceAudio = interleavedToPlanar(interleaved, request.sampleRate);

      const units = await countUnits(sourceAudio);

      const vocalsResult = await runVocalsStage({
        request,
        audio: sourceAudio,
        onUnit: async (progress) =>
          reportRunning({
            pass: 'decode',
            unit: progress.unit,
            unitCount: units.total,
          }),
      });
      await yieldGpuToCompositor();
      const leadBackingResult = await runLeadBackingStage({
        request,
        audio: vocalsResult.vocals,
        onUnit: async (progress) =>
          reportRunning({
            pass: 'decode',
            unit: units.vocals + progress.unit,
            unitCount: units.total,
          }),
      });

      await deliverStem(leadBackingResult.lead, stemDownloadNames.lead);
      await deliverStem(leadBackingResult.backing, stemDownloadNames.backing);
      await deliverStem(
        vocalsResult.instrumental,
        stemDownloadNames.instrumental,
      );
    },
  );
};
