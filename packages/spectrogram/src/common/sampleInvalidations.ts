import { type TrackKey } from '../config.cross.js';
import { type SpectrogramSampleRange } from './extConfig.js';

export type SpectrogramSampleInvalidation = SpectrogramSampleRange & {
  trackKey: TrackKey;
};

export const mergeSampleInvalidation = (
  pending: readonly SpectrogramSampleInvalidation[],
  invalidation: SpectrogramSampleInvalidation,
): SpectrogramSampleInvalidation[] => {
  if (invalidation.frameCount <= 0) {
    return [...pending];
  }
  let nextStart = invalidation.frameIndex;
  let nextEnd = invalidation.frameIndex + invalidation.frameCount;
  const merged: SpectrogramSampleInvalidation[] = [];
  for (const current of pending) {
    const currentEnd = current.frameIndex + current.frameCount;
    const disjoint =
      current.trackKey !== invalidation.trackKey ||
      nextStart > currentEnd ||
      nextEnd < current.frameIndex;
    if (disjoint) {
      merged.push(current);
      continue;
    }
    nextStart = Math.min(current.frameIndex, nextStart);
    nextEnd = Math.max(currentEnd, nextEnd);
  }
  merged.push({
    trackKey: invalidation.trackKey,
    frameIndex: nextStart,
    frameCount: nextEnd - nextStart,
  });
  return merged;
};
