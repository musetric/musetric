import { type TranscriptionSegment } from './types.js';

const silenceRmsRatio = 0.2;
const silenceRmsMin = 0.005;

const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const segmentRms = (
  segment: TranscriptionSegment,
  audio: Float32Array,
  sampleRate: number,
): number => {
  const start = Math.trunc(Math.max(0, segment.start) * sampleRate);
  const end = Math.trunc(Math.max(0, segment.end) * sampleRate);
  if (end <= start) {
    return 0;
  }
  const lo = Math.min(start, audio.length);
  const hi = Math.min(end, audio.length);
  if (hi <= lo) {
    return 0;
  }
  let sum = 0;
  for (let i = lo; i < hi; i++) {
    sum += audio[i] * audio[i];
  }
  return Math.sqrt(sum / (hi - lo));
};

export const filterSilentSegments = (
  segments: TranscriptionSegment[],
  audio: Float32Array,
  sampleRate = 16000,
): TranscriptionSegment[] => {
  if (segments.length === 0) {
    return segments;
  }
  const rmsValues = segments.map((segment) =>
    segmentRms(segment, audio, sampleRate),
  );
  const medianRms = median(rmsValues);
  const threshold = Math.max(silenceRmsMin, medianRms * silenceRmsRatio);
  return segments.filter((_, index) => rmsValues[index] >= threshold);
};
