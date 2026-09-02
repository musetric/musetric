import { pickBeatTimes } from '../rhythm/beatPeaks.js';
import { estimateBpm, estimateMeter } from '../rhythm/rhythmSummary.js';
import { type RhythmResult } from '../rhythm/types.js';
import {
  fetchFloat32,
  registerBrowserApi,
  reportProgress,
} from './browserShared.js';
import {
  analyzeRhythmApiName,
  type BrowserAnalyzeRhythmRequest,
} from './rhythmApi.js';

export const registerRhythmApi = (): void => {
  registerBrowserApi<BrowserAnalyzeRhythmRequest, RhythmResult>(
    analyzeRhythmApiName,
    async (request) => {
      await reportProgress(0);
      const audio = await fetchFloat32(request.pcmUrl, 'rhythm PCM');
      await reportProgress(0.1);

      const { createBeatThisGpuRuntime } =
        await import('../runtime/rhythm/beatThisGpuRuntime.js');
      const filterbank = await fetchFloat32(
        request.filterbankUrl,
        'rhythm mel filterbank',
      );
      const runtime = await createBeatThisGpuRuntime({
        modelUrl: request.modelUrl,
        filterbank,
      });
      try {
        const logits = await runtime.analyze(audio, async (progress) => {
          await reportProgress(0.1 + progress * 0.8);
        });
        const { beats, downbeats } = pickBeatTimes(
          logits.beat,
          logits.downbeat,
        );
        await reportProgress(1);
        return {
          bpm: estimateBpm(beats),
          beats,
          downbeats,
          meter: estimateMeter(beats, downbeats),
        };
      } finally {
        await runtime.release();
      }
    },
  );
};
