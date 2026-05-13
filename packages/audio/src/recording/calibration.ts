import type { RecordingLatencyCalibrationPeak } from './protocol.cross.js';
export type { RecordingLatencyCalibrationPeak } from './protocol.cross.js';

export type RecordingLatencyCalibrationSchedule = {
  clickTime: number;
  clickFrames: number[];
  endFrame: number;
};

export type CreateRecordingLatencyCalibrationScheduleOptions = {
  context: AudioContext;
  startDelaySeconds?: number;
};

export type GetRecordingLatencyFrameCountOptions = {
  measuredLatencyFrameCounts: number[];
  sampleRate: number;
};

const clickDelaySeconds = 0.25;
const clickCount = 5;
const clickIntervalSeconds = 1;
const clickTailSeconds = 1.1;
const clickDurationSeconds = 0.03;
const peakThreshold = 0.02;
const minimumLatencyMs = 0;
const maximumLatencyMs = 1000;

export const recordingLatencyCalibrationTimeoutSeconds = 6.2;
export const minimumRecordingLatencyMs = minimumLatencyMs;
export const maximumRecordingLatencyMs = maximumLatencyMs;

export const createRecordingLatencyCalibrationClick = (
  context: AudioContext,
) => {
  const frameCount = Math.round(context.sampleRate * clickDurationSeconds);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  channel[0] = 1;
  channel[1] = -1;
  channel[2] = 0.7;
  channel[3] = -0.7;
  return buffer;
};

export const createRecordingLatencyCalibrationSchedule = (
  options: CreateRecordingLatencyCalibrationScheduleOptions,
): RecordingLatencyCalibrationSchedule => {
  const { context } = options;
  const startDelaySeconds = options.startDelaySeconds ?? clickDelaySeconds;
  const clickTime = context.currentTime + startDelaySeconds;
  const clickFrames = Array.from({ length: clickCount }, (_, index) =>
    Math.round((clickTime + index * clickIntervalSeconds) * context.sampleRate),
  );
  const endFrame =
    clickFrames[clickFrames.length - 1] +
    Math.round(clickTailSeconds * context.sampleRate);

  return {
    clickTime,
    clickFrames,
    endFrame,
  };
};

export const getRecordingLatencyCalibrationFrameCounts = (
  peaks: RecordingLatencyCalibrationPeak[],
) =>
  peaks
    .filter((peak) => peak.peakValue >= peakThreshold)
    .map((peak) => Math.max(0, peak.peakFrame - peak.clickFrame));

export const getMedianFrameCount = (frameCounts: number[]) => {
  const sortedFrameCounts = [...frameCounts].sort(
    (left, right) => left - right,
  );
  return sortedFrameCounts[Math.floor(sortedFrameCounts.length / 2)];
};

export const clampRecordingLatencyFrameCount = (
  frameCount: number,
  sampleRate: number,
) =>
  Math.max(
    Math.round((minimumLatencyMs / 1000) * sampleRate),
    Math.min(Math.round((maximumLatencyMs / 1000) * sampleRate), frameCount),
  );

export const getRecordingLatencyFrameCount = (
  options: GetRecordingLatencyFrameCountOptions,
) => {
  const measuredLatencyFrameCount = getMedianFrameCount(
    options.measuredLatencyFrameCounts,
  );
  return clampRecordingLatencyFrameCount(
    measuredLatencyFrameCount,
    options.sampleRate,
  );
};
