export type WaveformSegment = {
  min: number;
  max: number;
};

export const generateWaveformSegments = (
  wavePeaks: Float32Array,
  segmentCount: number,
): WaveformSegment[] => {
  const wavePeakCount = Math.floor(wavePeaks.length / 2);
  const clampedSegmentCount = Math.max(
    0,
    Math.min(segmentCount, wavePeakCount),
  );
  const segments: WaveformSegment[] = [];
  if (!clampedSegmentCount) {
    return segments;
  }

  const step = wavePeakCount / clampedSegmentCount;
  for (let i = 0; i < clampedSegmentCount; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    let min = 1;
    let max = -1;
    for (let j = start; j < end; j++) {
      min = Math.min(min, wavePeaks[j * 2]);
      max = Math.max(max, wavePeaks[j * 2 + 1]);
    }
    segments.push({ min, max });
  }
  return segments;
};
