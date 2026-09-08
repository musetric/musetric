import { pickBeatTimes } from '../rhythm/beatPeaks.js';
import { estimateBpm, estimateMeter } from '../rhythm/rhythmSummary.js';
import { type RhythmResult } from '../rhythm/types.js';
import {
  fetchFloat32,
  floatsFromBytes,
  jsonBytes,
  registerBrowserApi,
  reportLoading,
} from './browserShared.js';
import { serveUnits } from './browserUnitServing.js';
import {
  analyzeRhythmApiName,
  type BrowserAnalyzeRhythmRequest,
} from './rhythmApi.js';

export const registerRhythmApi = (): void => {
  registerBrowserApi<BrowserAnalyzeRhythmRequest, void>(
    analyzeRhythmApiName,
    async (request) => {
      await reportLoading();
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
        await serveUnits({
          attemptId: request.attemptId,
          attemptUrl: request.attemptUrl,
          outputs: request.outputs,
          run: async (bytes) => {
            const audio = floatsFromBytes(bytes);
            const logits = await runtime.analyze(audio);
            const { beats, downbeats } = pickBeatTimes(
              logits.beat,
              logits.downbeat,
            );
            const result: RhythmResult = {
              bpm: estimateBpm(beats),
              beats,
              downbeats,
              meter: estimateMeter(beats, downbeats),
            };
            return jsonBytes(result);
          },
        });
      } finally {
        await runtime.release();
      }
    },
  );
};
