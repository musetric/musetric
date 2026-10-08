import { trackBeatTimes } from '../rhythm/downbeatTracker.js';
import {
  consecutiveProbeBpms,
  summarizeRhythm,
} from '../rhythm/rhythmSummary.js';
import { type RhythmResult } from '../rhythm/types.js';
import { createBeatThisGpuRuntime } from '../runtime/rhythm/beatThisGpuRuntime.js';
import { createBrowserJobApi } from './browserJob.js';
import { fetchModelFiles, loadModel } from './browserModelLoad.js';
import { fetchFloat32, floatsFromBytes, jsonBytes } from './browserShared.js';
import { type BrowserAnalyzeRhythmRequest } from './rhythmApi.js';

export const analyzeRhythm = createBrowserJobApi<BrowserAnalyzeRhythmRequest>(
  async (request, context) => {
    const filterbank = await fetchFloat32(
      request.filterbankUrl,
      'rhythm mel filterbank',
    );
    const runtime = await loadModel(context, async (report) => {
      const [modelFile] = await fetchModelFiles([request.modelUrl], report);
      return createBeatThisGpuRuntime({
        graph: request.graph,
        modelFile,
        filterbank,
      });
    });
    try {
      await context.serveUnits({
        attemptId: request.attemptId,
        attemptUrl: request.attemptUrl,
        outputs: request.outputs,
        run: async (bytes) => {
          const audio = floatsFromBytes(bytes);
          const logits = await runtime.analyze(audio);
          const { beats, downbeats } = trackBeatTimes(
            logits.beat,
            logits.downbeat,
            request.graph.fps,
          );
          const duration =
            audio.length / (request.graph.hopLength * request.graph.fps);
          const result: RhythmResult = summarizeRhythm(
            beats,
            downbeats,
            consecutiveProbeBpms(beats, duration),
          );
          return jsonBytes(result);
        },
      });
    } finally {
      await runtime.release();
    }
  },
);
