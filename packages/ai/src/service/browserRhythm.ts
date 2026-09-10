import { pickBeatTimes } from '../rhythm/beatPeaks.js';
import { estimateBpm, estimateMeter } from '../rhythm/rhythmSummary.js';
import { type RhythmResult } from '../rhythm/types.js';
import { createBrowserJobApi } from './browserJob.js';
import { fetchFloat32, floatsFromBytes, jsonBytes } from './browserShared.js';
import { type BrowserAnalyzeRhythmRequest } from './rhythmApi.js';

export const analyzeRhythm = createBrowserJobApi<BrowserAnalyzeRhythmRequest>(
  async (request, context) => {
    context.reportLoading();
    const { createBeatThisGpuRuntime } =
      await import('../runtime/rhythm/beatThisGpuRuntime.js');
    const filterbank = await fetchFloat32(
      request.filterbankUrl,
      'rhythm mel filterbank',
    );
    const runtime = await createBeatThisGpuRuntime({
      graph: request.graph,
      modelUrl: request.modelUrl,
      filterbank,
    });
    try {
      await context.serveUnits({
        attemptId: request.attemptId,
        attemptUrl: request.attemptUrl,
        outputs: request.outputs,
        run: async (bytes) => {
          const audio = floatsFromBytes(bytes);
          const logits = await runtime.analyze(audio);
          const { beats, downbeats } = pickBeatTimes(
            logits.beat,
            logits.downbeat,
            request.graph.fps,
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
