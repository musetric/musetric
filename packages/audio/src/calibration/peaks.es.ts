const clearClickRatio = 10;
const faintClickRatio = 7;
const noisyRoomLevel = 0.01;
const clickSpreadSeconds = 0.01;
const minimumClickCount = 3;

export type RecordingLatencyCalibrationPeak = {
  clickFrame: number;
  onsetFrame: number;
  peakValue: number;
  noiseValue: number;
};

const getClickFrameCounts = (
  peaks: RecordingLatencyCalibrationPeak[],
  ratio: number,
) =>
  peaks
    .filter((peak) => peak.peakValue >= peak.noiseValue * ratio)
    .map((peak) => Math.max(0, peak.onsetFrame - peak.clickFrame));

export const getMedianFrameCount = (frameCounts: number[]) => {
  const sortedFrameCounts = [...frameCounts].sort(
    (left, right) => left - right,
  );
  return sortedFrameCounts[Math.floor(sortedFrameCounts.length / 2)];
};

const getAgreeingFrameCounts = (frameCounts: number[], sampleRate: number) => {
  if (frameCounts.length < minimumClickCount) {
    return [];
  }
  const medianFrameCount = getMedianFrameCount(frameCounts);
  const spreadFrameCount = clickSpreadSeconds * sampleRate;
  return frameCounts.filter(
    (frameCount) => Math.abs(frameCount - medianFrameCount) <= spreadFrameCount,
  );
};

export type RecordingLatencyCalibrationOutcome =
  | { kind: 'measured'; measuredLatencyFrameCounts: number[] }
  | { kind: 'noisy' }
  | { kind: 'quiet' }
  | { kind: 'silent' };

export const getRecordingLatencyCalibrationOutcome = (
  peaks: RecordingLatencyCalibrationPeak[],
  sampleRate: number,
): RecordingLatencyCalibrationOutcome => {
  const measuredLatencyFrameCounts = getAgreeingFrameCounts(
    getClickFrameCounts(peaks, clearClickRatio),
    sampleRate,
  );
  if (measuredLatencyFrameCounts.length >= minimumClickCount) {
    return { kind: 'measured', measuredLatencyFrameCounts };
  }
  const faintFrameCounts = getAgreeingFrameCounts(
    getClickFrameCounts(peaks, faintClickRatio),
    sampleRate,
  );
  if (faintFrameCounts.length >= minimumClickCount) {
    return { kind: 'quiet' };
  }
  const noiseValues = peaks.map((peak) => peak.noiseValue);
  return noiseValues.length > 0 &&
    getMedianFrameCount(noiseValues) >= noisyRoomLevel
    ? { kind: 'noisy' }
    : { kind: 'silent' };
};
