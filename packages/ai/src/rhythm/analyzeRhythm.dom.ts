import { createBeatThisGpuRuntime } from '../runtime/rhythm/beatThisGpuRuntime.js';
import { pickBeatTimes } from './beatPeaks.js';
import { estimateBpm, estimateMeter } from './rhythmSummary.js';
import { type RhythmResult } from './types.js';

export type AnalyzeRhythmInBrowserOptions = {
  audio: Float32Array;
  modelUrl: string;
  filterbank: Float32Array;
  onProgress?: (progress: number) => void;
};

export type RhythmLogits = {
  beat: Float32Array;
  downbeat: Float32Array;
};

export const analyzeRhythmLogitsInBrowser = async (
  options: AnalyzeRhythmInBrowserOptions,
): Promise<RhythmLogits> => {
  const { audio, modelUrl, filterbank, onProgress } = options;
  const analyzeWith = async (): Promise<RhythmLogits> => {
    const runtime = await createBeatThisGpuRuntime({ modelUrl, filterbank });
    try {
      return await runtime.analyze(audio, async (progress) =>
        Promise.resolve(onProgress?.(progress)),
      );
    } finally {
      await runtime.release();
    }
  };
  return await analyzeWith();
};

export const analyzeRhythmInBrowser = async (
  options: AnalyzeRhythmInBrowserOptions,
): Promise<RhythmResult> => {
  const logits = await analyzeRhythmLogitsInBrowser(options);
  const { beats, downbeats } = pickBeatTimes(logits.beat, logits.downbeat);
  return {
    bpm: estimateBpm(beats),
    beats,
    downbeats,
    meter: estimateMeter(beats, downbeats),
  };
};
