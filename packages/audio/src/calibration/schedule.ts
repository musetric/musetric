import { getMedianFrameCount } from './peaks.es.js';

const clickDelaySeconds = 0.25;
const clickCount = 5;
const clickIntervalSeconds = 1;
const clickTailSeconds = 1.1;
const clickDurationSeconds = 0.08;

export const recordingLatencyCalibrationClickFrequencyHz = 1800;
export const recordingLatencyCalibrationTimeoutSeconds = 6.2;
export const minimumRecordingLatencyMs = 0;
export const maximumRecordingLatencyMs = 1000;

export const createRecordingLatencyCalibrationClick = (
  context: AudioContext,
) => {
  const frameCount = Math.round(context.sampleRate * clickDurationSeconds);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);

  for (let index = 0; index < channel.length; index += 1) {
    const time = index / context.sampleRate;
    const progress = index / channel.length;
    const envelope = (1 - progress) * (1 - progress);
    channel[index] =
      Math.sin(
        time * Math.PI * 2 * recordingLatencyCalibrationClickFrequencyHz,
      ) * envelope;
  }

  return buffer;
};

export type RecordingLatencyCalibrationSchedule = {
  clickTime: number;
  clickFrames: number[];
  endFrame: number;
};

export type CreateRecordingLatencyCalibrationScheduleOptions = {
  context: AudioContext;
  startDelaySeconds?: number;
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

export const clampRecordingLatencyFrameCount = (
  frameCount: number,
  sampleRate: number,
) =>
  Math.max(
    Math.round((minimumRecordingLatencyMs / 1000) * sampleRate),
    Math.min(
      Math.round((maximumRecordingLatencyMs / 1000) * sampleRate),
      frameCount,
    ),
  );

export type GetRecordingLatencyFrameCountOptions = {
  measuredLatencyFrameCounts: number[];
  sampleRate: number;
};

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
