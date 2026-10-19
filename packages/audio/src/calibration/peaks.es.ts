const peakThreshold = 0.02;
const faintPeakThreshold = 0.004;
const clickSpreadSeconds = 0.01;
const minimumClickCount = 3;

export type RecordingLatencyCalibrationPeak = {
  clickFrame: number;
  onsetFrame: number;
  peakValue: number;
};

const getOnsetFrameCounts = (
  peaks: RecordingLatencyCalibrationPeak[],
  threshold: number,
) =>
  peaks
    .filter((peak) => peak.peakValue >= threshold)
    .map((peak) => Math.max(0, peak.onsetFrame - peak.clickFrame));

export const getRecordingLatencyCalibrationFrameCounts = (
  peaks: RecordingLatencyCalibrationPeak[],
) => getOnsetFrameCounts(peaks, peakThreshold);

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
  const loudFrameCounts = getRecordingLatencyCalibrationFrameCounts(peaks);
  const measuredLatencyFrameCounts = getAgreeingFrameCounts(
    loudFrameCounts,
    sampleRate,
  );
  if (measuredLatencyFrameCounts.length >= minimumClickCount) {
    return { kind: 'measured', measuredLatencyFrameCounts };
  }
  if (loudFrameCounts.length >= minimumClickCount) {
    return { kind: 'noisy' };
  }
  const faintFrameCounts = getAgreeingFrameCounts(
    getOnsetFrameCounts(peaks, faintPeakThreshold),
    sampleRate,
  );
  return faintFrameCounts.length >= minimumClickCount
    ? { kind: 'quiet' }
    : { kind: 'silent' };
};
