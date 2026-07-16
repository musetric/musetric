import { beatThisModel } from '../models/beatThisModel.js';

const localMaxima = (logits: Float32Array, radius: number): number[] => {
  const peaks: number[] = [];
  for (let i = 0; i < logits.length; i += 1) {
    const from = Math.max(0, i - radius);
    const to = Math.min(logits.length - 1, i + radius);
    let best = logits[from];
    for (let j = from + 1; j <= to; j += 1) {
      if (logits[j] > best) {
        best = logits[j];
      }
    }
    if (logits[i] === best && logits[i] > beatThisModel.peakThreshold) {
      peaks.push(i);
    }
  }
  return peaks;
};

const deduplicatePeaks = (peaks: number[], width: number): number[] => {
  const result: number[] = [];
  let current = 0;
  let count = 0;
  for (const peak of peaks) {
    if (count > 0 && peak - current <= width) {
      count += 1;
      current += (peak - current) / count;
      continue;
    }
    if (count > 0) {
      result.push(current);
    }
    current = peak;
    count = 1;
  }
  if (count > 0) {
    result.push(current);
  }
  return result;
};

const snapToNearest = (times: number[], targets: number[]): number[] => {
  if (targets.length === 0) {
    return times;
  }
  return times.map((time) => {
    let [best] = targets;
    let distance = Math.abs(best - time);
    for (const target of targets) {
      const candidate = Math.abs(target - time);
      if (candidate < distance) {
        best = target;
        distance = candidate;
      }
    }
    return best;
  });
};

const unique = (values: number[]): number[] =>
  [...new Set(values)].sort((a, b) => a - b);

const pickTimes = (logits: Float32Array): number[] => {
  const { peakRadius, deduplicateWidth, fps } = beatThisModel;
  const peaks = deduplicatePeaks(
    localMaxima(logits, peakRadius),
    deduplicateWidth,
  );
  return peaks.map((frame) => frame / fps);
};

export type BeatTimes = {
  beats: number[];
  downbeats: number[];
};

export const pickBeatTimes = (
  beatLogits: Float32Array,
  downbeatLogits: Float32Array,
): BeatTimes => {
  const beats = pickTimes(beatLogits);
  const downbeats = pickTimes(downbeatLogits);
  return { beats, downbeats: unique(snapToNearest(downbeats, beats)) };
};
