import { pickBeatTimes } from '../rhythm/beatPeaks.js';
import { estimateBpm, estimateMeter } from '../rhythm/rhythmSummary.js';
import { type RhythmResult } from '../rhythm/types.js';
import {
  fetchFloat32,
  registerBrowserApi,
  reportLoading,
  reportRunning,
} from './browserShared.js';
import {
  analyzeRhythmApiName,
  type BrowserAnalyzeRhythmRequest,
} from './rhythmApi.js';

export const registerRhythmApi = (): void => {
  registerBrowserApi<BrowserAnalyzeRhythmRequest, RhythmResult>(
    analyzeRhythmApiName,
    async (request) => {
      await reportLoading();
      const audio = await fetchFloat32(request.pcmUrl, 'rhythm PCM');

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
        const logits = await runtime.analyze(audio, async (units) => {
          await reportRunning({ pass: 'decode', ...units });
        });
        const { beats, downbeats } = pickBeatTimes(
          logits.beat,
          logits.downbeat,
        );
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
