const clearClickRatio = 10;
const faintClickRatio = 7;
const noisyRoomLevel = 0.01;
const clickSpreadSeconds = 0.01;
const minimumClickCount = 3;
const silenceLevel = 1e-6;

export type RecordingLatencyCalibrationPeak = {
  clickFrame: number;
  onsetFrame: number;
  peakValue: number;
  noiseValue: number;
};

const standsAbove = (peak: RecordingLatencyCalibrationPeak, ratio: number) =>
  peak.peakValue > silenceLevel && peak.peakValue >= peak.noiseValue * ratio;

const getDelayFrameCount = (peak: RecordingLatencyCalibrationPeak) =>
  Math.max(0, peak.onsetFrame - peak.clickFrame);

const getClickFrameCounts = (
  peaks: RecordingLatencyCalibrationPeak[],
  ratio: number,
) => peaks.filter((peak) => standsAbove(peak, ratio)).map(getDelayFrameCount);

export const getMedianFrameCount = (frameCounts: number[]) => {
  const sortedFrameCounts = [...frameCounts].sort(
    (left, right) => left - right,
  );
  return sortedFrameCounts[Math.floor(sortedFrameCounts.length / 2)];
};

const isAgreeing = (
  frameCount: number,
  medianFrameCount: number,
  sampleRate: number,
) => Math.abs(frameCount - medianFrameCount) <= clickSpreadSeconds * sampleRate;

const getAgreeingFrameCounts = (frameCounts: number[], sampleRate: number) => {
  if (frameCounts.length < minimumClickCount) {
    return [];
  }
  const medianFrameCount = getMedianFrameCount(frameCounts);
  return frameCounts.filter((frameCount) =>
    isAgreeing(frameCount, medianFrameCount, sampleRate),
  );
};

export type RecordingLatencyCalibrationClickVerdict =
  'clear' | 'faint' | 'stray' | 'missed';

export const getRecordingLatencyCalibrationClickVerdict = (
  peak: RecordingLatencyCalibrationPeak,
): Exclude<RecordingLatencyCalibrationClickVerdict, 'stray'> => {
  if (standsAbove(peak, clearClickRatio)) {
    return 'clear';
  }
  return standsAbove(peak, faintClickRatio) ? 'faint' : 'missed';
};

export const getRecordingLatencyCalibrationClickVerdicts = (
  peaks: RecordingLatencyCalibrationPeak[],
  sampleRate: number,
): RecordingLatencyCalibrationClickVerdict[] => {
  const verdicts = peaks.map(getRecordingLatencyCalibrationClickVerdict);
  const clearFrameCounts = getClickFrameCounts(peaks, clearClickRatio);
  if (clearFrameCounts.length < minimumClickCount) {
    return verdicts;
  }
  const medianFrameCount = getMedianFrameCount(clearFrameCounts);
  return verdicts.map((verdict, index) =>
    verdict === 'clear' &&
    !isAgreeing(getDelayFrameCount(peaks[index]), medianFrameCount, sampleRate)
      ? 'stray'
      : verdict,
  );
};

export type RecordingLatencyCalibrationOutcome =
  | { kind: 'measured'; measuredLatencyFrameCounts: number[] }
  | { kind: 'noisy' }
  | { kind: 'quiet' }
  | { kind: 'unsteady' }
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
  if (getClickFrameCounts(peaks, clearClickRatio).length >= minimumClickCount) {
    return { kind: 'unsteady' };
  }
  const noiseValues = peaks.map((peak) => peak.noiseValue);
  return noiseValues.length > 0 &&
    getMedianFrameCount(noiseValues) >= noisyRoomLevel
    ? { kind: 'noisy' }
    : { kind: 'silent' };
};
